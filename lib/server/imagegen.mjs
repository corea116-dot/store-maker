import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join, sep } from "node:path";
import { IMAGE_RUNS_DIR, IMAGE_UPLOADS_DIR, IMAGEGEN_TIMEOUT_MS, OUTPUT_LIMIT, ROOT } from "./config.mjs";
import { logEntry } from "./logs.mjs";
import { formatCommand, redactSensitive } from "./redaction.mjs";

const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const hiddenValueOptions = new Set(["--image", "-i", "--output-last-message", "-o"]);
const MANIFEST_GRACE_MS = 5000;

export async function runImageGeneration(input) {
  if (!input.imageGeneration?.enabled) return { ok: true, images: undefined, logs: [] };
  const runId = randomUUID();
  const outputRelativeDir = join("outputs", "image-runs", runId);
  const uploadRelativeDir = join("outputs", "uploads", runId);
  const outputDir = join(IMAGE_RUNS_DIR, runId);
  const uploadDir = join(IMAGE_UPLOADS_DIR, runId);
  const config = input.imageGeneration;
  const providerLabel = "Codex CLI ImageGen";
  const startedAt = Date.now();

  await mkdir(outputDir, { recursive: true });
  await mkdir(uploadDir, { recursive: true });

  let references;
  try {
    references = config.useReference ? await persistReferenceImages(input.runtime?.imageAttachmentSources ?? [], uploadDir, uploadRelativeDir) : [];
  } catch (error) {
    return imageFailure("첨부 이미지 저장 실패", error, []);
  }

  const prompt = composeImagePrompt(input, { outputDir, outputRelativeDir, references });
  const publicPrompt = publicText(prompt);
  const parsed = parseCommandLine(config.command);
  if (!parsed) {
    return imageFailure(`${providerLabel} command is required`, undefined, []);
  }

  let invocation;
  try {
    invocation = await prepareCodexImageInvocation({ parsed, config, references });
  } catch (error) {
    return imageFailure(error instanceof Error ? error.message : "Codex CLI ImageGen 실행 준비에 실패했습니다.", error, []);
  }

  const safeCommand = formatCommand(invocation.command, invocation.args, invocation.hiddenArgIndexes);
  const logs = [
    logEntry("info", "image generation requested", `${providerLabel} image 단계에서 ${safeCommand} 실행을 시작합니다.`),
  ];

  try {
    const execution = await spawnImageInvocation({
      invocation,
      prompt,
      timeoutMs: config.timeoutMs ?? IMAGEGEN_TIMEOUT_MS,
      providerLabel,
      outputDir,
      outputRelativeDir,
      runId,
      startedAt,
      expectedCount: config.count,
      referenceCount: references.length,
      logs,
    });
    if (!execution.ok) return execution;
    const collection = await collectGeneratedImages({
      outputDir,
      outputRelativeDir,
      runId,
      startedAt,
      expectedCount: config.count,
      input,
      references,
      providerLabel,
    });
    if (collection.files.length === 0) {
      const diagnostic = execution.diagnostic ? ` ${execution.diagnostic}` : "";
      return {
        ok: false,
        error: `${providerLabel} 실행은 끝났지만 output 이미지 파일이 생성되지 않았습니다.${diagnostic} $imagegen 사용 가능 여부, --image 파일 접근, output directory 쓰기/복사 지시를 확인하세요.`,
        logs: [...execution.logs, logEntry("error", "image generation failed", `output 이미지 파일을 찾지 못했습니다.${diagnostic}`)],
      };
    }
    const recoveryLogs = collection.fallbackCreated
      ? [logEntry("warning", "fallback manifest created", `이미지는 생성됐지만 manifest가 없어 ${collection.files.length}개 이미지 파일로 fallback manifest를 자동 생성했습니다.`)]
      : [];
    const importLogs = collection.importedFromCodexHome
      ? [logEntry("warning", "image output imported", `Codex 기본 이미지 저장소에서 새 이미지 ${collection.importedFromCodexHome}개를 ${outputRelativeDir}로 복구했습니다.`)]
      : [];
    return {
      ok: true,
      images: {
        provider: "codex-imagegen",
        providerLabel,
        runId,
        outputDir: outputRelativeDir,
        prompt: publicPrompt,
        count: config.count,
        ratio: config.ratio,
        style: config.style,
        background: effectiveBackground(config),
        referenceFiles: references.map(({ name, type, size }) => ({ name, type, size })),
        files: collection.files,
        manifest: collection.manifest,
      },
      logs: [...execution.logs, ...importLogs, ...recoveryLogs, logEntry("success", "image generation completed", `${collection.files.length}개 이미지 파일을 ${outputRelativeDir}에서 찾았습니다.`)],
    };
  } finally {
    await invocation.cleanup?.();
  }
}

