import { execFile, spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { GENERATE_TIMEOUT_MS, OUTPUT_LIMIT, PREFLIGHT_TIMEOUT_MS, ROOT } from "./config.mjs";
import { preflightByok, runByokProvider } from "./byok.mjs";
import { logEntry } from "./logs.mjs";
import { formatCommand, formatCommandLine, redactSensitive } from "./redaction.mjs";

const ENGINE_DEFINITIONS = [
  engine("codex", "Codex CLI", "codex exec --skip-git-repo-check --ephemeral --sandbox read-only", "OpenAI Codex CLI"),
  engine("claude", "Claude CLI", "claude -p", "Anthropic Claude CLI"),
  engine("gemini", "Gemini CLI", "gemini", "Google Gemini CLI"),
  engine("custom", "커스텀 CLI", "", "로컬 실행 파일 또는 래퍼 스크립트"),
  { id: "byok", label: "BYOK HTTP", command: "", description: "HTTP provider with your own key", mode: "byok-http" },
];

const ADAPTER_TIMEOUT_MS = {
  codex: 180_000,
  claude: 180_000,
  gemini: 180_000,
  custom: GENERATE_TIMEOUT_MS,
};

const PROMPT_TRANSPORTS = new Set(["stdin", "last-arg", "prompt-file"]);
export async function discoverEngines() {
  const engines = [];
  for (const definition of ENGINE_DEFINITIONS) {
    if (definition.id === "byok") {
      engines.push({ ...definition, status: "untested", detail: "Provider URL is checked during preflight" });
      continue;
    }
    if (definition.id === "custom") {
      engines.push({ ...definition, status: "untested", detail: "Enter a command to test a custom CLI" });
      continue;
    }
    const found = await findExecutable(parseCommandLine(definition.command)?.command);
    engines.push(found
      ? { ...definition, status: "untested", detectedCommand: found, detail: "Found on PATH" }
      : { ...definition, status: "missing", detail: "Command not found on PATH" });
  }
  return engines;
}

export async function preflightEngine(body) {
  const input = readObject(body);
  input.mode = normalizeMode(readString(input.mode));
  if (input.mode === "byok-http") return preflightByok(input, readString, preflightResult);

  const engineId = normalizeEngineId(readString(input.engineId));
  const commandLine = readString(input.command) ?? defaultCommand(engineId);
  if (!commandLine) return preflightResult(false, input, "missing", "Local CLI command is required");

  const parsed = parseCommandLine(commandLine);
  if (!parsed) return preflightResult(false, input, "missing", "Local CLI command is empty");

  try {
    const output = await execPreflight(parsed, engineId);
    return {
      ...preflightResult(true, input, "available", `${adapterLabel(engineId)} preflight passed`),
      command: redactCommandLine(commandLine),
      detail: limit(output),
    };
  } catch (error) {
    const status = error instanceof Error && "code" in error && error.code === "ENOENT" ? "missing" : "failed";
    return preflightResult(false, input, status, preflightErrorMessage(error, parsed.command, engineId));
  }
}

export async function runEngine(input, prompt) {
  return input.engine.mode === "byok-http"
    ? runByokProvider(input, prompt)
    : runLocalCli(input, prompt);
}

async function runLocalCli(input, prompt) {
  const parsed = parseCommandLine(input.engine.command);
  const engineId = normalizeEngineId(input.engine.engineId);
  const label = adapterLabel(engineId);
  const stage = input.routing?.copy ? `copy=${input.routing.copy}` : "copy=current";

  if (!parsed) {
    return {
      ok: false,
      output: "",
      error: `${label} command is required`,
      logs: [logEntry("error", "command missing", "실행할 CLI 명령이 없습니다.")],
    };
  }

  let invocation;
  try {
    invocation = await prepareInvocation({ parsed, engine: input.engine, engineId, prompt });
  } catch (error) {
    const message = error instanceof Error ? error.message : `${label} 실행 준비에 실패했습니다.`;
    return { ok: false, output: "", error: message, logs: [logEntry("error", "local CLI prepare failed", message)] };
  }

  const safeCommand = formatCommand(invocation.command, invocation.args, invocation.hiddenArgIndexes);
  const logs = [
    logEntry("info", "local CLI starting", `${label} ${stage} 단계에서 ${safeCommand} 실행을 시작합니다.`),
  ];
  const timeoutMs = input.engine.timeoutMs ?? ADAPTER_TIMEOUT_MS[engineId] ?? GENERATE_TIMEOUT_MS;

  try {
    return await spawnInvocation({ invocation, prompt, engineId, label, stage, timeoutMs, logs });
  } finally {
    await invocation.cleanup?.();
  }
}

function spawnInvocation({ invocation, prompt, engineId, label, stage, timeoutMs, logs }) {
  return new Promise((resolveRun) => {
    const child = spawn(invocation.command, invocation.args, { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"], shell: false });
    let timedOut = false;
    let settled = false;
    let killTimer;
    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 500);
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout = limit(stdout + String(chunk));
    });
    child.stderr.on("data", (chunk) => {
      stderr = limit(stderr + String(chunk));
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      const message = processErrorMessage(error, label);
      resolveRun({ ok: false, output: stdout, error: message, logs: [...logs, logEntry("error", "local CLI failed", message)] });
    });
    child.on("close", async (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);

      const output = await readInvocationOutput(invocation, stdout);
      if (timedOut) {
        const message = timeoutMessage({ engineId, label, stage, timeoutMs, stderr, stdout });
        resolveRun({ ok: false, output, error: message, logs: [...logs, logEntry("error", "local CLI timed out", message)] });
        return;
      }
      if (code === 0) {
        resolveRun({
          ok: true,
          output,
          logs: [
            ...logs,
            logEntry("success", "prompt delivered", `${label} ${stage} 단계 완료. prompt delivered via ${invocation.promptTransport}; output=${invocation.outputSource}. exit=${code}`),
          ],
        });
        return;
      }
      const message = exitErrorMessage({ label, stage, code, signal, stderr, stdout });
      resolveRun({ ok: false, output, error: message, logs: [...logs, logEntry("error", "local CLI failed", message)] });
    });

    if (invocation.stdin === "prompt") {
      child.stdin.end(prompt);
    } else {
      child.stdin.end();
    }
  });
}

