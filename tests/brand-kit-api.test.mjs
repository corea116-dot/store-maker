import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createServer } from "../server.mjs";
import { createBrandKitStore } from "../lib/server/brand-kit-store.mjs";

test("GET /api/brand-kits is a protected public registry endpoint", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "store-maker-brand-api-"));
  const store = createBrandKitStore({ registryFile: join(root, "registry.json"), assetsDir: join(root, "assets") });
  const app = createServer({ brandKitStore: store, brandAssetsDir: join(root, "assets") });
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => app.close(resolve)));
  t.after(() => rm(root, { recursive: true, force: true }));
  const address = app.address();
  const shell = await fetch(`http://127.0.0.1:${address.port}/`);
  const token = (await shell.text()).match(/name="store-maker-token" content="([^"]+)"/u)?.[1];
  const response = await fetch(`http://127.0.0.1:${address.port}/api/brand-kits`, { headers: { "x-store-maker-token": token } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, registryRevision: 0, defaultBrandKitId: null, kits: [] });
});

test("create, update logo tri-state, duplicate, default and delete expose only public state", async (t) => {
  const env = await apiEnv(t);
  const png = makePng(2, 3);
  const created = await env.json("POST", "/api/brand-kits", { kit: kitInput("기본"), logoDataUrl: dataUrl("image/png", png), setAsDefault: true, expectedRegistryRevision: 0 });
  assert.equal(created.status, 201);
  assert.equal(created.body.defaultBrandKitId, created.body.kit.id);
  assert.equal(created.body.kit.logo.assetId, sha(png));
  assert.equal(created.body.kit.sourceUrl, "https://example.com/brand");

  const asset = await fetch(`${env.base}${created.body.kit.logo.url}`);
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await asset.arrayBuffer()), png);
  const head = await fetch(`${env.base}${created.body.kit.logo.url}`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal((await head.arrayBuffer()).byteLength, 0);

  const kept = await env.json("PUT", `/api/brand-kits/${created.body.kit.id}`, { expectedRevision: 1, kit: kitInput("수정"), logoChange: { action: "keep" } });
  assert.equal(kept.body.kit.revision, 2);
  assert.deepEqual(kept.body.kit.logo, created.body.kit.logo);
  const removed = await env.json("PUT", `/api/brand-kits/${created.body.kit.id}`, { expectedRevision: 2, kit: kitInput("로고 제거"), logoChange: { action: "remove" } });
  assert.equal(removed.body.kit.logo, null);
  const replaced = await env.json("PUT", `/api/brand-kits/${created.body.kit.id}`, { expectedRevision: 3, kit: kitInput("로고 복원"), logoChange: { action: "replace", dataUrl: dataUrl("image/png", png) } });
  assert.equal(replaced.body.kit.logo.assetId, sha(png));

  const duplicate = await env.json("POST", `/api/brand-kits/${created.body.kit.id}/duplicate`, { expectedRevision: 4, name: "복제" });
  assert.equal(duplicate.status, 201);
  assert.equal(duplicate.body.kit.revision, 1);
  assert.notEqual(duplicate.body.kit.id, created.body.kit.id);
  assert.equal(duplicate.body.defaultBrandKitId, created.body.kit.id);
  const madeDefault = await env.json("POST", `/api/brand-kits/${duplicate.body.kit.id}/default`, { expectedRegistryRevision: 5 });
  assert.equal(madeDefault.body.defaultBrandKitId, duplicate.body.kit.id);
  const deleted = await env.json("POST", `/api/brand-kits/${duplicate.body.kit.id}/delete`, { expectedRevision: 1, expectedRegistryRevision: 6 });
  assert.equal(deleted.body.defaultBrandKitId, null);
  assert.equal(deleted.body.kits.length, 1);

  const serialized = JSON.stringify([created.body, kept.body, removed.body, replaced.body, duplicate.body, madeDefault.body, deleted.body]);
  for (const forbidden of ["data:image", "logoAbsolutePath", env.root, ".omx/state", "apiKey", "x-store-maker-token"]) assert.doesNotMatch(serialized, new RegExp(escapeRegex(forbidden), "u"));
});