function composeImagePrompt(input, { outputDir, outputRelativeDir, references }) {
  const config = input.imageGeneration;
  const attachmentSummary = input.product.attachments?.length
    ? input.product.attachments.map((attachment) => `- ${attachment.name} | ${attachment.type} | ${attachment.size} bytes | ${attachment.kind}`).join("\n")
    : "- 제공 없음";
  const referenceSummary = references.length
    ? references.map((reference) => `- ${reference.name} (${reference.type}, ${reference.size} bytes) | attached via --image | ${reference.relativePath} | ${reference.absolutePath}`).join("\n")
    : "- reference image 없음. 텍스트 정보만 기반으로 생성";
  const targetFile = join(outputDir, "product-main.png");
  const targetRelativeFile = join(outputRelativeDir, "product-main.png");

  return [
    "$imagegen",
    "한국 이커머스 상세페이지용 제품 이미지를 실제 이미지 파일로 생성하세요.",
    "과장 광고, 의료/성능 보장 표현, 실제 상품 형태 왜곡을 피하고 상품 정보와 요구사항에 맞춥니다.",
    "",
    "## 상품 정보",
    `- 상품명: ${input.product.name}`,
    `- 상품 설명: ${input.product.description}`,
    `- 요구사항: ${input.product.requirements}`,
    `- 목표 마켓: ${input.markets.join(", ")}`,
    "",
    "## 첨부 파일 요약",
    attachmentSummary,
    "",
    "## Reference 이미지",
    referenceSummary,
    "",
    "## 생성 옵션",
    `- 생성 개수: ${config.count}`,
    `- 비율: ${config.ratio}`,
    `- 스타일: ${config.style}`,
    `- 배경: ${effectiveBackground(config)}`,
    "",
    "## Output Contract",
    `OUTPUT_DIR: ${outputRelativeDir}`,
    `OUTPUT_DIR_RELATIVE: ${outputRelativeDir}`,
    `OUTPUT_DIR_ABSOLUTE: ${outputDir}`,
    `TARGET_FILE_RELATIVE: ${targetRelativeFile}`,
    `TARGET_FILE_ABSOLUTE: ${targetFile}`,
    "생성 이미지를 반드시 위 output directory에 저장하세요.",
    "파일명은 product-main.png, product-main-2.png처럼 안정적인 이름을 사용하세요.",
    "텍스트 설명만 하지 말고 실제 png/jpg/webp 이미지 파일을 저장하세요.",
    "$imagegen 도구가 이미지를 CODEX_HOME/generated_images 같은 기본 위치에 저장하면, 생성된 최종 이미지 파일을 TARGET_FILE_ABSOLUTE로 복사하세요.",
    "저장 후 파일이 존재하고 0 bytes가 아닌지 확인하세요.",
    "manifest.json을 같은 폴더에 생성하고 files 배열에 생성 파일명을 기록하세요.",
    "manifest.json 작성이 실패하더라도 생성 이미지는 반드시 output directory에 남기세요.",
    "저장 후 작업을 종료하세요. 추가 질문하지 말고 대화형 입력을 기다리지 마세요.",
    "최종 답변은 짧게 완료 여부만 설명하고, 실제 산출물은 이미지 파일이어야 합니다.",
  ].join("\n");
}

async function persistReferenceImages(sources, uploadDir, uploadRelativeDir) {
  const references = [];
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    const buffer = decodeDataUrl(source.dataUrl, source.type);
    if (!buffer) continue;
    const filename = `${String(index + 1).padStart(2, "0")}-${safeOutputName(source.name)}`;
    const absolutePath = join(uploadDir, filename);
    await writeFile(absolutePath, buffer);
    references.push({
      name: source.name,
      type: source.type,
      size: buffer.length,
      relativePath: join(uploadRelativeDir, filename),
      absolutePath,
    });
  }
  return references;
}

