import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DetailPageDocumentValidationError } from "../lib/server/detail-page-document.mjs";
import {
  createDetailPageProjectStore,
  ProjectRevisionConflictError,
  ProjectStoreInvalidError,
} from "../lib/server/detail-page-projects.mjs";

const JOB_ID = "12345678-1234-4234-8234-123456789abc";
const RUN_ID = "87654321-4321-4321-8321-cba987654321";

test("Given a detail project store When revisions are saved concurrently Then writes are atomic and conflicts preserve data", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "store-maker-project-store-"));
  const directory = join(root, "projects");
  const imageRunsDirectory = join(root, "image-runs");
  const imageDirectory = join(imageRunsDirectory, RUN_ID);
  await mkdir(imageDirectory, { recursive: true });
  await writeFile(join(imageDirectory, "product.png"), "png");
  t.after(() => rm(root, { recursive: true, force: true }));

  const store = createDetailPageProjectStore({ directory, imageRunsDirectory });
  const created = await store.create(JOB_ID, documentWithHeading("최초 제목", { image: true }));
  assert.equal(created.revision, 1);
  assert.equal(created.id, JOB_ID);
  assert.equal(created.sourceJobId, JOB_ID);

  const updated = await store.save(JOB_ID, 1, documentWithHeading("저장된 제목", { image: true }));
  assert.equal(updated.revision, 2);
  assert.equal(updated.document.sections[0].heading, "저장된 제목");

  await assert.rejects(
    store.save(JOB_ID, 1, documentWithHeading("낡은 편집본", { image: true })),
    (error) => error instanceof ProjectRevisionConflictError && error.currentProject.revision === 2,
  );
  assert.equal((await store.get(JOB_ID)).document.sections[0].heading, "저장된 제목");

  const concurrent = await Promise.allSettled([
    store.save(JOB_ID, 2, documentWithHeading("동시 저장 A", { image: true })),
    store.save(JOB_ID, 2, documentWithHeading("동시 저장 B", { image: true })),
  ]);
  assert.equal(concurrent.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(concurrent.filter(({ status }) => status === "rejected").length, 1);
  assert.ok(concurrent.find(({ status }) => status === "rejected")?.reason instanceof ProjectRevisionConflictError);

  const reloaded = await createDetailPageProjectStore({ directory, imageRunsDirectory }).get(JOB_ID);
  assert.equal(reloaded.revision, 3);
  assert.ok(["동시 저장 A", "동시 저장 B"].includes(reloaded.document.sections[0].heading));
  assert.deepEqual((await readdir(directory)).filter((name) => name.includes(".tmp")), []);

  await assert.rejects(
    store.save(JOB_ID, 3, documentWithHeading("없는 이미지", { image: true, filename: "missing.png" })),
    DetailPageDocumentValidationError,
  );
  assert.equal((await store.get(JOB_ID)).revision, 3);

  await store.delete(JOB_ID);
  assert.equal(await store.get(JOB_ID), undefined);
});

