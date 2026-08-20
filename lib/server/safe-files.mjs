import { spawn } from "node:child_process";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";

const HELPER_PATH = fileURLToPath(new URL("../../scripts/safe-file-helper.py", import.meta.url));
const PYTHON_PATH = "/usr/bin/python3";
const PROTOCOL_VERSION = 1;
const HANDSHAKE_TIMEOUT_MS = 5_000;

let helperPreflight;

export class SafeFileBoundaryError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "SafeFileBoundaryError";
  }
}

export async function openContainedRegularFile(rootPath, candidatePath, options = {}) {
  const request = fileRequest(rootPath, candidatePath, options);
  try {
    await preflightSafeFileHelper();
    const session = await startHelper("open-read", request, { beforeOpen: options.beforeOpen, waitForFile: true, waitForRoot: true });
    return { handle: new HelperReadHandle(session), size: session.size };
  } catch (error) {
    throw boundaryError("File is not safely readable", error);
  }
}

export async function inspectContainedRegularFile(rootPath, candidatePath, options = {}) {
  const request = fileRequest(rootPath, candidatePath, options);
  try {
    return await invokeJson("inspect", request, options.beforeOpen);
  } catch (error) {
    throw boundaryError("File is not safely readable", error);
  }
}

export async function ensureContainedDirectory(rootPath, options = {}) {
  const request = rootRequest(rootPath, options);
  try {
    await invokeJson("ensure-directory", request, options.beforeOpen);
    return request.root;
  } catch (error) {
    throw boundaryError("Directory is not safely writable", error);
  }
}

export async function writeContainedNewFile(rootPath, candidatePath, bytes, options = {}) {
  if (!Buffer.isBuffer(bytes)) throw new SafeFileBoundaryError("File contents must be bytes");
  const request = { ...fileRequest(rootPath, candidatePath, options), data: bytes.toString("base64"), fileMode: options.fileMode ?? 0o600 };
  try {
    await invokeJson("write-new", request, options.beforeOpen);
  } catch (error) {
    throw boundaryError("File is not safely writable", error);
  }
}

export async function writeImmutableContainedFile(rootPath, candidatePath, bytes, options = {}) {
  if (!Buffer.isBuffer(bytes)) throw new SafeFileBoundaryError("File contents must be bytes");
  const request = { ...fileRequest(rootPath, candidatePath, options), data: bytes.toString("base64"), fileMode: options.fileMode ?? 0o600 };
  try {
    await invokeJson("write-immutable", request, options.beforeOpen);
  } catch (error) {
    throw boundaryError("File is not safely writable", error);
  }
}

export async function removeContainedPath(rootPath, candidatePath, options = {}) {
  const request = { ...fileRequest(rootPath, candidatePath, options), recursive: options.recursive === true, ignoreMissing: options.ignoreMissing === true };
  try {
    await invokeJson("remove-path", request, options.beforeOpen);
  } catch (error) {
    throw boundaryError("File is not safely removable", error);
  }
}

export async function preflightSafeFileHelper() {
  helperPreflight ??= probeHelper().catch((error) => {
    helperPreflight = undefined;
    throw error;
  });
  return helperPreflight;
}

function fileRequest(rootPath, candidatePath, options) {
  const request = rootRequest(rootPath, options);
  const candidate = resolve(candidatePath);
  assertContained(request.root, candidate, false);
  return { ...request, candidate };
}

function rootRequest(rootPath, options) {
  const root = resolve(rootPath);
  const trustedRoot = resolve(options.trustedRoot ?? dirname(root));
  assertContained(trustedRoot, root, true);
  return { root, trustedRoot, directoryMode: options.directoryMode ?? options.mode ?? 0o700 };
}

function assertContained(root, candidate, allowRoot) {
  const relativePath = relative(root, candidate);
  if ((!allowRoot && !relativePath) || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new SafeFileBoundaryError("File is outside the allowed directory");
  }
}

async function probeHelper() {
  const result = await invokeRaw("probe", {}, { waitForFile: false, waitForRoot: false });
  if (result.protocol !== PROTOCOL_VERSION) throw new SafeFileBoundaryError("Safe file helper is unavailable");
}

async function invokeJson(operation, request, beforeOpen) {
  await preflightSafeFileHelper();
  return invokeRaw(operation, request, { beforeOpen, waitForFile: false, waitForRoot: true });
}

async function invokeRaw(operation, request, options) {
  const session = await startHelper(operation, request, options);
  const output = await readAll(session.stream);
  const outcome = await session.closed;
  if (outcome.error) throw outcome.error;
  try {
    return JSON.parse(output.toString("utf8"));
  } catch {
    throw new SafeFileBoundaryError("Safe file helper returned an invalid response");
  }
}

