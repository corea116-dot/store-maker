import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createServer } from "../server.mjs";

test("Given a completed job When project cleanup fails Then deletion reports failure and preserves the job", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "store-maker-project-delete-"));
  const projectDirectory = join(root, "projects");
  const jobStateFile = join(root, "jobs.json");
  const app = createServer({ projectDirectory, jobStateFile });
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  const baseUrl = `http://127.0.0.1:${app.address().port}`;
  const token = (await (await fetch(baseUrl)).text()).match(/<meta name="store-maker-token" content="([^"]+)"/u)?.[1];
  assert.ok(token);
  t.after(async () => {
    await new Promise((resolveClose) => app.close(resolveClose));
    await rm(root, { recursive: true, force: true });
  });

  const started = await requestJson(baseUrl, "/api/generate-jobs", {
    method: "POST",
    token,
    body: generationBody(),
  });
  const job = await waitForJob(baseUrl, token, started.payload.job.id, "completed");
  const projectPath = join(projectDirectory, `${job.id}.json`);
  const project = await requestJson(baseUrl, `/api/detail-page-projects/${job.id}`, { token });
  assert.equal(project.status, 200);

  await rm(projectPath);
  await mkdir(projectPath);

  const deleted = await requestJson(baseUrl, `/api/generate-jobs/${job.id}/delete`, {
    method: "POST",
    token,
    body: {},
  });
  assert.equal(deleted.status, 500);
  assert.equal(deleted.payload.ok, false);
  assert.equal(deleted.payload.error.code, "PROJECT_DELETE_FAILED");
  assert.match(deleted.payload.error.message, /delete detail page project/u);
  const preserved = await requestJson(baseUrl, `/api/generate-jobs/${job.id}`, { token });
  assert.equal(preserved.status, 200);
  assert.equal(preserved.payload.job.id, job.id);
  assert.equal(preserved.payload.job.status, "completed");
  await assert.rejects(readFile(projectPath, "utf8"), { code: "EISDIR" });
});

test("Given an active job When deletion is requested Then the job remains active and the route returns conflict", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "store-maker-active-delete-"));
  const app = createServer({ projectDirectory: join(root, "projects"), jobStateFile: join(root, "jobs.json") });
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  const baseUrl = `http://127.0.0.1:${app.address().port}`;
  const token = (await (await fetch(baseUrl)).text()).match(/<meta name="store-maker-token" content="([^"]+)"/u)?.[1];
  assert.ok(token);
  t.after(async () => {
    await new Promise((resolveClose) => app.close(resolveClose));
    await rm(root, { recursive: true, force: true });
  });

  const started = await requestJson(baseUrl, "/api/generate-jobs", {
    method: "POST",
    token,
    body: generationBody(`${process.execPath} -e "setTimeout(()=>process.stdout.write('# 완료'),800)"`),
  });
  const deleted = await requestJson(baseUrl, `/api/generate-jobs/${started.payload.job.id}/delete`, {
    method: "POST",
    token,
    body: {},
  });
  assert.equal(deleted.status, 409);
  assert.equal(deleted.payload.error.code, "JOB_ACTIVE");
  const preserved = await requestJson(baseUrl, `/api/generate-jobs/${started.payload.job.id}`, { token });
  assert.ok(["queued", "running"].includes(preserved.payload.job.status));
  await requestJson(baseUrl, `/api/generate-jobs/${started.payload.job.id}/cancel`, { method: "POST", token, body: {} });
  await waitForJob(baseUrl, token, started.payload.job.id, "cancelled");
});

function generationBody(command = `${process.execPath} scripts/mock-engine.mjs`) {
  return {
    engine: { mode: "local-cli", engineId: "custom", command, model: "mock", promptTransport: "stdin" },
    product: { name: "저소음 키보드", description: "사무실용 키보드", requirements: "저소음과 한글 각인 강조" },
    markets: ["smartstore"],
  };
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

async function waitForJob(baseUrl, token, id, status) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const response = await requestJson(baseUrl, `/api/generate-jobs/${id}`, { token });
    if (response.payload.job?.status === status) return response.payload.job;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 40));
  }
  assert.fail(`job ${id} did not reach ${status}`);
}