test("trust, JSON, validation, missing and conflict failures are structured and side-effect safe", async (t) => {
  const env = await apiEnv(t);
  const noToken = await fetch(`${env.base}/api/brand-kits`);
  assert.equal(noToken.status, 403);
  const crossOrigin = await fetch(`${env.base}/api/brand-kits`, { headers: { "x-store-maker-token": env.token, origin: "https://attacker.example" } });
  assert.equal(crossOrigin.status, 403);
  const nonJson = await fetch(`${env.base}/api/brand-kits`, { method: "POST", headers: env.headers({ "content-type": "text/plain" }), body: "{}" });
  assert.equal(nonJson.status, 415);
  const malformed = await fetch(`${env.base}/api/brand-kits`, { method: "POST", headers: env.headers(), body: "{" });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, "INVALID_JSON");
  const invalid = await env.json("POST", "/api/brand-kits", { kit: { ...kitInput("검증"), name: "" } });
  assert.equal(invalid.status, 422);
  assert.equal(invalid.body.error.code, "VALIDATION_ERROR");
  assert.ok(invalid.body.error.fields.some(({ field }) => field === "name"));
  const spoofedAsset = await env.json("POST", "/api/brand-kits", { kit: { ...kitInput("자산 위조"), logo: { assetId: "fake", filename: "fake.png", url: "/outputs/brand-assets/fake.png" } } });
  assert.equal(spoofedAsset.status, 422);
  assert.equal(spoofedAsset.body.error.code, "UNTRUSTED_BRAND_KIT_ASSET");
  const oversizedLogo = await env.json("POST", "/api/brand-kits", { kit: kitInput("대용량"), logoDataUrl: dataUrl("image/png", Buffer.alloc(2 * 1024 * 1024 + 1)) });
  assert.equal(oversizedLogo.status, 413);
  assert.equal(oversizedLogo.body.error.code, "BRAND_KIT_LOGO_TOO_LARGE");
  const missing = await env.json("POST", "/api/brand-kits/not-found/delete", { expectedRevision: 1, expectedRegistryRevision: 0 });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, "BRAND_KIT_NOT_FOUND");
  const created = await env.json("POST", "/api/brand-kits", { kit: kitInput("충돌"), setAsDefault: true, expectedRegistryRevision: 0 });
  const before = await readFile(env.registryFile);
  const staleCreate = await env.json("POST", "/api/brand-kits", { kit: kitInput("생성 금지"), setAsDefault: true, expectedRegistryRevision: 0 });
  assert.equal(staleCreate.status, 409);
  assert.equal(staleCreate.body.error.code, "BRAND_KIT_REGISTRY_CONFLICT");
  assert.equal(staleCreate.body.current.registryRevision, 1);
  assert.deepEqual(await readFile(env.registryFile), before);
  const staleKit = await env.json("PUT", `/api/brand-kits/${created.body.kit.id}`, { expectedRevision: 9, kit: kitInput("유실 금지"), logoChange: { action: "keep" } });
  assert.equal(staleKit.status, 409);
  assert.equal(staleKit.body.current.id, created.body.kit.id);
  assert.deepEqual(await readFile(env.registryFile), before);
  const duplicateScope = await env.json("POST", `/api/brand-kits/${created.body.kit.id}/duplicate`, { expectedRevision: 1, setAsDefault: true });
  assert.equal(duplicateScope.status, 400);
  assert.deepEqual(await readFile(env.registryFile), before);
  const badPath = await env.json("PUT", "/api/brand-kits/%ZZ", {});
  assert.equal(badPath.status, 400);
  assert.equal(badPath.body.ok, false);
});