function startHelper(operation, request, options) {
  return new Promise((resolveSession, rejectSession) => {
    const child = spawn(PYTHON_PATH, [HELPER_PATH, operation], {
      env: { LANG: "C", PATH: "/usr/bin:/bin", PYTHONDONTWRITEBYTECODE: "1", TMPDIR: process.env.TMPDIR ?? "/tmp" },
      shell: false,
      stdio: ["pipe", "pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stream = new PassThrough();
    stream.on("error", () => {});
    child.stdout.pipe(stream, { end: false });
    let stderr = "";
    let control = "";
    let rootOpened = false;
    let settled = false;
    let finish;
    const closed = new Promise((resolve) => { finish = resolve; });
    const timer = setTimeout(() => fail(new SafeFileBoundaryError("Safe file helper timed out")), HANDSHAKE_TIMEOUT_MS);

    child.stderr.on("data", (chunk) => { if (stderr.length < 1024) stderr += Buffer.from(chunk).toString("utf8"); });
    child.stdin.on("error", () => {});
    child.on("error", (error) => fail(error));
    child.on("close", (code) => {
      clearTimeout(timer);
      const error = code === 0 ? undefined : helperError(stderr);
      if (error) stream.destroy(error);
      else stream.end();
      finish({ error });
      if (!settled) {
        settled = true;
        rejectSession(error ?? new SafeFileBoundaryError("Safe file helper ended before opening the file"));
      }
    });
    if (options.waitForRoot) {
      child.stdio[3].on("data", (chunk) => { control += Buffer.from(chunk).toString("utf8"); void processControl(); });
    }
    child.stdin.write(`${JSON.stringify({ version: PROTOCOL_VERSION, ...request })}\n`);
    if (!options.waitForRoot) {
      child.stdin.end();
      settled = true;
      resolveSession({ stream, closed });
    }

    async function processControl() {
      while (control.includes("\n")) {
        const index = control.indexOf("\n");
        const line = control.slice(0, index);
        control = control.slice(index + 1);
        let message;
        try { message = JSON.parse(line); } catch { fail(new SafeFileBoundaryError("Safe file helper returned invalid control data")); return; }
        if (message.event === "root-opened" && !rootOpened) {
          rootOpened = true;
          try { await options.beforeOpen?.(); } catch (error) { fail(error); return; }
          child.stdin.write("C");
          if (!options.waitForFile) {
            child.stdin.end();
            if (!settled) { settled = true; resolveSession({ stream, closed }); }
          }
          continue;
        }
        if (message.event === "file-opened" && options.waitForFile && rootOpened && Number.isSafeInteger(message.size) && message.size >= 0) {
          clearTimeout(timer);
          if (!settled) {
            settled = true;
            resolveSession({
              stream,
              closed,
              size: message.size,
              continueFile: () => {
                child.stdin.write("C");
                child.stdin.end();
              },
              abort: () => child.kill(),
            });
          }
          continue;
        }
        fail(new SafeFileBoundaryError("Safe file helper returned invalid control data"));
        return;
      }
    }

    function fail(error) {
      clearTimeout(timer);
      child.kill();
      if (!settled) { settled = true; rejectSession(error instanceof Error ? error : new SafeFileBoundaryError("Safe file helper failed")); }
    }
  });
}

async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function helperError(stderr) {
  const code = /SAFE_FILE_ERROR:([A-Z_]+)/u.exec(stderr)?.[1];
  const error = new SafeFileBoundaryError("Safe file helper failed");
  error.code = code ?? "HELPER_FAILED";
  return error;
}

function boundaryError(message, cause) {
  if (cause instanceof SafeFileBoundaryError && cause.message === "File is outside the allowed directory") return cause;
  const error = new SafeFileBoundaryError(message, { cause });
  error.code = cause?.code;
  return error;
}

class HelperReadHandle {
  #session;
  #started = false;
  #closed = false;

  constructor(session) { this.#session = session; }

  createReadStream() {
    this.#start();
    return this.#session.stream;
  }

  async readFile(encoding) {
    this.#start();
    const bytes = await readAll(this.#session.stream);
    const outcome = await this.#session.closed;
    if (outcome.error) throw outcome.error;
    return encoding ? bytes.toString(encoding) : bytes;
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    if (!this.#started) this.#session.abort();
    const outcome = await this.#session.closed;
    if (outcome.error && this.#started) throw outcome.error;
  }

  #start() {
    if (this.#closed) throw new SafeFileBoundaryError("File handle is closed");
    if (!this.#started) {
      this.#started = true;
      this.#session.continueFile();
    }
  }
}