async function prepareCodexImageInvocation({ parsed, config, references }) {
  const tempDir = await mkdtemp(join(tmpdir(), "store-maker-imagegen-"));
  const outputFile = join(tempDir, "last-message.md");
  let args = ensureCodexExecArgs([...parsed.args, ...parseWords(config.extraArgs ?? "")]);
  args = withoutOption(args, "--output-last-message", "-o");
  args = withoutOption(args, "--image", "-i");
  args = ensureFlag(args, "--skip-git-repo-check");
  args = ensureFlag(args, "--ephemeral");
  args = ensureOptionPair(args, "--sandbox", "workspace-write", "-s");
  args = ensureOptionPair(args, "--color", "never");
  if (config.model && !/^(cli config|default|provider-default)$/iu.test(config.model)) args = ensureOptionPair(args, "--model", config.model, "-m");
  args.push("--output-last-message", outputFile);
  for (const reference of references) args.push("--image", reference.absolutePath);
  args.push("-");
  return {
    command: parsed.command,
    args,
    hiddenArgIndexes: hiddenArgIndexes(args),
    outputFile,
    cleanup: () => rm(tempDir, { recursive: true, force: true }),
  };
}

function spawnImageInvocation({ invocation, prompt, timeoutMs, providerLabel, outputDir, outputRelativeDir, runId, startedAt, expectedCount, referenceCount, logs }) {
  return new Promise((resolveRun) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: ROOT,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    let timedOut = false;
    let settled = false;
    let killTimer;
    let stdout = "";
    let stderr = "";
    let lastOutputSignature = "";
    let firstStableImageAt;

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child, "SIGTERM");
      killTimer = setTimeout(() => killProcessTree(child, "SIGKILL"), 500);
    }, timeoutMs);
    const outputTimer = setInterval(() => {
      void settleWhenOutputContractReady();
    }, 1000);

    async function settleWhenOutputContractReady() {
      if (settled) return;
      const files = await findGeneratedImagesWithRecovery({ outputDir, outputRelativeDir, runId, startedAt, expectedCount });
      if (files.length === 0) return;
      const signature = files.map((file) => `${file.filename}:${file.size}`).join("|");
      if (signature !== lastOutputSignature) {
        lastOutputSignature = signature;
        firstStableImageAt = undefined;
        return;
      }
      firstStableImageAt ??= Date.now();
      const manifestPresent = await hasManifest(outputDir);
      if (!manifestPresent && Date.now() - firstStableImageAt < MANIFEST_GRACE_MS) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      clearInterval(outputTimer);
      await stopChild(child);
      resolveRun({
        ok: true,
        logs: [
          ...logs,
          logEntry("success", "image output detected", `${providerLabel} output contract가 ${outputRelativeDir}에서 충족되어 CLI 종료 대기 없이 완료 처리했습니다. manifest=${manifestPresent ? "present" : "missing"}`),
        ],
      });
    }

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
      clearInterval(outputTimer);
      resolveRun({ ok: false, error: processErrorMessage(error, providerLabel), logs: [...logs, logEntry("error", "image generation failed", processErrorMessage(error, providerLabel))] });
    });
    child.on("close", async (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      clearInterval(outputTimer);

      if (timedOut) {
        const recoveredFiles = await findGeneratedImagesWithRecovery({ outputDir, outputRelativeDir, runId, startedAt, expectedCount });
        if (recoveredFiles.length > 0) {
          const manifestPresent = await hasManifest(outputDir);
          resolveRun({
            ok: true,
            logs: [
              ...logs,
              logEntry("warning", "image output recovered", `${providerLabel}가 timeout 되었지만 ${outputRelativeDir}에서 ${recoveredFiles.length}개 이미지 파일을 발견해 process tree를 정리하고 자동 복구했습니다. manifest=${manifestPresent ? "present" : "missing"}`),
            ],
          });
          return;
        }
        const outputState = await outputDirectoryState(outputDir);
        const diagnostic = await invocationDiagnostic({ invocation, stdout, stderr, prompt, referenceCount, outputRelativeDir, outputState });
        const message = `${providerLabel}가 image 단계에서 timed out after ${timeoutMs}ms. output directory 상태: ${outputState}. ${diagnostic} 이미지 파일이 0개라 성공 처리하지 않았습니다. $imagegen 사용 가능 여부, --image 파일 접근, output directory 쓰기/복사 지시를 확인하세요.`;
        resolveRun({ ok: false, error: message, diagnostic, logs: [...logs, logEntry("error", "image generation timed out", message)] });
        return;
      }
      if (code === 0) {
        const output = await readInvocationOutput(invocation, stdout);
        const diagnostic = await invocationDiagnostic({ invocation, stdout, stderr, prompt, referenceCount, outputRelativeDir, outputState: await outputDirectoryState(outputDir) });
        resolveRun({ ok: true, diagnostic, logs: [...logs, logEntry("success", "image prompt delivered", `${providerLabel} image 단계 완료. output=${output ? "captured" : "empty"}. exit=${code}`)] });
        return;
      }
      const diagnostic = await invocationDiagnostic({ invocation, stdout, stderr, prompt, referenceCount, outputRelativeDir, outputState: await outputDirectoryState(outputDir) });
      const output = publicText(limit((stderr || stdout || "").trim()));
      const auth = looksLikeAuthError(output);
      const exit = code === null ? `signal ${signal}` : `exit ${code}`;
      const message = auth
        ? `${providerLabel} 인증이 필요합니다. 터미널에서 먼저 로그인하세요. ${output}`
        : `${providerLabel} 실행 실패 (image 단계, ${exit}). ${output || "CLI 출력이 없습니다."} ${diagnostic}`;
      resolveRun({ ok: false, error: message, diagnostic, logs: [...logs, logEntry("error", "image generation failed", message)] });
    });

    child.stdin.end(prompt);
  });
}

