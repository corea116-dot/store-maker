import { constants } from "node:fs";
import { lstat, open, realpath, stat } from "node:fs/promises";
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
