import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createServer } from "../server.mjs";
import { createBrandKitStore } from "../lib/server/brand-kit-store.mjs";
import { resolveBrandKitSelection } from "../lib/server/brand-kit-resolver.mjs";
import { createGenerationJobManager } from "../lib/server/jobs.mjs";

test("all generation endpoints reject stale and invalid selections before accepting work", async (t) => {
  // Given: a committed brand kit at revision 1 and a real in-process HTTP server.
  const env = await testEnvironment(t);
  const created = await env.store.create({ kit: kitInput("고정 키트") });
  const counter = join(env.root, "invocations.txt");
  const executable = join(env.root, "counter-engine.mjs");
  await writeFile(executable, "import { appendFileSync } from 'node:fs'; appendFileSync(process.argv[2], 'called\\n'); process.stdout.write('# output');", "utf8");
  const payload = generationPayload({ enabled: true, id: created.kit.id, expectedRevision: 99, overrides: {} });
  payload.engine.command = `${process.execPath} ${executable} ${counter}`;

  // When: the client submits stale selections to every generation endpoint.
  const responses = [];
  for (const path of ["/api/generate-jobs", "/api/generate", "/api/engines/invoke", "/api/generate-stream"]) {
    responses.push(await env.post(path, payload));
  }

  // Then: no job or provider invocation exists and even stream returned JSON before NDJSON headers.
  for (const response of responses) {
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, "BRAND_KIT_CHANGED");
    assert.match(response.contentType, /^application\/json/u);
  }
  assert.deepEqual((await env.get("/api/generate-jobs")).body.jobs, []);
  await assert.rejects(readFile(counter), { code: "ENOENT" });

  const invalid = generationPayload({ enabled: true, id: created.kit.id, expectedRevision: 1, overrides: { imageStyle: "<script>bad</script>" } });
  for (const path of ["/api/generate-jobs", "/api/generate", "/api/engines/invoke", "/api/generate-stream"]) {
    const response = await env.post(path, invalid);
    assert.equal(response.status, 422, path);
    assert.equal(response.body.error.code, "VALIDATION_ERROR", path);
  }
  const malformed = await env.post("/api/generate-jobs", generationPayload(["not", "an", "object"]));
  assert.equal(malformed.status, 422);
  assert.equal(malformed.body.error.code, "VALIDATION_ERROR");
  assert.deepEqual((await env.get("/api/generate-jobs")).body.jobs, []);
});

test("omitted and disabled brand-kit selections preserve the legacy unbranded acceptance shape", async (t) => {
  // Given: a server whose registry has a default brand kit.
  const env = await testEnvironment(t);
  const created = await env.store.create({ kit: kitInput("기본 키트"), setAsDefault: true, expectedRegistryRevision: 0 });
  assert.equal((await env.store.read()).defaultBrandKitId, created.kit.id);

  // When: legacy and explicitly-disabled requests are submitted.
  const omitted = await env.post("/api/generate-jobs", generationPayload());
  const disabledPayload = {
    ...generationPayload({ enabled: false, id: created.kit.id, expectedRevision: 1 }),
    brandKitSnapshot: { id: "attacker" }, effectiveBrandStyle: { kitId: "attacker" },
    runtime: { logoAbsolutePath: "/tmp/attacker-logo" }, oldSnapshot: { id: "attacker" },
  };
  const disabled = await env.post("/api/generate-jobs", disabledPayload);

  // Then: both remain accepted without exposing or inferring a brand snapshot.
  assert.equal(omitted.status, 202);
  assert.equal(disabled.status, 202);
  assert.equal(omitted.body.job.brandKitSnapshot, undefined);
  assert.equal(disabled.body.job.brandKitSnapshot, undefined);
  const disabledTerminal = await waitForJob(env, disabled.body.job.id);
  assert.doesNotMatch(JSON.stringify(disabledTerminal), /attacker|logoAbsolutePath|\/tmp\/attacker-logo/u);
});

