import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";

import { DETAIL_PAGE_CANDIDATE_ASSETS_DIR, IMAGE_RUNS_DIR } from "./config.mjs";
import { parseOutputImageUrl } from "./detail-page-schema.mjs";
import { ensureContainedDirectory, removeContainedPath, SafeFileBoundaryError, openContainedRegularFile, writeContainedNewFile } from "./safe-files.mjs";

export function createDetailPageCandidateAssetStore(options = {}) {
  const imageRunsDirectory = resolve(options.imageRunsDirectory ?? IMAGE_RUNS_DIR);
  const stagingDirectory = resolve(options.stagingDirectory ?? DETAIL_PAGE_CANDIDATE_ASSETS_DIR);
  const entries = new Map();
  const promoted = new Map();

  return { stage, materialize, discard, discardStaged, release, close };

  async function stage(candidateId, image) {
    const reference = outputReference(image);
    const sourcePath = resolve(imageRunsDirectory, reference.relativePath);
    let opened;
    let stagedHandle;
    try {
      opened = await openContainedRegularFile(imageRunsDirectory, sourcePath);
      const assetId = randomUUID();
      const candidateDirectory = await ensureCandidateDirectory(candidateId);
      const stagedPath = join(candidateDirectory, `${assetId}-${reference.filename}`);
      stagedHandle = await copyHandle(opened.handle, candidateDirectory, stagedPath, {
        trustedRoot: stagingDirectory,
        directoryMode: 0o700,
        keepOpen: true,
      });
      const entry = {
        candidateId,
        assetId,
        filename: reference.filename,
        image: {
          id: image.id,
          filename: reference.filename,
          alt: image.alt ?? "",
          source: image.source,
        },
        stagedPath,
        stagedHandle,
      };
      entries.set(entryKey(candidateId, assetId), entry);
      stagedHandle = undefined;
      return { assetId, imageId: image.id, filename: reference.filename, previewUrl: reference.url };
    } finally {
      await stagedHandle?.close().catch(() => {});
      await opened?.handle.close().catch(() => {});
    }
  }

  async function materialize(candidateId, assetId) {
    const entry = entries.get(entryKey(candidateId, assetId));
    if (!entry) throw new SafeFileBoundaryError("Candidate image is no longer available");
    const candidateDirectory = candidateDirectoryPath(candidateId);
    let opened;
    const usesRetainedHandle = Boolean(entry.stagedHandle);
    let outputDirectory;
    let outputPath;
    try {
      opened = usesRetainedHandle
        ? { handle: entry.stagedHandle }
        : await openContainedRegularFile(candidateDirectory, entry.stagedPath, { trustedRoot: stagingDirectory });
      const runId = randomUUID();
      outputDirectory = await ensureOutputDirectory(runId);
      outputPath = join(outputDirectory, entry.filename);
      await copyHandle(opened.handle, outputDirectory, outputPath, { trustedRoot: imageRunsDirectory, directoryMode: 0o755 });
      entries.delete(entryKey(candidateId, assetId));
      await entry.stagedHandle?.close();
      entry.stagedHandle = undefined;
      const materialized = {
        ...entry.image,
        url: `/outputs/image-runs/${runId}/${encodeURIComponent(entry.filename)}`,
      };
      const items = promoted.get(candidateId) ?? [];
      items.push({ outputDirectory, outputPath });
      promoted.set(candidateId, items);
      return materialized;
    } catch (error) {
      if (outputDirectory && outputPath) await removePromoted({ outputDirectory, outputPath }, imageRunsDirectory).catch(() => {});
      throw error;
    } finally {
      if (!usesRetainedHandle) await opened?.handle.close().catch(() => {});
    }
  }

  async function discard(candidateId) {
    await discardStaged(candidateId);
    const items = promoted.get(candidateId) ?? [];
    promoted.delete(candidateId);
    await Promise.all(items.map((item) => removePromoted(item, imageRunsDirectory)));
  }

  async function discardStaged(candidateId) {
    const candidateDirectory = candidateDirectoryPath(candidateId);
    for (const [key, entry] of entries) {
      if (entry.candidateId === candidateId) {
        await entry.stagedHandle?.close();
        entries.delete(key);
      }
    }
    await removeContainedPath(stagingDirectory, candidateDirectory, { trustedRoot: dirname(stagingDirectory), recursive: true, ignoreMissing: true });
  }

  async function release(candidateId) {
    await discardStaged(candidateId);
    promoted.delete(candidateId);
  }

  async function close() {
    const candidateIds = [...new Set([...entries.values()].map((entry) => entry.candidateId).concat([...promoted.keys()]))];
    await Promise.all(candidateIds.map((candidateId) => discard(candidateId)));
  }

  async function ensureCandidateDirectory(candidateId) {
    const candidateDirectory = candidateDirectoryPath(candidateId);
    await ensureContainedDirectory(stagingDirectory, { trustedRoot: dirname(stagingDirectory), mode: 0o700 });
    return ensureContainedDirectory(candidateDirectory, { trustedRoot: stagingDirectory, mode: 0o700 });
  }

  async function ensureOutputDirectory(runId) {
    await ensureContainedDirectory(imageRunsDirectory, { trustedRoot: dirname(imageRunsDirectory), mode: 0o755 });
    return ensureContainedDirectory(join(imageRunsDirectory, runId), { trustedRoot: imageRunsDirectory, mode: 0o755 });
  }

  function candidateDirectoryPath(candidateId) {
    if (typeof candidateId !== "string" || !/^[0-9a-f-]{8,}$/iu.test(candidateId)) {
      throw new SafeFileBoundaryError("Candidate identifier is invalid");
    }
    return join(stagingDirectory, candidateId);
  }
}

async function removePromoted({ outputDirectory, outputPath }, imageRunsDirectory) {
  const trustedRoot = dirname(imageRunsDirectory);
  await removeContainedPath(imageRunsDirectory, outputPath, { trustedRoot, ignoreMissing: true });
  await removeContainedPath(imageRunsDirectory, outputDirectory, { trustedRoot, recursive: true, ignoreMissing: true });
}

function outputReference(image) {
  if (!image || typeof image !== "object") throw new SafeFileBoundaryError("Candidate image is invalid");
  const outputImage = parseOutputImageUrl(image.url);
  if (!outputImage || typeof image.id !== "string" || !image.id.trim() || typeof image.source !== "string") {
    throw new SafeFileBoundaryError("Candidate image must reference a Store Maker output image");
  }
  return outputImage;
}

function entryKey(candidateId, assetId) {
  return `${candidateId}:${assetId}`;
}

async function copyHandle(sourceHandle, outputRoot, outputPath, options) {
  await writeContainedNewFile(outputRoot, outputPath, await sourceHandle.readFile(), options);
  if (options.keepOpen !== true) return undefined;
  return (await openContainedRegularFile(outputRoot, outputPath, { trustedRoot: options.trustedRoot })).handle;
}
