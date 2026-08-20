import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { applyCandidateToDocument } from "../assets/detail-page-builder-state.js";
import { createServer } from "../server.mjs";

test("Given a completed detail-page project When a builder candidate is requested Then the authenticated API returns a non-persistent, revision-bound proposal", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "store-maker-builder-api-"));
  const running = await startApp({ projectDirectory: join(root, "projects"), jobStateFile: join(root, "jobs.json") });
  t.after(async () => {
    await closeApp(running.app);
    await rm(root, { recursive: true, force: true });
  });

  const forbidden = await requestJson(running.baseUrl, "/api/detail-page-builder/registry");
  assert.equal(forbidden.status, 403);

  const registry = await requestJson(running.baseUrl, "/api/detail-page-builder/registry", { token: running.token });
  assert.equal(registry.status, 200);
  assert.equal(registry.payload.sectionTypes.length, 19);
  assert.ok(registry.payload.sectionTypes.some((type) => type.key === "comparison"));

  const job = await createCompletedDetailPageJob(running);
  const before = await requestJson(running.baseUrl, `/api/detail-page-projects/${job.id}`, { token: running.token });
  assert.equal(before.status, 200);
  assert.equal(before.payload.project.revision, 1);

  const started = await requestJson(running.baseUrl, `/api/detail-page-projects/${job.id}/builder-candidates`, {
    method: "POST",
    token: running.token,
    body: {
      operation: "template",
      category: "electronics",
      selectedTemplateSectionIds: ["template-1-hero", "template-4-specifications"],
    },
  });
  assert.equal(started.status, 202);
  assert.equal(started.payload.candidate.status, "ready");
  assert.equal(started.payload.candidate.baseRevision, 1);
  assert.deepEqual(started.payload.candidate.proposedSections.map(({ kind }) => kind), ["hero", "specifications"]);

  const fetched = await requestJson(running.baseUrl, `/api/detail-page-projects/${job.id}/builder-candidates/${started.payload.candidate.candidateId}`, { token: running.token });
  assert.equal(fetched.status, 200);
  assert.equal(fetched.payload.candidate.candidateId, started.payload.candidate.candidateId);

  const after = await requestJson(running.baseUrl, `/api/detail-page-projects/${job.id}`, { token: running.token });
  assert.equal(after.status, 200);
  assert.equal(after.payload.project.revision, 1);
  assert.deepEqual(after.payload.project.document, before.payload.project.document);
});

test("Given a completed job without an opened project When a candidate is requested Then the builder does not create a seller document", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "store-maker-builder-no-lazy-project-"));
  const projectDirectory = join(root, "projects");
  const running = await startApp({ projectDirectory, jobStateFile: join(root, "jobs.json") });
  t.after(async () => {
    await closeApp(running.app);
    await rm(root, { recursive: true, force: true });
  });

  const job = await createCompletedDetailPageJob(running);
  const candidate = await requestJson(running.baseUrl, `/api/detail-page-projects/${job.id}/builder-candidates`, {
    method: "POST",
    token: running.token,
    body: { operation: "add", source: "registry", typeKey: "faq" },
  });

  assert.equal(candidate.status, 404);
  assert.equal(candidate.payload.error.code, "PROJECT_UNAVAILABLE");
  await assert.rejects(stat(join(projectDirectory, `${job.id}.json`)), { code: "ENOENT" });
});

test("Given an unrelated persisted revision When candidate acceptance is acknowledged Then the HTTP API rejects it without a matching receipt", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "store-maker-builder-receipt-"));
  const running = await startApp({ projectDirectory: join(root, "projects"), jobStateFile: join(root, "jobs.json") });
  t.after(async () => {
    await closeApp(running.app);
    await rm(root, { recursive: true, force: true });
  });

  const job = await createCompletedDetailPageJob(running);
  const opened = await requestJson(running.baseUrl, `/api/detail-page-projects/${job.id}`, { token: running.token });
  const started = await requestJson(running.baseUrl, `/api/detail-page-projects/${job.id}/builder-candidates`, {
    method: "POST",
    token: running.token,
    body: { operation: "add", source: "registry", typeKey: "faq", afterSectionId: opened.payload.project.document.sections[0].id },
  });
  const candidate = started.payload.candidate;
  const receipt = candidateReceipt(opened.payload.project.document, candidate);
  const unrelatedDocument = structuredClone(opened.payload.project.document);
  unrelatedDocument.sections[0].heading = "후보와 무관한 저장";
  const saved = await requestJson(running.baseUrl, `/api/detail-page-projects/${job.id}`, {
    method: "PUT",
    token: running.token,
    body: { expectedRevision: opened.payload.project.revision, document: unrelatedDocument },
  });
  assert.equal(saved.status, 200);

  const missing = await requestJson(running.baseUrl, `/api/detail-page-projects/${job.id}/builder-candidates/${candidate.candidateId}/accept`, {
    method: "POST",
    token: running.token,
    body: {},
  });
  assert.equal(missing.status, 422);
  assert.equal(missing.payload.error.code, "INVALID_CANDIDATE_RECEIPT");

  const rejected = await requestJson(running.baseUrl, `/api/detail-page-projects/${job.id}/builder-candidates/${candidate.candidateId}/accept`, {
    method: "POST",
    token: running.token,
    body: { receipt },
  });
  assert.equal(rejected.status, 422);
  assert.equal(rejected.payload.error.code, "CANDIDATE_NOT_APPLIED");
});