function killProcessTree(child, signal) {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") {
      child.kill(signal);
      return;
    }
    process.kill(-child.pid, signal);
  } catch (error) {
    try {
      child.kill(signal);
    } catch (innerError) {
      // Process already exited.
    }
  }
}

function stopChild(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolveStop) => {
    let done = false;
    let sigkillTimer;
    let resolveTimer;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(sigkillTimer);
      clearTimeout(resolveTimer);
      resolveStop();
    };
    child.once("close", finish);
    killProcessTree(child, "SIGTERM");
    sigkillTimer = setTimeout(() => killProcessTree(child, "SIGKILL"), 500);
    resolveTimer = setTimeout(finish, 2000);
  });
}

async function findGeneratedImages(outputDir, outputRelativeDir, runId) {
  const imagePaths = await findImagePaths(outputDir);
  const files = [];
  for (const absolutePath of imagePaths) {
    const filename = absolutePath.slice(outputDir.length + 1);
    const ext = extensionOf(filename);
    const info = await stat(absolutePath);
    files.push({
      filename,
      relativePath: join(outputRelativeDir, filename),
      url: `/${outputRelativeDir.split(sep).join("/")}/${filename.split(sep).map(encodeURIComponent).join("/")}`,
      size: info.size,
      type: mimeType(ext),
      createdAt: info.birthtime.toISOString(),
      modifiedAt: info.mtime.toISOString(),
      runId,
    });
  }
  return files.sort((a, b) => a.filename.localeCompare(b.filename));
}

async function findGeneratedImagesWithRecovery({ outputDir, outputRelativeDir, runId, startedAt, expectedCount }) {
  let files = await findGeneratedImages(outputDir, outputRelativeDir, runId);
  if (files.length > 0) return files;
  await recoverCodexHomeImages({ outputDir, startedAt, expectedCount });
  files = await findGeneratedImages(outputDir, outputRelativeDir, runId);
  return files;
}

async function collectGeneratedImages({ outputDir, outputRelativeDir, runId, startedAt, expectedCount, input, references, providerLabel }) {
  const before = await findGeneratedImages(outputDir, outputRelativeDir, runId);
  const files = before.length > 0 ? before : await findGeneratedImagesWithRecovery({ outputDir, outputRelativeDir, runId, startedAt, expectedCount });
  if (files.length === 0) return { files, manifest: undefined, fallbackCreated: false, importedFromCodexHome: 0 };
  const manifest = await readManifest(outputDir);
  if (manifest) return { files, manifest, fallbackCreated: false, importedFromCodexHome: Math.max(0, files.length - before.length) };
  const fallback = fallbackManifest({ files, runId, outputRelativeDir, input, references, providerLabel });
  await writeFile(join(outputDir, "manifest.json"), JSON.stringify(fallback, null, 2));
  return { files, manifest: fallback, fallbackCreated: true, importedFromCodexHome: Math.max(0, files.length - before.length) };
}

