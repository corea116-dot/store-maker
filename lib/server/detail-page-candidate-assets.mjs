import { rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";

import { DETAIL_PAGE_CANDIDATE_ASSETS_DIR, IMAGE_RUNS_DIR } from "./config.mjs";
import { parseOutputImageUrl } from "./detail-page-schema.mjs";
import { ensureContainedDirectory, openContainedNewFile, SafeFileBoundaryError, openContainedRegularFile } from "./safe-files.mjs";

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
    try {
      opened = await openContainedRegularFile(imageRunsDirectory, sourcePath);
      const assetId = randomUUID();
      const candidateDirectory = await ensureCandidateDirectory(candidateId);
      const stagedPath = join(candidateDirectory, `${assetId}-${reference.filename}`);
      await copyHandle(opened.handle, candidateDirectory, stagedPath, { trustedRoot: stagingDirectory, directoryMode: 0o700 });
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
      };
      entries.set(entryKey(candidateId, assetId), entry);
      return { assetId, imageId: image.id, filename: reference.filename, previewUrl: reference.url };
    } finally {
      await opened?.handle.close().catch(() => {});
    }
  }

  async function materialize(candidateId, assetId) {
    const entry = entries.get(entryKey(candidateId, assetId));
    if (!entry) throw new SafeFileBoundaryError("Candidate image is no longer available");
    const candidateDirectory = candidateDirectoryPath(candidateId);
    let opened;
    let outputDirectory;
    let outputPath;
    try {
      opened = await openContainedRegularFile(candidateDirectory, entry.stagedPath, { trustedRoot: stagingDirectory });
      const runId = randomUUID();
      outputDirectory = await ensureOutputDirectory(runId);
      outputPath = join(outputDirectory, entry.filename);
      await copyHandle(opened.handle, outputDirectory, outputPath, { trustedRoot: imageRunsDirectory, directoryMode: 0o755 });
      entries.delete(entryKey(candidateId, assetId));
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
      await opened?.handle.close().catch(() => {});
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
      if (entry.candidateId === candidateId) entries.delete(key);
    }
    await ensureContainedDirectory(stagingDirectory, { trustedRoot: dirname(stagingDirectory), mode: 0o700 });
    await rm(candidateDirectory, { recursive: true, force: true });
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
  await ensureContainedDirectory(imageRunsDirectory, { trustedRoot: dirname(imageRunsDirectory), mode: 0o755 });
  await ensureContainedDirectory(outputDirectory, { trustedRoot: imageRunsDirectory, mode: 0o755 });
  await rm(outputPath, { force: true });
  await rm(outputDirectory, { recursive: true, force: true });
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
  const output = await openContainedNewFile(outputRoot, outputPath, options);
  try {
    await pipeline(
      sourceHandle.createReadStream({ autoClose: false }),
      output.handle.createWriteStream(),
    );
    const verified = await openContainedRegularFile(outputRoot, outputPath, { trustedRoot: options.trustedRoot });
    await verified.handle.close();
  } finally {
    await output.handle.close().catch(() => {});
  }
}