test("Given supporting material from generation input When a factual candidate is retried Then fabricated evidence stays blocked and its registered source can be selected", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "store-maker-builder-evidence-"));
  const running = await startApp({ projectDirectory: join(root, "projects"), jobStateFile: join(root, "jobs.json") });
  t.after(async () => {
    await closeApp(running.app);
    await rm(root, { recursive: true, force: true });
  });

  const job = await createCompletedDetailPageJob(running, {
    attachments: [{ name: "reviews.csv", type: "text/csv", size: 128, role: "supporting-material", textPreview: "구매자 A: 사무실에서 조용하게 쓸 수 있었어요." }],
  });
  const opened = await requestJson(running.baseUrl, `/api/detail-page-projects/${job.id}`, { token: running.token });
  assert.deepEqual(opened.payload.evidenceSources, [{
    id: "supporting-material:0:reviews.csv",
    label: "reviews.csv",
    kind: "supporting-material",
    available: true,
    excerpt: "구매자 A: 사무실에서 조용하게 쓸 수 있었어요.",
  }]);

  const fabricated = await requestJson(running.baseUrl, `/api/detail-page-projects/${job.id}/builder-candidates`, {
    method: "POST",
    token: running.token,
    body: { operation: "add", source: "registry", typeKey: "reviews", evidenceRefs: ["실제 후기 원본 #1"] },
  });
  const verified = await requestJson(running.baseUrl, `/api/detail-page-projects/${job.id}/builder-candidates`, {
    method: "POST",
    token: running.token,
    body: { operation: "add", source: "registry", typeKey: "reviews", evidenceRefs: ["supporting-material:0:reviews.csv"] },
  });

  assert.equal(fabricated.payload.candidate.canApply, false);
  assert.equal(verified.payload.candidate.canApply, true);
  assert.deepEqual(verified.payload.candidate.evidence.refs, ["supporting-material:0:reviews.csv"]);
});