async function readManifest(outputDir) {
  try {
    return sanitizeManifest(JSON.parse(await readFile(join(outputDir, "manifest.json"), "utf8")));
  } catch (error) {
    return undefined;
  }
}

async function hasManifest(outputDir) {
  try {
    await stat(join(outputDir, "manifest.json"));
    return true;
  } catch (error) {
    return false;
  }
}

function fallbackManifest({ files, runId, outputRelativeDir, input, references, providerLabel }) {
  return {
    provider: "codex-imagegen",
    providerLabel,
    fallback: true,
    reason: "manifest.json was missing; Store Maker recovered generated image files from the output directory or Codex generated_images fallback.",
    runId,
    outputDir: outputRelativeDir,
    createdAt: new Date().toISOString(),
    promptSummary: {
      productName: input.product.name,
      markets: input.markets,
      imageOptions: {
        count: input.imageGeneration.count,
        ratio: input.imageGeneration.ratio,
        style: input.imageGeneration.style,
        background: effectiveBackground(input.imageGeneration),
      },
      referenceCount: references.length,
    },
    files: files.map(({ filename, relativePath, url, size, type, createdAt, modifiedAt }) => ({
      filename,
      relativePath,
      url,
      size,
      mimeType: type,
      createdAt,
      modifiedAt,
    })),
  };
}

function sanitizeManifest(value) {
  if (Array.isArray(value)) return value.map((item) => sanitizeManifest(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeManifest(item)]));
  }
  if (typeof value === "string" && looksLikeLocalPath(value)) return "[redacted-local-path]";
  return value;
}

function looksLikeLocalPath(value) {
  if (value.includes(ROOT)) return true;
  return /^\/(?:Users|private|var|tmp|Volumes)\//u.test(value) || /^[A-Za-z]:\\/u.test(value);
}

async function findImagePaths(rootDir) {
  const found = [];
  async function visit(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      return;
    }
    for (const entry of entries) {
      const absolutePath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (imageExtensions.has(extensionOf(entry.name))) found.push(absolutePath);
    }
  }
  await visit(rootDir);
  return found;
}

async function recoverCodexHomeImages({ outputDir, startedAt, expectedCount }) {
  const candidates = [];
  for (const root of codexGeneratedImageRoots()) {
    const paths = await findImagePaths(root);
    for (const absolutePath of paths) {
      const info = await stat(absolutePath);
      if (info.size <= 0 || info.mtimeMs < startedAt) continue;
      candidates.push({ absolutePath, info });
    }
  }
  const selected = candidates
    .sort((a, b) => b.info.mtimeMs - a.info.mtimeMs)
    .slice(0, Math.max(1, Math.min(expectedCount ?? 1, 4)));
  for (let index = 0; index < selected.length; index += 1) {
    const ext = extensionOf(selected[index].absolutePath) || ".png";
    const filename = index === 0 ? `product-main${ext}` : `product-main-${index + 1}${ext}`;
    await copyFile(selected[index].absolutePath, join(outputDir, filename));
  }
}

function codexGeneratedImageRoots() {
  const roots = new Set();
  const codexHome = process.env.CODEX_HOME || join(homedir(), ".codex");
  roots.add(join(codexHome, "generated_images"));
  roots.add(join(codexHome, "generated-images"));
  return [...roots];
}

function imageFailure(message, error, logs) {
  const detail = error instanceof Error ? ` ${redactSensitive(error.message)}` : "";
  return { ok: false, error: `${message}${detail}`, logs: [...logs, logEntry("error", "image generation failed", `${message}${detail}`)] };
}

function decodeDataUrl(value, expectedType) {
  const match = value.match(/^data:([^;,]+);base64,([a-z0-9+/=\s]+)$/iu);
  if (!match || match[1].toLowerCase() !== expectedType.toLowerCase()) return undefined;
  return Buffer.from(match[2].replace(/\s+/gu, ""), "base64");
}

