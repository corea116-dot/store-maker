import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

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

async function createCompletedDetailPageJob(running) {
  const started = await requestJson(running.baseUrl, "/api/generate-jobs", {
    method: "POST",
    token: running.token,
    body: {
      engine: { mode: "local-cli", engineId: "custom", command: `${process.execPath} scripts/mock-engine.mjs`, model: "mock", promptTransport: "stdin" },
      product: { name: "저소음 키보드", description: "사무실용 키보드", requirements: "저소음과 한글 각인 강조" },
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
