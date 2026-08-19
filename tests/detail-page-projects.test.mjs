import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createServer } from "../server.mjs";

const JOB_ID = "12345678-1234-4234-8234-123456789abc";

test("Given a completed detail-page job When its project API is edited Then save, restart, conflict, validation, and delete semantics hold", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "store-maker-project-api-"));
  const projectDirectory = join(root, "projects");
  const jobStateFile = join(root, "jobs.json");
  t.after(() => rm(root, { recursive: true, force: true }));

  let running = await startApp({ projectDirectory, jobStateFile });
  try {
    const started = await requestJson(running.baseUrl, "/api/generate-jobs", {
      method: "POST",
      body: generationBody(),
      token: running.token,
    });
    const job = await waitForJob(running, started.payload.job.id, "completed");
    assert.ok(job.result.result.detailPageDocument);

    const opened = await requestJson(running.baseUrl, `/api/detail-page-projects/${job.id}`, { token: running.token });
    assert.equal(opened.status, 200);
    assert.equal(opened.payload.project.revision, 1);
    assert.match(opened.payload.preview.html, /detail-page-document/u);

    const editedDocument = structuredClone(opened.payload.project.document);
    editedDocument.sections[0].heading = "사용자가 저장한 제목";
    const saved = await requestJson(running.baseUrl, `/api/detail-page-projects/${job.id}`, {
      method: "PUT",
      body: { expectedRevision: 1, document: editedDocument },
      token: running.token,
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.payload.project.revision, 2);
    assert.match(saved.payload.exports.markdown, /사용자가 저장한 제목/u);
    assert.equal(saved.payload.exports.json.project.revision, 2);

    const stale = await requestJson(running.baseUrl, `/api/detail-page-projects/${job.id}`, {
      method: "PUT",
      body: { expectedRevision: 1, document: { ...editedDocument, title: "덮어쓰면 안 됨" } },
      token: running.token,
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.payload.error.code, "REVISION_CONFLICT");
    assert.equal(stale.payload.currentRevision, 2);

    const invalidDocument = structuredClone(editedDocument);
    invalidDocument.sections.forEach((section) => { section.visible = false; });
    const invalid = await requestJson(running.baseUrl, `/api/detail-page-projects/${job.id}`, {
      method: "PUT",
      body: { expectedRevision: 2, document: invalidDocument },
      token: running.token,
    });
    assert.equal(invalid.status, 422);
    assert.equal(invalid.payload.error.code, "INVALID_DETAIL_PAGE_DOCUMENT");

    await waitForFile(jobStateFile, job.id);
    await closeApp(running.app);
    running = await startApp({ projectDirectory, jobStateFile });
    const restored = await requestJson(running.baseUrl, `/api/detail-page-projects/${job.id}`, { token: running.token });
    assert.equal(restored.status, 200);
    assert.equal(restored.payload.project.revision, 2);
    assert.equal(restored.payload.project.document.sections[0].heading, "사용자가 저장한 제목");

    await writeFile(join(projectDirectory, `${job.id}.json`), "{broken-json");
    const corrupt = await requestJson(running.baseUrl, `/api/detail-page-projects/${job.id}`, { token: running.token });
    assert.equal(corrupt.status, 409);
    assert.equal(corrupt.payload.error.code, "PROJECT_RECOVERY_REQUIRED");
    assert.match(corrupt.payload.recovery.expectedCorruptSha256, /^[0-9a-f]{64}$/u);

    const staleRecovery = await requestJson(running.baseUrl, `/api/detail-page-projects/${job.id}/recover`, {
      method: "POST",
      body: { expectedCorruptSha256: "0".repeat(64) },
      token: running.token,
    });
    assert.equal(staleRecovery.status, 409);
    assert.equal(staleRecovery.payload.error.code, "CORRUPT_PROJECT_CHANGED");

    const recovered = await requestJson(running.baseUrl, `/api/detail-page-projects/${job.id}/recover`, {
      method: "POST",
      body: { expectedCorruptSha256: corrupt.payload.recovery.expectedCorruptSha256 },
      token: running.token,
    });
    assert.equal(recovered.status, 200);
    assert.equal(recovered.payload.project.revision, 1);
    const preservedRaw = (await readdir(projectDirectory)).find((name) => name.includes(`${job.id}.json.corrupt-`));
    assert.ok(preservedRaw);
    assert.equal(await readFile(join(projectDirectory, preservedRaw), "utf8"), "{broken-json");

    const deleted = await requestJson(running.baseUrl, `/api/generate-jobs/${job.id}/delete`, {
      method: "POST",
      body: {},
      token: running.token,
    });
    assert.equal(deleted.status, 200);
    const missingAfterDelete = await requestJson(running.baseUrl, `/api/detail-page-projects/${job.id}`, { token: running.token });
    assert.equal(missingAfterDelete.status, 404);
    await assert.rejects(readFile(join(projectDirectory, `${job.id}.json`), "utf8"), { code: "ENOENT" });
  } finally {
    await closeApp(running.app);
  }
});

test("Given missing, unauthorized, active, and ad-set jobs When project GET runs Then boundary status codes remain explicit", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "store-maker-project-boundary-"));
  const running = await startApp({ projectDirectory: join(root, "projects"), jobStateFile: join(root, "jobs.json") });
  t.after(async () => {
    await closeApp(running.app);
    await rm(root, { recursive: true, force: true });
  });

  const missing = await requestJson(running.baseUrl, `/api/detail-page-projects/${JOB_ID}`, { token: running.token });
  assert.equal(missing.status, 404);
  const forbidden = await requestJson(running.baseUrl, `/api/detail-page-projects/${JOB_ID}`);
  assert.equal(forbidden.status, 403);

  const slow = await requestJson(running.baseUrl, "/api/generate-jobs", {
    method: "POST",
    token: running.token,
    body: generationBody(`${process.execPath} -e "setTimeout(()=>process.stdout.write('# 완료'),800)"`),
  });
  const incomplete = await requestJson(running.baseUrl, `/api/detail-page-projects/${slow.payload.job.id}`, { token: running.token });
  assert.equal(incomplete.status, 409);
  assert.equal(incomplete.payload.error.code, "JOB_NOT_COMPLETE");
  await requestJson(running.baseUrl, `/api/generate-jobs/${slow.payload.job.id}/cancel`, { method: "POST", body: {}, token: running.token });

  const adStarted = await requestJson(running.baseUrl, "/api/generate-jobs", {
    method: "POST",
    token: running.token,
    body: { ...generationBody(), generationMode: "ad-set", brand: {}, adAutomation: {} },
  });
  const adJob = await waitForJob(running, adStarted.payload.job.id, "completed");
  const unsupported = await requestJson(running.baseUrl, `/api/detail-page-projects/${adJob.id}`, { token: running.token });
  assert.equal(unsupported.status, 422);
  assert.equal(unsupported.payload.error.code, "UNSUPPORTED_GENERATION_MODE");
});

function generationBody(command = `${process.execPath} scripts/mock-engine.mjs`) {
  return {
    engine: { mode: "local-cli", engineId: "custom", command, model: "mock", promptTransport: "stdin" },
    product: { name: "저소음 키보드", description: "사무실용 키보드", requirements: "저소음과 한글 각인 강조" },
    markets: ["smartstore"],
  };
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

async function waitForFile(path, expected) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      if ((await readFile(path, "utf8")).includes(expected)) return;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  assert.fail(`file ${path} was not persisted`);
}
