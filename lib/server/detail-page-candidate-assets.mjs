import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";

import { DETAIL_PAGE_CANDIDATE_ASSETS_DIR, IMAGE_RUNS_DIR } from "./config.mjs";
import { parseOutputImageUrl } from "./detail-page-schema.mjs";
import { SafeFileBoundaryError, openContainedRegularFile } from "./safe-files.mjs";

export function createDetailPageCandidateAssetStore(options = {}) {
  const imageRunsDirectory = resolve(options.imageRunsDirectory ?? IMAGE_RUNS_DIR);
  const stagingDirectory = resolve(options.stagingDirectory ?? DETAIL_PAGE_CANDIDATE_ASSETS_DIR);
  const entries = new Map();

  return { stage, materialize, discard, close };

  async function stage(candidateId, image) {
    const reference = outputReference(image);
    const sourcePath = resolve(imageRunsDirectory, reference.relativePath);
    let opened;
    try {
      opened = await openContainedRegularFile(imageRunsDirectory, sourcePath);
      const assetId = randomUUID();
      const candidateDirectory = await ensureCandidateDirectory(candidateId);
      const stagedPath = join(candidateDirectory, `${assetId}-${reference.filename}`);
      await copyHandle(opened.handle, stagedPath);
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
    try {
      opened = await openContainedRegularFile(candidateDirectory, entry.stagedPath, { trustedRoot: stagingDirectory });
      const runId = randomUUID();
      const outputDirectory = join(imageRunsDirectory, runId);
      await mkdir(outputDirectory, { recursive: true, mode: 0o755 });
      const outputPath = join(outputDirectory, entry.filename);
      await copyHandle(opened.handle, outputPath);
      entries.delete(entryKey(candidateId, assetId));
      return {
        ...entry.image,
        url: `/outputs/image-runs/${runId}/${encodeURIComponent(entry.filename)}`,
      };
    } finally {
      await opened?.handle.close().catch(() => {});
    }
  }

  async function discard(candidateId) {
    const candidateDirectory = candidateDirectoryPath(candidateId);
    for (const [key, entry] of entries) {
      if (entry.candidateId === candidateId) entries.delete(key);
    }
    await rm(candidateDirectory, { recursive: true, force: true });
  }

  async function close() {
    const candidateIds = [...new Set([...entries.values()].map((entry) => entry.candidateId))];
    await Promise.all(candidateIds.map((candidateId) => discard(candidateId)));
  }

  async function ensureCandidateDirectory(candidateId) {
    const candidateDirectory = candidateDirectoryPath(candidateId);
    await mkdir(stagingDirectory, { recursive: true, mode: 0o700 });
    await mkdir(candidateDirectory, { recursive: true, mode: 0o700 });
    return candidateDirectory;
  }

  function candidateDirectoryPath(candidateId) {
    if (typeof candidateId !== "string" || !/^[0-9a-f-]{8,}$/iu.test(candidateId)) {
      throw new SafeFileBoundaryError("Candidate identifier is invalid");
    }
    return join(stagingDirectory, candidateId);
  }
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

function copyHandle(handle, outputPath) {
  return pipeline(
    handle.createReadStream({ autoClose: false }),
    createWriteStream(outputPath, { flags: "wx", mode: 0o600 }),
  );
}