test("server resolution overwrites hostile audit/runtime fields and creates one immutable canonical application", async (t) => {
  // Given: a trusted kit and hostile client-controlled aliases.
  const env = await testEnvironment(t);
  const created = await env.store.create({ kit: kitInput("서버 권한"), logoDataUrl: pngDataUrl() });
  const body = {
    ...generationPayload({ enabled: true, id: created.kit.id, expectedRevision: 1, overrides: { adMoodPreset: "bold", imageStyle: "프리미엄 클로즈업" } }),
    brandKitSnapshot: { id: "attacker" }, effectiveBrandStyle: { kitId: "attacker" },
    runtime: { logoAbsolutePath: "/tmp/attacker" }, brandKitRuntime: { logoAbsolutePath: "/tmp/attacker" },
    oldSnapshot: { secret: true }, logoAbsolutePath: "/tmp/attacker",
  };

  // When: the shared resolver linearizes the selection at a deterministic instant.
  const resolved = await resolveBrandKitSelection(body, { store: env.store, now: () => "2026-08-19T12:34:56.000Z" });

  // Then: only the store revision and canonical override order survive.
  assert.equal(resolved.brandKitSnapshot.id, created.kit.id);
  assert.equal(resolved.brandKitSnapshot.appliedAt, "2026-08-19T12:34:56.000Z");
  assert.deepEqual(resolved.brandKitSnapshot.overrideFields, ["adMoodPreset", "imageStyle"]);
  assert.equal(resolved.effectiveBrandStyle.ad.moodPreset, "bold");
  assert.equal(resolved.effectiveBrandStyle.image.style, "프리미엄 클로즈업");
  assert.equal(resolved.oldSnapshot, undefined);
  assert.equal(resolved.logoAbsolutePath, undefined);
  assert.equal(resolved.runtime.logoAbsolutePath, join(env.store.paths.assetsDir, created.kit.logo.filename));
  assert.ok(Object.isFrozen(resolved.brandKitSnapshot));
  assert.ok(Object.isFrozen(resolved.effectiveBrandStyle));
  assert.ok(Object.isFrozen(resolved.runtime));
});

test("queue acceptance freezes revision while later mutation changes only the next request", async (t) => {
  // Given: a delayed generation runner and revision 1 of a kit.
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const env = await testEnvironment(t, {
    generationRun: async () => {
      await gate;
      return { ok: true, logs: [], result: { title: "완료" }, exports: {} };
    },
  });
  const created = await env.store.create({ kit: kitInput("리비전 1") });

  // When: revision 1 is accepted, then the store advances to revision 2 before execution completes.
  const first = await env.post("/api/generate-jobs", generationPayload({ enabled: true, id: created.kit.id, expectedRevision: 1, overrides: {} }));
  await env.store.update({ id: created.kit.id, expectedRevision: 1, kit: kitInput("리비전 2"), logoChange: { action: "keep" } });
  release();
  const firstTerminal = await waitForJob(env, first.body.job.id);
  const second = await env.post("/api/generate-jobs", generationPayload({ enabled: true, id: created.kit.id, expectedRevision: 2, overrides: {} }));
  const secondTerminal = await waitForJob(env, second.body.job.id);
  await env.store.delete({ id: created.kit.id, expectedRevision: 2, expectedRegistryRevision: 2 });
  const afterDelete = await env.post("/api/generate-jobs", generationPayload({ enabled: true, id: created.kit.id, expectedRevision: 2, overrides: {} }));
  const reopenedFirst = (await env.get(`/api/generate-jobs/${first.body.job.id}`)).body.job;

  // Then: accepted jobs remain their original revisions while a request after deletion is rejected.
  assert.equal(firstTerminal.result.brandKitSnapshot.revision, 1);
  assert.equal(firstTerminal.result.brandKitSnapshot.name, "리비전 1");
  assert.equal(secondTerminal.result.brandKitSnapshot.revision, 2);
  assert.equal(secondTerminal.result.brandKitSnapshot.name, "리비전 2");
  assert.equal(afterDelete.status, 409);
  assert.equal(afterDelete.body.error.code, "BRAND_KIT_CHANGED");
  assert.equal(reopenedFirst.result.brandKitSnapshot.revision, 1);
});

test("direct, invoke, stream and queued routes expose the same public brand contract", async (t) => {
  // Given: one committed kit with a non-default one-shot override.
  let resolveCount = 0;
  const env = await testEnvironment(t, { decorateStore: (store) => ({
    ...store,
    resolveKit: async (...args) => { resolveCount += 1; return store.resolveKit(...args); },
  }) });
  const created = await env.store.create({ kit: kitInput("경로 일치") });
  const payload = generationPayload({ enabled: true, id: created.kit.id, expectedRevision: 1, overrides: { adMoodPreset: "premium" } });

  // When: the same selection traverses every supported generation surface.
  const queued = await env.post("/api/generate-jobs", payload);
  const queuedResult = (await waitForJob(env, queued.body.job.id)).result;
  const direct = (await env.post("/api/generate", payload)).body;
  const invoke = (await env.post("/api/engines/invoke", payload)).body;
  const streamResponse = await env.rawPost("/api/generate-stream", payload);
  const frames = streamResponse.text.trim().split("\n").map((line) => JSON.parse(line));
  const streamed = frames.find(({ type }) => type === "result").result;

  // Then: all routes agree on kit/revision/effective style and expose no runtime data.
  for (const result of [queuedResult, direct, invoke, streamed]) {
    assert.equal(result.brandKitSnapshot.id, created.kit.id);
    assert.equal(result.brandKitSnapshot.revision, 1);
    assert.deepEqual(result.effectiveBrandStyle, direct.effectiveBrandStyle);
    assert.doesNotMatch(JSON.stringify(result), /brandKitRuntime|logoAbsolutePath|\/Users\/|data:image/u);
  }
  assert.equal(resolveCount, 4);
});