test("Given corrupt project JSON When it is loaded Then corruption is distinct from a missing project", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "store-maker-project-corrupt-"));
  const directory = join(root, "projects");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${JOB_ID}.json`), "{not-json");
  t.after(() => rm(root, { recursive: true, force: true }));

  const store = createDetailPageProjectStore({ directory, imageRunsDirectory: join(root, "images") });
  await assert.rejects(store.get(JOB_ID), ProjectStoreInvalidError);
  assert.equal(await store.get("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), undefined);
});

test("Given a v1 project with an unknown section When it is opened Then the v2 fallback is reported without rewriting the saved revision", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "store-maker-project-v1-migration-"));
  const directory = join(root, "projects");
  const projectPath = join(directory, `${JOB_ID}.json`);
  await mkdir(directory, { recursive: true });
  const stored = {
    schemaVersion: 1,
    id: JOB_ID,
    sourceJobId: JOB_ID,
    revision: 7,
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:01:00.000Z",
    document: {
      schemaVersion: 1,
      title: "기존 상세페이지",
      productName: "기존 상품",
      markets: ["smartstore"],
      sections: [{ id: "legacy", kind: "future-widget", layout: "masonry", visible: true, heading: "기존 내용", body: "본문", bullets: [], source: "generated" }],
    },
  };
  await writeFile(projectPath, JSON.stringify(stored, null, 2));
  const before = await Promise.all([readFile(projectPath, "utf8"), stat(projectPath)]);
  t.after(() => rm(root, { recursive: true, force: true }));

  const project = await createDetailPageProjectStore({ directory, imageRunsDirectory: join(root, "image-runs") }).get(JOB_ID);
  const after = await Promise.all([readFile(projectPath, "utf8"), stat(projectPath)]);

  assert.equal(project.revision, 7);
  assert.equal(project.document.schemaVersion, 2);
  assert.equal(project.document.sections[0].kind, "free-text");
  assert.ok(project.migration.warnings.some((warning) => warning.code === "UNKNOWN_SECTION_KIND"));
  assert.equal(after[0], before[0]);
  assert.equal(after[1].mtimeMs, before[1].mtimeMs);
});

test("Given an existing nested image with an encoded space When a project is saved Then containment checks use the decoded safe path", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "store-maker-project-nested-image-"));
  const directory = join(root, "projects");
  const imageRunsDirectory = join(root, "image-runs");
  const nestedDirectory = join(imageRunsDirectory, RUN_ID, "nested");
  await mkdir(nestedDirectory, { recursive: true });
  await writeFile(join(nestedDirectory, "generated image.png"), "png");
  t.after(() => rm(root, { recursive: true, force: true }));

  const store = createDetailPageProjectStore({ directory, imageRunsDirectory });
  const nestedUrl = `/outputs/image-runs/${RUN_ID}/nested/generated%20image.png`;
  const document = documentWithHeading("중첩 이미지", { image: true, filename: "generated image.png", url: nestedUrl });
  const created = await store.create(JOB_ID, document);
  assert.equal(created.document.sections[0].image.url, nestedUrl);
  assert.equal((await store.save(JOB_ID, 1, document)).revision, 2);

  const traversal = documentWithHeading("경로 이탈", {
    image: true,
    filename: "secret.png",
    url: `/outputs/image-runs/${RUN_ID}/%2e%2e/secret.png`,
  });
  await assert.rejects(store.save(JOB_ID, 2, traversal), DetailPageDocumentValidationError);
  assert.equal((await store.get(JOB_ID)).revision, 2);
});

test("Given an output image symlink escaping image runs When a project is created Then validation rejects it", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "store-maker-project-symlink-"));
  const directory = join(root, "projects");
  const imageRunsDirectory = join(root, "image-runs");
  const imageDirectory = join(imageRunsDirectory, RUN_ID);
  const outsideImage = join(root, "outside.png");
  await mkdir(imageDirectory, { recursive: true });
  await writeFile(outsideImage, "outside");
  await symlink(outsideImage, join(imageDirectory, "linked.png"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const store = createDetailPageProjectStore({ directory, imageRunsDirectory });
  await assert.rejects(
    store.create(JOB_ID, documentWithHeading("외부 링크", { image: true, filename: "linked.png" })),
    DetailPageDocumentValidationError,
  );
});

test("Given a symlinked image-runs root or parent When a project is created Then validation rejects the capability escape", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "store-maker-project-root-symlink-"));
  const directTarget = join(root, "direct-target");
  const directLink = join(root, "direct-link");
  const parentTarget = join(root, "parent-target");
  const parentLink = join(root, "parent-link");
  const roots = [directLink, join(parentLink, "image-runs")];
  await mkdir(join(directTarget, RUN_ID), { recursive: true });
  await mkdir(join(parentTarget, "image-runs", RUN_ID), { recursive: true });
  await writeFile(join(directTarget, RUN_ID, "linked.png"), "outside");
  await writeFile(join(parentTarget, "image-runs", RUN_ID, "linked.png"), "outside");
  await symlink(directTarget, directLink);
  await symlink(parentTarget, parentLink);
  t.after(() => rm(root, { recursive: true, force: true }));

  for (const [index, imageRunsDirectory] of roots.entries()) {
    const store = createDetailPageProjectStore({ directory: join(root, `projects-${index}`), imageRunsDirectory });
    await assert.rejects(
      store.create(JOB_ID, documentWithHeading("루트 링크", { image: true, filename: "linked.png" })),
      DetailPageDocumentValidationError,
    );
  }
});

function documentWithHeading(heading, options = {}) {
  return {
    schemaVersion: 1,
    title: "테스트 상세페이지",
    productName: "테스트 상품",
    markets: ["smartstore"],
    sections: [{
      id: "section-one",
      kind: "hero",
      layout: options.image ? "full-bleed" : "text-only",
      visible: true,
      heading,
      body: "본문",
      bullets: [],
      ...(options.image ? { image: { id: "image-one", url: options.url ?? `/outputs/image-runs/${RUN_ID}/${options.filename ?? "product.png"}`, filename: options.filename ?? "product.png", alt: "대표", source: "generated" } } : {}),
      source: "user",
    }],
  };
}