async function prepareInvocation({ parsed, engine, engineId, prompt }) {
  const extra = extraArgs(engine);
  if (engineId === "codex") return prepareCodexInvocation({ parsed, engine, extra, prompt });
  if (engineId === "claude") return prepareClaudeInvocation({ parsed, engine, extra });
  if (engineId === "gemini") return prepareGeminiInvocation({ parsed, engine, extra, prompt });
  return prepareCustomInvocation({ parsed, engine, extra, prompt });
}

async function prepareCodexInvocation({ parsed, engine, extra, prompt }) {
  const tempDir = await mkdtemp(join(tmpdir(), "store-maker-codex-"));
  const outputFile = join(tempDir, "last-message.md");
  let args = ensureCodexExecArgs([...parsed.args, ...extra]);
  args = withoutOption(args, "--output-last-message", "-o");
  args = ensureFlag(args, "--skip-git-repo-check");
  args = ensureFlag(args, "--ephemeral");
  args = ensureFlag(args, "--ignore-rules");
  args = ensureOptionPair(args, "--sandbox", "read-only", "-s");
  args = ensureOptionPair(args, "--color", "never");
  if (hasExplicitModel(engine.model)) args = ensureOptionPair(args, "--model", engine.model, "-m");
  args.push("--output-last-message", outputFile);
  args.push("-");

  return {
    command: parsed.command,
    args,
    hiddenArgIndexes: new Set([args.length - 2, args.length - 1]),
    stdin: "prompt",
    promptTransport: "stdin",
    outputFile,
    outputSource: "--output-last-message",
    cleanup: () => rm(tempDir, { recursive: true, force: true }),
  };
}

function prepareClaudeInvocation({ parsed, engine, extra }) {
  let args = [...parsed.args, ...extra];
  if (!hasOption(args, "-p", "--print")) args.push("-p");
  args = ensureOptionPair(args, "--input-format", "text");
  args = ensureOptionPair(args, "--output-format", "text");
  args = ensureFlag(args, "--no-session-persistence");
  if (hasExplicitModel(engine.model)) args = ensureOptionPair(args, "--model", engine.model);
  return { command: parsed.command, args, stdin: "prompt", promptTransport: "stdin", outputSource: "stdout" };
}