test("nested client asset aliases reject before create, update or duplicate mutations", async (t) => {
  const env = await apiEnv(t);
  const baseline = await env.json("POST", "/api/brand-kits", { kit: kitInput("경계 기준"), logoDataUrl: dataUrl("image/png", makePng(1, 1)), setAsDefault: true, expectedRegistryRevision: 0 });
  assert.equal(baseline.status, 201);
  const cases = [
    ["create kit.logoUrl", "POST", "/api/brand-kits", { kit: { ...kitInput("위조 URL"), logoUrl: "/outputs/brand-assets/fake.png" } }],
    ["create kit.logoPath", "POST", "/api/brand-kits", { kit: { ...kitInput("위조 경로"), logoPath: "/tmp/logo.png" } }],
    ["create kit.logoHash", "POST", "/api/brand-kits", { kit: { ...kitInput("위조 해시"), logoHash: "a".repeat(64) } }],
    ["create kit.logoDataUrl", "POST", "/api/brand-kits", { kit: { ...kitInput("중첩 데이터 위조"), logoDataUrl: dataUrl("image/png", makePng(2, 2)) } }],
    ["create nested assetId", "POST", "/api/brand-kits", { kit: { ...kitInput("중첩 위조"), metadata: { nested: [{ assetId: "fake" }] } } }],
    ["create nested dataUrl", "POST", "/api/brand-kits", { kit: { ...kitInput("데이터 위조"), metadata: { dataUrl: "data:image/png;base64,AAAA" } } }],
    ["update keep aliases", "PUT", `/api/brand-kits/${baseline.body.kit.id}`, { expectedRevision: 1, kit: kitInput("수정 금지"), logoChange: { action: "keep", url: "/fake", path: "/tmp/fake", hash: "fake" } }],
    ["update remove runtime", "PUT", `/api/brand-kits/${baseline.body.kit.id}`, { expectedRevision: 1, kit: kitInput("수정 금지"), logoChange: { action: "remove", runtime: { absolutePath: "/tmp/fake" } } }],
    ["update top-level logoDataUrl", "PUT", `/api/brand-kits/${baseline.body.kit.id}`, { expectedRevision: 1, kit: kitInput("수정 금지"), logoChange: { action: "keep" }, logoDataUrl: dataUrl("image/png", makePng(2, 2)) }],
    ["update keep dataUrl", "PUT", `/api/brand-kits/${baseline.body.kit.id}`, { expectedRevision: 1, kit: kitInput("수정 금지"), logoChange: { action: "keep", dataUrl: dataUrl("image/png", makePng(2, 2)) } }],
    ["update remove dataUrl", "PUT", `/api/brand-kits/${baseline.body.kit.id}`, { expectedRevision: 1, kit: kitInput("수정 금지"), logoChange: { action: "remove", dataUrl: dataUrl("image/png", makePng(2, 2)) } }],
    ["update replace filename", "PUT", `/api/brand-kits/${baseline.body.kit.id}`, { expectedRevision: 1, kit: kitInput("수정 금지"), logoChange: { action: "replace", dataUrl: dataUrl("image/png", makePng(2, 2)), filename: "chosen.png" } }],
    ["update replace plus logoDataUrl", "PUT", `/api/brand-kits/${baseline.body.kit.id}`, { expectedRevision: 1, kit: kitInput("수정 금지"), logoChange: { action: "replace", dataUrl: dataUrl("image/png", makePng(2, 2)), logoDataUrl: dataUrl("image/png", makePng(3, 3)) } }],
    ["duplicate nested path", "POST", `/api/brand-kits/${baseline.body.kit.id}/duplicate`, { expectedRevision: 1, name: "복제 금지", metadata: [{ logoPath: "/tmp/fake" }] }],
    ["duplicate logoDataUrl", "POST", `/api/brand-kits/${baseline.body.kit.id}/duplicate`, { expectedRevision: 1, name: "복제 금지", logoDataUrl: dataUrl("image/png", makePng(2, 2)) }],
    ["default logoDataUrl", "POST", `/api/brand-kits/${baseline.body.kit.id}/default`, { expectedRegistryRevision: 1, logoDataUrl: dataUrl("image/png", makePng(2, 2)) }],
    ["delete logoDataUrl", "POST", `/api/brand-kits/${baseline.body.kit.id}/delete`, { expectedRevision: 1, expectedRegistryRevision: 1, logoDataUrl: dataUrl("image/png", makePng(2, 2)) }],
  ];
  for (const [label, method, path, body] of cases) {
    const beforeBytes = await readFile(env.registryFile);
    const beforeRegistry = await env.store.read();
    const beforeAssets = (await readdir(env.assetsDir)).sort();
    const response = await env.json(method, path, body);
    assert.equal(response.status, 422, label);
    assert.equal(response.body.error.code, "UNTRUSTED_BRAND_KIT_ASSET", label);
    assert.deepEqual(await readFile(env.registryFile), beforeBytes, label);
    assert.deepEqual(await env.store.read(), beforeRegistry, label);
    assert.deepEqual((await readdir(env.assetsDir)).sort(), beforeAssets, label);
  }
  const kept = await env.json("PUT", `/api/brand-kits/${baseline.body.kit.id}`, { expectedRevision: 1, kit: kitInput("정상 keep"), logoChange: { action: "keep" } });
  assert.equal(kept.status, 200);
  const removed = await env.json("PUT", `/api/brand-kits/${baseline.body.kit.id}`, { expectedRevision: 2, kit: kitInput("정상 remove"), logoChange: { action: "remove" } });
  assert.equal(removed.status, 200);
  const replaced = await env.json("PUT", `/api/brand-kits/${baseline.body.kit.id}`, { expectedRevision: 3, kit: kitInput("정상 replace"), logoChange: { action: "replace", dataUrl: dataUrl("image/png", makePng(3, 3)) } });
  assert.equal(replaced.status, 200);
});

test("restart reloads committed state while corruption returns a sanitized 500", async (t) => {
  const env = await apiEnv(t);
  await env.json("POST", "/api/brand-kits", { kit: kitInput("재시작") });
  await env.stop();
  const restarted = await startApi(env.root, env.registryFile, env.assetsDir);
  t.after(restarted.stop);
  const loaded = await restarted.json("GET", "/api/brand-kits");
  assert.equal(loaded.body.kits[0].name, "재시작");
  await restarted.stop();
  await writeFile(env.registryFile, "{corrupt-secret-path-/Users/private", "utf8");
  const corrupt = await startApi(env.root, env.registryFile, env.assetsDir);
  t.after(corrupt.stop);
  const response = await corrupt.json("GET", "/api/brand-kits");
  assert.equal(response.status, 500);
  assert.equal(response.body.error.code, "BRAND_KIT_STORE_INVALID");
  assert.doesNotMatch(JSON.stringify(response.body), /corrupt-secret|\/Users\/|registry\.json/u);
});