test("missing immutable logo assets fail before work and delete-versus-resolve stays coherent", async (t) => {
  // Given: a kit whose committed immutable logo is removed out of band.
  const env = await testEnvironment(t);
  const created = await env.store.create({ kit: kitInput("로고 무결성"), logoDataUrl: pngDataUrl() });
  await unlinkIfPresent(join(env.store.paths.assetsDir, created.kit.logo.filename));

  // When: generation attempts to resolve the now-incomplete committed revision.
  const missing = await env.post("/api/generate-jobs", generationPayload({ enabled: true, id: created.kit.id, expectedRevision: 1, overrides: {} }));

  // Then: no job is queued and the immutable asset failure is explicit.
  assert.equal(missing.status, 409);
  assert.equal(missing.body.error.code, "BRAND_KIT_ASSET_MISSING");
  assert.deepEqual((await env.get("/api/generate-jobs")).body.jobs, []);

  // Given/When: resolve and delete race repeatedly on the shared store chain.
  for (let index = 0; index < 8; index += 1) {
    const kit = await env.store.create({ kit: kitInput(`경쟁 ${index}`) });
    const registry = await env.store.read();
    const [resolution, deletion] = await Promise.allSettled([
      resolveBrandKitSelection(generationPayload({ enabled: true, id: kit.kit.id, expectedRevision: 1, overrides: {} }), { store: env.store, now: () => "2026-08-19T02:00:00.000Z" }),
      env.store.delete({ id: kit.kit.id, expectedRevision: 1, expectedRegistryRevision: registry.registryRevision }),
    ]);
    assert.equal(deletion.status, "fulfilled");
    if (resolution.status === "fulfilled") {
      assert.equal(resolution.value.brandKitSnapshot.id, kit.kit.id);
      assert.equal(resolution.value.brandKitSnapshot.revision, 1);
    } else {
      assert.equal(resolution.reason.code, "BRAND_KIT_CHANGED");
      assert.equal(resolution.reason.status, 409);
    }
  }
});

test("terminal complete, failure and cancellation retain public audit and quiescent restart hydrates it", async (t) => {
  // Given: an injected persistent job state file and one already-resolved body.
  const env = await testEnvironment(t);
  const created = await env.store.create({ kit: kitInput("감사 보존") });
  const body = await resolveBrandKitSelection(generationPayload({ enabled: true, id: created.kit.id, expectedRevision: 1, overrides: {} }), { store: env.store, now: () => "2026-08-19T01:00:00.000Z" });
  const stateFile = join(env.root, "terminal-jobs.json");
  const complete = createGenerationJobManager({ stateFile, run: async () => ({ ok: true, logs: [], result: {}, exports: {} }) });

  // When: jobs complete, throw, and are cancelled through the real manager lifecycle.
  const completedStart = await complete.start(body);
  const completed = await waitForManagerJob(complete, completedStart.id);
  const failedManager = createGenerationJobManager({ stateFile: join(env.root, "failed.json"), run: async () => { throw new Error("provider failed"); } });
  const failedStart = await failedManager.start(body);
  const failed = await waitForManagerJob(failedManager, failedStart.id);
  const imageFailedManager = createGenerationJobManager({
    stateFile: join(env.root, "image-failed.json"),
    run: async () => ({ ok: false, logs: [], error: { code: "IMAGEGEN_FAILED", message: "image provider failed" }, result: {} }),
  });
  const imageFailedStart = await imageFailedManager.start(body);
  const imageFailed = await waitForManagerJob(imageFailedManager, imageFailedStart.id);
  const cancelledManager = createGenerationJobManager({
    stateFile: join(env.root, "cancelled.json"),
    run: async (_body, { signal }) => new Promise((resolve) => {
      const finish = () => resolve({ ok: true, logs: [], result: { ignoredCancellation: true } });
      if (signal.aborted) finish(); else signal.addEventListener("abort", finish, { once: true });
    }),
  });
  const cancelledStart = await cancelledManager.start(body);
  await cancelledManager.cancel(cancelledStart.id);
  const cancelled = await waitForManagerJob(cancelledManager, cancelledStart.id);

  // Then: every terminal result is public-only, and an observed persisted completion hydrates on restart.
  for (const job of [completed, failed, imageFailed, cancelled]) {
    assert.equal(job.result.brandKitSnapshot.id, created.kit.id);
    assert.equal(job.result.effectiveBrandStyle.kitRevision, 1);
    assert.doesNotMatch(JSON.stringify(job), /brandKitRuntime|logoAbsolutePath|\/Users\/|data:image/u);
  }
  await waitForFile(stateFile, created.kit.id);
  const stored = await readFile(stateFile, "utf8");
  assert.doesNotMatch(stored, /brandKitRuntime|logoAbsolutePath|\/Users\/|data:image/u);
  const restarted = createGenerationJobManager({ stateFile, run: async () => ({ ok: true }) });
  const hydrated = await restarted.get(completedStart.id);
  assert.equal(hydrated.result.brandKitSnapshot.id, created.kit.id);
});