function prepareGeminiInvocation({ parsed, engine, extra, prompt }) {
  let args = [...parsed.args, ...extra];
  const hiddenArgIndexes = new Set();
  if (!hasOption(args, "--prompt", "-p")) {
    args.push("--prompt", prompt);
    hiddenArgIndexes.add(args.length - 1);
  }
  if (hasExplicitModel(engine.model)) args = ensureOptionPair(args, "--model", engine.model);
  return {
    command: parsed.command,
    args,
    hiddenArgIndexes,
    stdin: "empty",
    promptTransport: "--prompt",
    outputSource: "stdout",
  };
}

async function prepareCustomInvocation({ parsed, engine, extra, prompt }) {
  let args = [...parsed.args, ...extra, ...customModelArgs(engine)];
  const promptTransport = normalizePromptTransport(engine.promptTransport);
  if (promptTransport === "last-arg") {
    args.push(prompt);
    return {
      command: parsed.command,
      args,
      hiddenArgIndexes: new Set([args.length - 1]),
      stdin: "empty",
      promptTransport,
      outputSource: "stdout",
    };
  }
  if (promptTransport === "prompt-file") {
    const tempDir = await mkdtemp(join(tmpdir(), "store-maker-prompt-"));
    const promptFile = join(tempDir, "prompt.md");
    await writeFile(promptFile, prompt);
    args.push(promptFile);
    return {
      command: parsed.command,
      args,
      hiddenArgIndexes: new Set([args.length - 1]),
      stdin: "empty",
      promptTransport,
      outputSource: "stdout",
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  }
  return { command: parsed.command, args, stdin: "prompt", promptTransport, outputSource: "stdout" };
}

function execPreflight(parsed, engineId) {
  const args = preflightArgs(parsed.args, engineId);
  return new Promise((resolveExec, rejectExec) => {
    execFile(parsed.command, args, { cwd: ROOT, timeout: PREFLIGHT_TIMEOUT_MS, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        rejectExec(error);
        return;
      }
      resolveExec(`${stdout}${stderr}`);
    });
  });
}

function preflightArgs(existingArgs, engineId) {
  if (engineId === "claude") return [...existingArgs, "--version"];
  if (engineId === "codex") return [...existingArgs, "--version"];
  if (engineId === "gemini") return [...existingArgs, "--version"];
  return [...existingArgs, "--version"];
}

async function readInvocationOutput(invocation, stdout) {
  if (!invocation.outputFile) return stdout;
  try {
    const fileOutput = await readFile(invocation.outputFile, "utf8");
    return fileOutput.trim() ? limit(fileOutput) : stdout;
  } catch (error) {
    return stdout;
  }
}

async function findExecutable(command) {
  for (const candidate of executableCandidates(command)) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
    }
  }
  return undefined;
}

function executableCandidates(command) {
  if (!command) return [];
  if (command.includes("/")) return [resolve(ROOT, command)];
  return (process.env.PATH ?? "").split(":").filter(Boolean).map((dir) => join(dir, command));
}

function ensureCodexExecArgs(args) {
  return args[0] === "exec" ? args : ["exec", ...args];
}

function ensureFlag(args, flag) {
  return args.includes(flag) ? args : [...args, flag];
}

function ensureOptionPair(args, option, value, alias) {
  if (hasOption(args, option, alias)) return args;
  return [...args, option, value];
}

function hasOption(args, ...options) {
  return options.filter(Boolean).some((option) => args.includes(option));
}

function withoutOption(args, option, alias) {
  const next = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === option || args[index] === alias) {
      index += 1;
      continue;
    }
    next.push(args[index]);
  }
  return next;
}

function parseCommandLine(value) {
  const parts = parseWords(value);
  const [command, ...args] = parts;
  return command ? { command, args } : undefined;
}

function parseWords(value) {
  return value.match(/"[^"]+"|'[^']+'|\S+/gu)?.map((part) => part.replace(/^["']|["']$/gu, "")) ?? [];
}

function extraArgs(engineConfig) {
  return parseWords(engineConfig.extraArgs ?? "");
}

function customModelArgs(engineConfig) {
  return engineConfig.model && hasExplicitModel(engineConfig.model) ? ["--model", engineConfig.model] : [];
}

function hasExplicitModel(model) {
  return Boolean(model && !/^(cli config|default|provider-default)$/iu.test(model));
}