test("brand asset allowlist accepts only canonical existing lowercase hash images", async (t) => {
  const env = await apiEnv(t);
  const bytes = makePng(1, 1);
  const hash = sha(bytes);
  await mkdir(env.assetsDir, { recursive: true });
  await writeFile(join(env.assetsDir, `${hash}.png`), bytes);
  const external = join(env.root, "external.png");
  await writeFile(external, bytes);
  const symlinkHash = "1".repeat(64);
  await symlink(external, join(env.assetsDir, `${symlinkHash}.png`));
  const ok = await fetch(`${env.base}/outputs/brand-assets/${hash}.png?download=1`);
  assert.equal(ok.status, 200);
  const negative = [
    `/outputs/brand-assets/not-a-hash.png`, `/outputs/brand-assets/${hash.toUpperCase()}.png`,
    `/outputs/brand-assets/${hash}.jpeg`, `/outputs/brand-assets/${hash}.svg`, `/outputs/brand-assets/${hash}.json`,
    `/outputs/brand-assets/${hash}.png.html`, `/outputs/brand-assets/${"0".repeat(64)}.png`,
    `/outputs/brand-assets/${symlinkHash}.png`,
    "/outputs/brand-assets/", "/outputs/brand-assets/%2e%2e/registry.json", "/outputs/brand-assets/%252e%252e/registry.json",
    "/outputs/brand-assets/%ZZ", "/.omx/state/store-maker-brand-kits.json", "/package.json", "/tests/brand-kit-api.test.mjs",
  ];
  for (const path of negative) assert.equal((await fetch(`${env.base}${path}`)).status, 404, path);
});

async function apiEnv(t) {
  const root = await mkdtemp(join(tmpdir(), "store-maker-brand-api-"));
  const registryFile = join(root, "state", "registry.json");
  const assetsDir = join(root, "assets");
  const env = await startApi(root, registryFile, assetsDir);
  t.after(async () => { await env.stop(); await rm(root, { recursive: true, force: true }); });
  return { ...env, root, registryFile, assetsDir };
}

async function startApi(root, registryFile, assetsDir) {
  let sequence = 0;
  const store = createBrandKitStore({ registryFile, assetsDir, now: () => "2026-08-19T00:00:00.000Z", createId: () => `kit-${++sequence}` });
  const app = createServer({ brandKitStore: store, brandAssetsDir: assetsDir });
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  const port = app.address().port;
  const base = `http://127.0.0.1:${port}`;
  const shell = await fetch(`${base}/`);
  const token = (await shell.text()).match(/name="store-maker-token" content="([^"]+)"/u)?.[1];
  let stopped = false;
  const stop = async () => { if (!stopped) { stopped = true; await new Promise((resolve) => app.close(resolve)); } };
  const headers = (extra = {}) => ({ "content-type": "application/json", "x-store-maker-token": token, origin: base, ...extra });
  const json = async (method, path, body) => {
    const response = await fetch(`${base}${path}`, { method, headers: headers(), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  return { root, app, base, token, headers, json, stop, store };
}

function kitInput(name) {
  return {
    schemaVersion: 1, name, sourceUrl: "https://user:secret@example.com/brand?key=secret#part",
    colors: { primary: "#111111", secondary: "#E8E8E8", accent: "#C24A2E", background: "#FFFFFF", surface: "#F5F5F5", text: "#111111" },
    typography: { displayFontId: "modern-sans-bold", bodyFontId: "readable-sans" },
    voice: { summary: "간결하고 정확하게 말합니다.", dos: ["근거 제시"], donts: ["과장"], sample: "매일 쓰는 도구입니다." },
    imagery: { presetId: "custom", mood: "차분한 분위기", lighting: "부드러운 빛", composition: "제품 중심", background: "밝은 배경", colorTreatment: "중립 색감", avoid: ["과한 네온"] },
    defaults: { adMoodPreset: "warm", imageStyle: "라이프스타일컷", imageBackground: "사용자 지정" },
  };
}
function makePng(width, height) { const bytes = Buffer.alloc(45); Buffer.from("89504e470d0a1a0a0000000d49484452", "hex").copy(bytes); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20); bytes[24] = 8; bytes[25] = 6; Buffer.from("0000000049454e4400000000", "hex").copy(bytes, 33); return bytes; }
function dataUrl(type, bytes) { return `data:${type};base64,${bytes.toString("base64")}`; }
function sha(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"); }
