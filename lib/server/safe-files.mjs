import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export class SafeFileBoundaryError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "SafeFileBoundaryError";
  }
}

export async function openContainedRegularFile(rootPath, candidatePath, options = {}) {
  const root = resolve(rootPath);
  const candidate = resolve(candidatePath);
  const trustedRoot = resolve(options.trustedRoot ?? dirname(root));
  const relativePath = relative(root, candidate);
  if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new SafeFileBoundaryError("File is outside the allowed directory");
  }

  let handle;
  try {
    const resolvedRoot = await resolveCapabilityRoot(trustedRoot, root);
    await assertNoSymlink(root, relativePath);
    const resolvedCandidate = await realpath(candidate);
    if (resolvedCandidate !== resolve(resolvedRoot, relativePath)) {
      throw new SafeFileBoundaryError("Symbolic links are not allowed inside the file boundary");
    }

    handle = await open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW);
    const descriptorInfo = await handle.stat({ bigint: true });
    if (!descriptorInfo.isFile()) throw new SafeFileBoundaryError("Path is not a regular file");
    if (descriptorInfo.nlink !== 1n) throw new SafeFileBoundaryError("File is shared using a hard link");

    await assertNoSymlink(root, relativePath);
    if (await resolveCapabilityRoot(trustedRoot, root) !== resolvedRoot || await realpath(candidate) !== resolvedCandidate) {
      throw new SafeFileBoundaryError("File path changed while it was being opened");
    }
    const pathInfo = await stat(candidate, { bigint: true });
    if (pathInfo.dev !== descriptorInfo.dev || pathInfo.ino !== descriptorInfo.ino) {
      throw new SafeFileBoundaryError("Opened file no longer matches its path");
    }
    return { handle, size: Number(descriptorInfo.size) };
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error instanceof SafeFileBoundaryError) throw error;
    throw new SafeFileBoundaryError("File is not safely readable", { cause: error });
  }
}

export async function ensureContainedDirectory(rootPath, options = {}) {
  const root = resolve(rootPath);
  const trustedRoot = resolve(options.trustedRoot ?? dirname(root));
  const relativeRoot = relative(trustedRoot, root);
  if (relativeRoot === ".." || relativeRoot.startsWith(`..${sep}`) || isAbsolute(relativeRoot)) {
    throw new SafeFileBoundaryError("Directory is outside the trusted directory");
  }
  try {
    await mkdir(trustedRoot, { recursive: true, mode: options.mode ?? 0o700 });
    await assertDirectory(trustedRoot);
    let current = trustedRoot;
    for (const segment of relativeRoot ? relativeRoot.split(sep) : []) {
      current = join(current, segment);
      await mkdir(current, { mode: options.mode ?? 0o700 }).catch((error) => {
        if (error?.code !== "EEXIST") throw error;
      });
      await assertDirectory(current);
    }
    const resolvedTrustedRoot = await realpath(trustedRoot);
    const resolvedRoot = await realpath(root);
    if (resolvedRoot !== resolve(resolvedTrustedRoot, relativeRoot)) {
      throw new SafeFileBoundaryError("Directory escapes its trusted directory");
    }
    return root;
  } catch (error) {
    if (error instanceof SafeFileBoundaryError) throw error;
    throw new SafeFileBoundaryError("Directory is not safely writable", { cause: error });
  }
}

export async function openContainedNewFile(rootPath, candidatePath, options = {}) {
  const root = await ensureContainedDirectory(rootPath, { trustedRoot: options.trustedRoot, mode: options.directoryMode });
  const candidate = resolve(candidatePath);
  const relativePath = relative(root, candidate);
  if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new SafeFileBoundaryError("File is outside the allowed directory");
  }
  const parentRelative = dirname(relativePath);
  if (parentRelative !== ".") await ensureContainedDirectory(join(root, parentRelative), { trustedRoot: root, mode: options.directoryMode });
  let handle;
  try {
    await assertNoSymlink(root, parentRelative === "." ? "" : parentRelative);
    handle = await open(candidate, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, options.mode ?? 0o600);
    const descriptorInfo = await handle.stat({ bigint: true });
    if (!descriptorInfo.isFile() || descriptorInfo.nlink !== 1n) throw new SafeFileBoundaryError("New file is not a private regular file");
    await assertNoSymlink(root, parentRelative === "." ? "" : parentRelative);
    const resolvedCandidate = await realpath(candidate);
    if (resolvedCandidate !== resolve(await realpath(root), relativePath)) {
      throw new SafeFileBoundaryError("New file path changed while it was being opened");
    }
    const pathInfo = await stat(candidate, { bigint: true });
    if (pathInfo.dev !== descriptorInfo.dev || pathInfo.ino !== descriptorInfo.ino) {
      throw new SafeFileBoundaryError("Opened file no longer matches its path");
    }
    return { handle, size: Number(descriptorInfo.size) };
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error instanceof SafeFileBoundaryError) throw error;
    throw new SafeFileBoundaryError("File is not safely writable", { cause: error });
  }
}

async function assertNoSymlink(root, relativePath) {
  if ((await lstat(root)).isSymbolicLink()) {
    throw new SafeFileBoundaryError("Symbolic links are not allowed inside the file boundary");
  }
  let current = root;
  if (!relativePath) return;
  for (const segment of relativePath.split(sep)) {
    current = join(current, segment);
    if ((await lstat(current)).isSymbolicLink()) {
      throw new SafeFileBoundaryError("Symbolic links are not allowed inside the file boundary");
    }
  }
}

async function assertDirectory(path) {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new SafeFileBoundaryError("Directory must not be a symbolic link");
  }
  const uid = process.getuid?.();
  if (Number.isSafeInteger(uid) && info.uid !== uid) {
    throw new SafeFileBoundaryError("Directory must be owned by the local Store Maker user");
  }
  if ((info.mode & 0o022) !== 0) {
    throw new SafeFileBoundaryError("Directory must not be writable by group or other users");
  }
}

async function resolveCapabilityRoot(trustedRoot, root) {
  const relativeRoot = relative(trustedRoot, root);
  if (relativeRoot === ".." || relativeRoot.startsWith(`..${sep}`) || isAbsolute(relativeRoot)) {
    throw new SafeFileBoundaryError("Capability root is outside its trusted directory");
  }
  await assertNoSymlink(trustedRoot, relativeRoot);
  const resolvedTrustedRoot = await realpath(trustedRoot);
  const resolvedRoot = await realpath(root);
  if (resolvedRoot !== resolve(resolvedTrustedRoot, relativeRoot)) {
    throw new SafeFileBoundaryError("Capability root escapes its trusted directory");
  }
  return resolvedRoot;
}