function defaultCommand(engineId) {
  return ENGINE_DEFINITIONS.find((definition) => definition.id === engineId)?.command;
}

function preflightResult(ok, input, status, message) {
  return {
    ok,
    status,
    message,
    engineId: normalizeEngineId(readString(input.engineId)),
    mode: normalizeMode(readString(input.mode)),
    model: readString(input.model),
    reasoning: readString(input.reasoning),
    checkedAt: new Date().toISOString(),
  };
}

function engine(id, label, command, description) {
  return { id, label, command, description, mode: "local-cli" };
}

function readObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function limit(value) {
  return value.length > OUTPUT_LIMIT ? `${value.slice(0, OUTPUT_LIMIT)}\n[truncated]` : value;
}

function normalizeMode(mode) {
  return mode === "byok" || mode === "byok-http" ? "byok-http" : "local-cli";
}

function normalizeEngineId(engineId) {
  return ["codex", "claude", "gemini", "custom", "byok"].includes(engineId) ? engineId : "custom";
}

function normalizePromptTransport(value) {
  return PROMPT_TRANSPORTS.has(value) ? value : "stdin";
}

function adapterLabel(engineId) {
  return ENGINE_DEFINITIONS.find((definition) => definition.id === engineId)?.label ?? "Custom CLI";
}

function preflightErrorMessage(error, command, engineId) {
  if (!(error instanceof Error)) return `${adapterLabel(engineId)} preflight failed`;
  if ("code" in error && error.code === "ENOENT") return `command not found: ${command}`;
  if ("code" in error && error.code === "EACCES") return `not executable: ${command}`;
  if ("killed" in error && error.killed) return `${adapterLabel(engineId)} preflight timeout after ${PREFLIGHT_TIMEOUT_MS}ms`;
  const output = `${"stdout" in error ? error.stdout ?? "" : ""}\n${"stderr" in error ? error.stderr ?? "" : ""}`;
  if (looksLikeAuthError(output) || looksLikeAuthError(error.message)) {
    return `auth required: ${limit(redactSensitive(output.trim() || error.message))}`;
  }
  return redactSensitive(error.message || `${adapterLabel(engineId)} preflight failed`);
}

function processErrorMessage(error, label) {
  if (!(error instanceof Error)) return `${label} 실행 중 알 수 없는 오류가 발생했습니다.`;
  if ("code" in error && error.code === "ENOENT") return `선택한 CLI가 설치되어 있지 않습니다: ${label}`;
  if ("code" in error && error.code === "EACCES") return `선택한 CLI를 실행할 수 없습니다. 실행 권한을 확인하세요: ${label}`;
  return redactSensitive(error.message);
}

function timeoutMessage({ engineId, label, stage, timeoutMs, stderr, stdout }) {
  const detail = redactSensitive(limit(`${stderr}\n${stdout}`.trim()));
  const base = `${label}가 ${stage} 단계에서 timed out after ${timeoutMs}ms.`;
  if (engineId === "codex") {
    return `${base} Codex CLI가 non-interactive exec 모드로 종료되지 않았습니다. 터미널에서 로그인 상태, 모델 응답, --output-last-message 지원 여부를 확인하세요.${detail ? ` 최근 출력: ${detail}` : ""}`;
  }
  if (looksLikeAuthError(detail)) {
    return `${base} 인증이 필요한 CLI입니다. 터미널에서 먼저 로그인하세요.`;
  }
  return `${base} 선택한 CLI가 대화형 모드로 실행되지 않는지, prompt 전달 방식을 확인하세요.${detail ? ` 최근 출력: ${detail}` : ""}`;
}

function exitErrorMessage({ label, stage, code, signal, stderr, stdout }) {
  const output = redactSensitive(limit((stderr || stdout || "").trim()));
  if (looksLikeAuthError(output)) {
    return `${label} 인증이 필요합니다. 터미널에서 먼저 로그인하세요. ${output}`;
  }
  const exit = code === null ? `signal ${signal}` : `exit ${code}`;
  return `${label} 실행 실패 (${stage} 단계, ${exit}). ${output || "CLI 출력이 없습니다."}`;
}

function looksLikeAuthError(value) {
  return /auth|login|credential|unauthorized|forbidden|api key|api-key|token/i.test(value);
}

function redactCommandLine(commandLine) {
  return formatCommandLine(parseWords(commandLine));
}
