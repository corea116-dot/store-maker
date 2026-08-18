import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
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
      ...(options.image ? { image: { id: "image-one", url: `/outputs/image-runs/${RUN_ID}/${options.filename ?? "product.png"}`, filename: options.filename ?? "product.png", alt: "대표", source: "generated" } } : {}),
      source: "user",
    }],
  };
}
