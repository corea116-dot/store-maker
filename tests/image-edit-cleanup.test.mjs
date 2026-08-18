import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { editGeneratedImage } from "../lib/server/image-edit.mjs";

test("Given generation and source cleanup both fail When an image edit runs Then both failures remain observable", async (t) => {
  const fixture = await imageFixture(t);
  const result = await editGeneratedImage(editBody(fixture.runId), {
    imageRunsDirectory: fixture.imageRunsDirectory,
    imageUploadsDirectory: fixture.imageUploadsDirectory,
    generateImages: async () => { throw new Error("generation failure"); },
    removeStagingDirectory: async () => { throw new Error("cleanup failure"); },
  });

  assert.equal(result.ok, false);
  assert.equal(result.httpStatus, 500);
  assert.equal(result.error.code, "IMAGE_EDIT_FAILED");
  assert.ok(result.logs.some((entry) => entry.title === "image edit failed"));
  assert.ok(result.logs.some((entry) => entry.title === "image edit source cleanup failed"));
});

test("Given snapshot and partial cleanup both fail When an image source is staged Then cleanup evidence is retained", async (t) => {
  const fixture = await imageFixture(t);
  const result = await editGeneratedImage(editBody(fixture.runId), {
    imageRunsDirectory: fixture.imageRunsDirectory,
    imageUploadsDirectory: fixture.imageUploadsDirectory,
    writeSourceSnapshot: async () => { throw new Error("snapshot failure"); },
    removeStagingDirectory: async () => { throw new Error("cleanup failure"); },
  });

  assert.equal(result.ok, false);
  assert.equal(result.httpStatus, 500);
  assert.equal(result.error.code, "IMAGE_EDIT_SOURCE_FAILED");
  assert.ok(result.logs.some((entry) => entry.title === "image edit source cleanup failed"));
});

async function imageFixture(t) {
  const root = await mkdtemp(join(tmpdir(), "store-maker-image-cleanup-"));
  const runId = randomUUID();
  const imageRunsDirectory = join(root, "image-runs");
  const imageUploadsDirectory = join(root, "uploads");
  await mkdir(join(imageRunsDirectory, runId), { recursive: true });
  await writeFile(
    join(imageRunsDirectory, runId, "source.png"),
    Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=", "base64"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, runId, imageRunsDirectory, imageUploadsDirectory };
}

function editBody(runId) {
  return {
    engine: {
      mode: "local-cli",
      engineId: "custom",
      command: `${process.execPath} scripts/mock-engine.mjs`,
      model: "mock",
    },
    imageGeneration: {
      provider: "codex-imagegen",
      command: "./scripts/fake-codex-imagegen.mjs",
      imageCount: 1,
      ratio: "1:1",
      style: "제품 단독컷",
      background: "흰 배경",
      useReference: true,
      timeoutMs: 2000,
    },
    imageEdit: {
      instruction: "정리 실패 증거를 보존",
      source: { url: `/outputs/image-runs/${runId}/source.png` },
    },
    product: {
      name: "이미지 정리 검증 상품",
      description: "이미지 수정 실패 경로 검증",
      requirements: "실패 증거 보존",
    },
    markets: ["smartstore"],
  };
}
