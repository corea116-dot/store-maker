import assert from "node:assert/strict";
import test from "node:test";
import { getDetailPageProjectResponse } from "../lib/server/detail-page-project-api.mjs";

const projectId = "12345678-1234-1234-1234-123456789abc";
const generatedUrl = `/outputs/image-runs/${projectId}/generated.png`;
const editedUrl = `/outputs/image-runs/${projectId}/edited.png`;

test("Given a saved edited image When a project is reloaded Then the asset library includes it once beside generated outputs", async () => {
  const response = await getDetailPageProjectResponse(projectId, dependencies({
    sections: [
      section("hero", { url: editedUrl, source: "edited", filename: "edited.png" }),
      section("feature", { url: editedUrl, source: "edited", filename: "edited.png" }),
    ],
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(response.payload.assets.map(({ url }) => url), [generatedUrl, editedUrl]);
  assert.equal(response.payload.assets.filter(({ url }) => url === editedUrl).length, 1);
});

test("Given a saved project with an invalid edited image reference When it is reloaded Then the invalid asset is excluded", async () => {
  const response = await getDetailPageProjectResponse(projectId, dependencies({
    sections: [
      section("hero", { url: editedUrl, source: "edited", filename: "edited.png" }),
    ],
    generatedFiles: [
      { url: generatedUrl, filename: "generated.png", purpose: "생성 이미지" },
      { url: "https://attacker.example/edited.png", filename: "edited.png" },
      { url: "/outputs/image-runs/../../secret.png", filename: "secret.png" },
    ],
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(response.payload.assets.map(({ url }) => url), [generatedUrl, editedUrl]);
});

test("Given a generated image in a nested output folder When a project is reloaded Then the reusable asset remains available", async () => {
  const nestedUrl = `/outputs/image-runs/${projectId}/nested/generated%20image.png`;
  const response = await getDetailPageProjectResponse(projectId, dependencies({
    sections: [section("hero", { url: editedUrl, source: "edited", filename: "edited.png" })],
    generatedFiles: [{ url: nestedUrl, filename: "nested/generated image.png", purpose: "생성 이미지" }],
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(response.payload.assets.map(({ url }) => url), [nestedUrl, editedUrl]);
});

function dependencies({ sections, generatedFiles = [{ url: generatedUrl, filename: "generated.png", purpose: "생성 이미지" }] }) {
  return {
    jobs: { get: async () => ({ status: "completed", result: { result: { images: { files: generatedFiles } } } }) },
    projects: { get: async () => ({ id: projectId, revision: 2, document: documentWith(sections) }) },
  };
}

function documentWith(sections) {
  return {
    schemaVersion: 1,
    title: "상세페이지",
    productName: "상품",
    markets: ["smartstore"],
    sections,
  };
}

function section(kind, image) {
  return {
    id: `${kind}-${image.filename}`,
    kind,
    layout: "text-only",
    visible: true,
    heading: kind,
    body: "본문",
    bullets: [],
    source: "generated",
    image: { id: `${kind}-${image.filename}`, alt: image.filename, ...image },
  };
}