async function testEnvironment(t, serverOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), "store-maker-brand-jobs-"));
  const registryFile = join(root, "registry.json");
  const assetsDir = join(root, "assets");
  let idSequence = 0;
  const store = createBrandKitStore({ registryFile, assetsDir, now: () => "2026-08-19T00:00:00.000Z", createId: () => `kit-${++idSequence}` });
  const { decorateStore, ...appOptions } = serverOptions;
  const serverStore = decorateStore?.(store) ?? store;
  const app = createServer({ brandKitStore: serverStore, brandAssetsDir: assetsDir, generationJobStateFile: join(root, "jobs.json"), ...appOptions });
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.address().port}`;
  const shell = await fetch(`${base}/`);
  const token = (await shell.text()).match(/name="store-maker-token" content="([^"]+)"/u)?.[1];
  const headers = { "content-type": "application/json", "x-store-maker-token": token, origin: base };
  const request = async (method, path, body) => {
    const response = await fetch(`${base}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, contentType: response.headers.get("content-type") ?? "", body: await response.json() };
  };
  const rawPost = async (path, body) => {
    const response = await fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
    return { status: response.status, contentType: response.headers.get("content-type") ?? "", text: await response.text() };
  };
  t.after(async () => {
    await new Promise((resolve) => app.close(resolve));
    await app.flushGenerationJobs();
    await removeEventually(root);
  });
  return { root, store, post: (path, body) => request("POST", path, body), get: (path) => request("GET", path), rawPost };
}

async function waitForJob(env, id) {
  return waitFor(async () => {
    const response = await env.get(`/api/generate-jobs/${id}`);
    return ["completed", "failed", "cancelled"].includes(response.body.job?.status) ? response.body.job : undefined;
  });
}

async function waitForManagerJob(manager, id) {
  return waitFor(async () => {
    const job = await manager.get(id);
    return ["completed", "failed", "cancelled"].includes(job?.status) ? job : undefined;
  });
}

async function waitForFile(path, expected) {
  return waitFor(async () => {
    try { return (await readFile(path, "utf8")).includes(expected) || undefined; }
    catch { return undefined; }
  });
}

async function waitFor(read) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for deterministic test state");
}

async function removeEventually(path) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try { await rm(path, { recursive: true, force: true }); return; }
    catch (error) {
      if (!["ENOTEMPTY", "EBUSY"].includes(error?.code) || attempt === 19) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

async function unlinkIfPresent(path) {
  try { await rm(path); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
}

function pngDataUrl() {
  const bytes = Buffer.alloc(45);
  Buffer.from("89504e470d0a1a0a0000000d49484452", "hex").copy(bytes);
  bytes.writeUInt32BE(1, 16);
  bytes.writeUInt32BE(1, 20);
  bytes[24] = 8;
  bytes[25] = 6;
  Buffer.from("0000000049454e4400000000", "hex").copy(bytes, 33);
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

function generationPayload(brandKitSelection) {
  return {
    product: { name: "테스트 상품", description: "설명", requirements: "요구사항" },
    markets: ["smartstore"],
    engine: { mode: "local-cli", engineId: "mock", command: `${process.execPath} scripts/mock-engine.mjs` },
    imageGeneration: { enabled: false },
    ...(brandKitSelection === undefined ? {} : { brandKitSelection }),
  };
}

function kitInput(name) {
  return {
    schemaVersion: 1, name, sourceUrl: "https://example.com/brand",
    colors: { primary: "#111111", secondary: "#e8e8e8", accent: "#c24a2e", background: "#ffffff", surface: "#f5f5f5", text: "#111111" },
    typography: { displayFontId: "modern-sans-bold", bodyFontId: "readable-sans" },
    voice: { summary: "간결하고 정확하게 말합니다.", dos: ["근거 제시"], donts: ["과장"], sample: "매일 쓰는 도구입니다." },
    imagery: { presetId: "custom", mood: "차분함", lighting: "부드러운 빛", composition: "제품 중심", background: "밝은 배경", colorTreatment: "중립 색감", avoid: ["과한 네온"] },
    defaults: { adMoodPreset: "warm", imageStyle: "라이프스타일컷", imageBackground: "사용자 지정" },
  };
}