function safeOutputName(name) {
  return basename(name).replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/gu, "") || "reference.png";
}

function parseCommandLine(value) {
  const parts = parseWords(value);
  const [command, ...args] = parts;
  return command ? { command, args } : undefined;
}

function parseWords(value) {
  return value.match(/"[^"]+"|'[^']+'|\S+/gu)?.map((part) => part.replace(/^["']|["']$/gu, "")) ?? [];
}

function ensureCodexExecArgs(args) {
  const { args: withoutApproval, approval } = extractOptionPair(args, "--ask-for-approval", "-a");
  const execIndex = withoutApproval.indexOf("exec");
  const globalArgs = approval ?? ["--ask-for-approval", "never"];
  if (execIndex >= 0) {
    return [...withoutApproval.slice(0, execIndex), ...globalArgs, "exec", ...withoutApproval.slice(execIndex + 1)];
  }
  return [...globalArgs, "exec", ...withoutApproval];
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

function extractOptionPair(args, option, alias) {
  const next = [];
  let pair;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === option || args[index] === alias) {
      pair = [args[index], args[index + 1] ?? "never"];
      index += 1;
      continue;
    }
    next.push(args[index]);
  }
  return { args: next, approval: pair };
}

async function outputDirectoryState(outputDir) {
  try {
    const entries = await readdir(outputDir, { withFileTypes: true });
    const imageCount = (await findImagePaths(outputDir)).length;
    const hasManifest = entries.some((entry) => entry.isFile() && entry.name === "manifest.json");
    return `${imageCount} image file(s), manifest=${hasManifest ? "present" : "missing"}`;
  } catch (error) {
    return "output directory를 읽을 수 없습니다";
  }
}

function hiddenArgIndexes(args) {
  const hidden = new Set([args.length - 1]);
  for (let index = 0; index < args.length - 1; index += 1) {
    if (hiddenValueOptions.has(args[index])) hidden.add(index + 1);
  }
  return hidden;
}

async function readInvocationOutput(invocation, stdout) {
  try {
    const output = await readFile(invocation.outputFile, "utf8");
    return limit(output.trim() ? output : stdout);
  } catch (error) {
    return limit(stdout);
  }
}

async function invocationDiagnostic({ invocation, stdout, stderr, prompt, referenceCount, outputRelativeDir, outputState }) {
  const lastMessage = await readInvocationOutput(invocation, "");
  const parts = [
    `진단: prompt 전달=stdin(${Buffer.byteLength(prompt, "utf8")} bytes)`,
    `image inputs=${referenceCount}`,
    `cwd=store-maker root`,
    `outputDir=${outputRelativeDir}`,
    `output directory 상태=${outputState}`,
  ];
  if (stdout.trim()) parts.push(`stdout=${summarize(stdout)}`);
  if (stderr.trim()) parts.push(`stderr=${summarize(stderr)}`);
  if (lastMessage.trim()) parts.push(`last-message=${summarize(lastMessage)}`);
  return parts.join("; ");
}

function processErrorMessage(error, providerLabel) {
  if (!(error instanceof Error)) return `${providerLabel} 실행 중 알 수 없는 오류가 발생했습니다.`;
  if ("code" in error && error.code === "ENOENT") return "Codex CLI 미설치: codex 명령을 찾을 수 없습니다.";
  if ("code" in error && error.code === "EACCES") return "Codex CLI 실행 권한이 없습니다. command 실행 권한을 확인하세요.";
  return redactSensitive(error.message);
}

function looksLikeAuthError(value) {
  return /auth|login|credential|unauthorized|forbidden|api key|api-key|token/i.test(value);
}

function limit(value) {
  return value.length > OUTPUT_LIMIT ? `${value.slice(0, OUTPUT_LIMIT)}\n[truncated]` : value;
}

function summarize(value) {
  return publicText(value.trim().replace(/\s+/gu, " ").slice(0, 800));
}

function publicText(value) {
  return redactSensitive(value);
}

function extensionOf(value) {
  const ext = `.${value.split(".").pop()?.toLowerCase() ?? ""}`;
  return imageExtensions.has(ext) ? ext : "";
}

function mimeType(ext) {
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

function effectiveBackground(config) {
  return config.background === "사용자 지정" ? (config.customBackground ?? "사용자 지정") : config.background;
}