test("Given an image-bearing AI candidate When explicit materialization is requested Then only its private snapshot is promoted and the project stays unchanged", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "store-maker-builder-materialize-"));
  const imageRunsDirectory = join(root, "image-runs");
  const candidateAssetsDirectory = join(root, "candidate-assets");
  const sourceRunId = "12345678-1234-4234-8234-123456789abd";
  const sourceDirectory = join(imageRunsDirectory, sourceRunId);
  const sourcePath = join(sourceDirectory, "candidate.png");
  await mkdir(sourceDirectory, { recursive: true });
  await writeFile(sourcePath, "candidate-snapshot");
  const output = {
    type: "free-image",
    heading: "AI 이미지 후보",
    body: "",
    bullets: [],
    layout: "full-bleed",
    image: {
      id: "candidate-image",
      url: `/outputs/image-runs/${sourceRunId}/candidate.png`,
      filename: "candidate.png",
      alt: "후보 이미지",
      source: "generated",
    },
  };
  const running = await startApp({
    projectDirectory: join(root, "projects"),
    jobStateFile: join(root, "jobs.json"),
    imageRunsDirectory,
    candidateAssetsDirectory,
    runEngine: async () => ({ ok: true, output: JSON.stringify(output), logs: [] }),
  });
  t.after(async () => {
    await closeApp(running.app);
    await rm(root, { recursive: true, force: true });
  });

  const job = await createCompletedDetailPageJob(running);
  const opened = await requestJson(running.baseUrl, `/api/detail-page-projects/${job.id}`, { token: running.token });
  assert.equal(opened.status, 200);
  const started = await requestJson(running.baseUrl, `/api/detail-page-projects/${job.id}/builder-candidates`, {
    method: "POST",
    token: running.token,
    body: {
      operation: "add",
      source: "instruction",
      instruction: "이미지 중심 섹션을 만들어 주세요.",
      engine: { mode: "local-cli", engineId: "custom", command: `${process.execPath} scripts/mock-engine.mjs`, promptTransport: "stdin" },
    },
  });
  assert.equal(started.status, 202);
  const candidate = await waitForCandidate(running, job.id, started.payload.candidate.candidateId, "ready");
  assert.equal(candidate.stagedAssets.length, 1);
  await rm(sourcePath);

  const materialized = await requestJson(running.baseUrl, `/api/detail-page-projects/${job.id}/builder-candidates/${candidate.candidateId}/materialize`, {
    method: "POST",
    token: running.token,
    body: {},
  });
  assert.equal(materialized.status, 200);
  const image = materialized.payload.candidate.proposedSections[0].image;
  assert.notEqual(image.url, output.image.url);
  const outputPath = join(imageRunsDirectory, image.url.split("/").slice(3).map(decodeURIComponent).join("/"));
  assert.equal(await readFile(outputPath, "utf8"), "candidate-snapshot");
  await assert.rejects(stat(join(candidateAssetsDirectory, candidate.candidateId)), { code: "ENOENT" });

  const project = await requestJson(running.baseUrl, `/api/detail-page-projects/${job.id}`, { token: running.token });
  assert.equal(project.payload.project.revision, 1);
  assert.equal(project.payload.project.document.sections.some((section) => section.heading === "AI 이미지 후보"), false);

  const cancelled = await requestJson(running.baseUrl, `/api/detail-page-projects/${job.id}/builder-candidates/${candidate.candidateId}`, {
    method: "DELETE",
    token: running.token,
    body: {},
  });
  assert.equal(cancelled.status, 200);
  await assert.rejects(stat(outputPath), { code: "ENOENT" });
});

async function createCompletedDetailPageJob(running, productOverrides = {}) {
  const started = await requestJson(running.baseUrl, "/api/generate-jobs", {
    method: "POST",
    token: running.token,
    body: {
      engine: { mode: "local-cli", engineId: "custom", command: `${process.execPath} scripts/mock-engine.mjs`, model: "mock", promptTransport: "stdin" },
      product: { name: "저소음 키보드", description: "사무실용 키보드", requirements: "저소음과 한글 각인 강조", ...productOverrides },
      markets: ["smartstore"],
    },
  });
  assert.equal(started.status, 202);
  return waitForJob(running, started.payload.job.id, "completed");
}

async function startApp(options) {
  const app = createServer(options);
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  const address = app.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const html = await (await fetch(baseUrl)).text();
  const token = html.match(/<meta name="store-maker-token" content="([^"]+)"/u)?.[1];
  assert.ok(token);
  return { app, baseUrl, token };
}

async function closeApp(app) {
  if (!app.listening) return;
  await new Promise((resolveClose) => app.close(resolveClose));
}

async function requestJson(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.token ? { "x-store-maker-token": options.token } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  return { status: response.status, payload: await response.json() };
}

async function waitForJob(running, id, status) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const response = await requestJson(running.baseUrl, `/api/generate-jobs/${id}`, { token: running.token });
    if (response.payload.job?.status === status) return response.payload.job;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 40));
  }
  assert.fail(`job ${id} did not reach ${status}`);
}

async function waitForCandidate(running, projectId, candidateId, status) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const response = await requestJson(running.baseUrl, `/api/detail-page-projects/${projectId}/builder-candidates/${candidateId}`, { token: running.token });
    if (response.payload.candidate?.status === status) return response.payload.candidate;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
  }
  assert.fail(`candidate ${candidateId} did not reach ${status}`);
}

function candidateReceipt(documentValue, candidate) {
  const authority = {
    candidateId: candidate.candidateId,
    requestToken: candidate.requestToken,
    projectId: candidate.projectId,
    revision: candidate.baseRevision,
    sessionId: 1,
    documentVersion: 1,
  };
  const applied = applyCandidateToDocument(documentValue, candidate, authority, authority);
  assert.equal(applied.ok, true);
  return {
    version: 1,
    candidateId: candidate.candidateId,
    requestToken: candidate.requestToken,
    baseRevision: candidate.baseRevision,
    savedRevision: candidate.baseRevision + 1,
    operation: candidate.operation,
    application: applied.application,
  };
}
