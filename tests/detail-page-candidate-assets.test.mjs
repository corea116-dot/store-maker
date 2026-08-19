import assert from "node:assert/strict";
import { link, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createDetailPageCandidateAssetStore } from "../lib/server/detail-page-candidate-assets.mjs";

const RUN_ID = "12345678-1234-4234-8234-123456789abc";
const CANDIDATE_ID = "12345678-1234-4234-8234-123456789abd";

test("Given a candidate image When it is staged and explicitly materialized Then the accepted image comes from a private snapshot, not the original public file", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "store-maker-candidate-assets-"));
  const imageRunsDirectory = join(root, "image-runs");
  const stagingDirectory = join(root, "candidate-staging");
  const sourceDirectory = join(imageRunsDirectory, RUN_ID);
  const sourcePath = join(sourceDirectory, "product.png");
  await mkdir(sourceDirectory, { recursive: true });
  await writeFile(sourcePath, "original-image-bytes");
  const assets = createDetailPageCandidateAssetStore({ imageRunsDirectory, stagingDirectory });
  t.after(() => rm(root, { recursive: true, force: true }));

  const staged = await assets.stage(CANDIDATE_ID, imageFixture());
  assert.equal(staged.previewUrl, imageFixture().url);
  assert.equal((await stat(stagingDirectory)).mode & 0o777, 0o700);
  await rm(sourcePath);

  const materialized = await assets.materialize(CANDIDATE_ID, staged.assetId);
  assert.notEqual(materialized.url, imageFixture().url);
  const outputPath = join(imageRunsDirectory, materialized.url.split("/").slice(3).map(decodeURIComponent).join("/"));
  assert.equal(await readFile(outputPath, "utf8"), "original-image-bytes");

  await assets.discard(CANDIDATE_ID);
  await assert.rejects(stat(join(stagingDirectory, CANDIDATE_ID)), { code: "ENOENT" });
  await assert.rejects(stat(outputPath), { code: "ENOENT" });
});

test("Given a hard-linked candidate image When staging is attempted Then the containment boundary rejects the alias", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "store-maker-candidate-hardlink-"));
  const imageRunsDirectory = join(root, "image-runs");
  const stagingDirectory = join(root, "candidate-staging");
  const sourceDirectory = join(imageRunsDirectory, RUN_ID);
  const sourcePath = join(sourceDirectory, "product.png");
  await mkdir(sourceDirectory, { recursive: true });
  await writeFile(sourcePath, "shared-image-bytes");
  await link(sourcePath, join(sourceDirectory, "linked.png"));
  const assets = createDetailPageCandidateAssetStore({ imageRunsDirectory, stagingDirectory });
  t.after(() => rm(root, { recursive: true, force: true }));

  await assert.rejects(assets.stage(CANDIDATE_ID, imageFixture()), /hard link|safely readable/u);
});

test("Given a symlinked candidate staging directory When an image is staged Then the destination boundary rejects the escape", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "store-maker-candidate-staging-link-"));
  const imageRunsDirectory = join(root, "image-runs");
  const stagingDirectory = join(root, "candidate-staging");
  const sourceDirectory = join(imageRunsDirectory, RUN_ID);
  await mkdir(sourceDirectory, { recursive: true });
  await mkdir(stagingDirectory, { recursive: true });
  await writeFile(join(sourceDirectory, "product.png"), "image");
  await symlink(join(root, "outside"), join(stagingDirectory, CANDIDATE_ID));
  const assets = createDetailPageCandidateAssetStore({ imageRunsDirectory, stagingDirectory });
  t.after(() => rm(root, { recursive: true, force: true }));

  await assert.rejects(assets.stage(CANDIDATE_ID, imageFixture()), /symbolic link|safely writable/u);
});

test("Given the image output root is replaced with a symlink after staging When an image is materialized Then the destination boundary rejects the escape", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "store-maker-candidate-output-link-"));
  const imageRunsDirectory = join(root, "image-runs");
  const stagingDirectory = join(root, "candidate-staging");
  const sourceDirectory = join(imageRunsDirectory, RUN_ID);
  await mkdir(sourceDirectory, { recursive: true });
  await writeFile(join(sourceDirectory, "product.png"), "image");
  const assets = createDetailPageCandidateAssetStore({ imageRunsDirectory, stagingDirectory });
  t.after(() => rm(root, { recursive: true, force: true }));

  const staged = await assets.stage(CANDIDATE_ID, imageFixture());
  await rm(imageRunsDirectory, { recursive: true, force: true });
  await mkdir(join(root, "outside"));
  await symlink(join(root, "outside"), imageRunsDirectory);
  await assert.rejects(assets.materialize(CANDIDATE_ID, staged.assetId), /symbolic link|safely writable/u);
});

function imageFixture() {
  return {
    id: "candidate-image",
    url: `/outputs/image-runs/${RUN_ID}/product.png`,
    filename: "product.png",
    alt: "상품 이미지",
    source: "generated",
  };
}
