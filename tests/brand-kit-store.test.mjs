import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createBrandKitStore } from "../lib/server/brand-kit-store.mjs";

const PNG = makePng(2, 3);
const JPEG = makeJpeg(4, 5);
const WEBP = makeWebp(6, 7);

test("an empty store returns revision zero without publishing repository state", async (t) => {
  const env = await storeEnv(t);
  assert.deepEqual(await env.store.read(), { schemaVersion: 1, registryRevision: 0, defaultBrandKitId: null, kits: [] });
  await assert.rejects(access(env.registryFile), { code: "ENOENT" });
});

test("create, reload, default, update, duplicate and delete preserve exact revisions", async (t) => {
  const env = await storeEnv(t);
  const first = await env.store.create({ kit: kitInput("첫 키트"), logoDataUrl: dataUrl("image/png", PNG), setAsDefault: true, expectedRegistryRevision: 0 });
  assert.equal(first.kit.revision, 1);
  assert.equal(first.registry.registryRevision, 1);
  assert.equal(first.registry.defaultBrandKitId, first.kit.id);

  const reloaded = createBrandKitStore(env.options);
  assert.deepEqual(await reloaded.read(), first.registry);
  const second = await reloaded.create({ kit: kitInput("둘째 키트") });
  assert.equal(second.registry.registryRevision, 2);
  const madeDefault = await reloaded.setDefault({ id: second.kit.id, expectedRegistryRevision: 2 });
  assert.equal(madeDefault.registryRevision, 3);

  const updated = await reloaded.update({ id: first.kit.id, expectedRevision: 1, kit: kitInput("첫 키트 수정"), logoChange: { action: "keep" } });
  assert.equal(updated.kit.revision, 2);
  assert.equal(updated.registry.registryRevision, 4);
  assert.deepEqual(updated.kit.logo, first.kit.logo);

  const duplicate = await reloaded.duplicate({ id: first.kit.id, expectedRevision: 2, name: "복제 키트" });
  assert.equal(duplicate.kit.revision, 1);
  assert.notEqual(duplicate.kit.id, first.kit.id);
  assert.deepEqual(duplicate.kit.logo, first.kit.logo);
  assert.equal(duplicate.registry.defaultBrandKitId, second.kit.id);
  assert.equal(duplicate.registry.registryRevision, 5);

  const deleted = await reloaded.delete({ id: second.kit.id, expectedRevision: 1, expectedRegistryRevision: 5 });
  assert.equal(deleted.registryRevision, 6);
  assert.equal(deleted.defaultBrandKitId, null);
  assert.equal(deleted.kits.some(({ id }) => id === second.kit.id), false);
});

test("stale mutations leave the registry byte-identical and create+default creates nothing", async (t) => {
  const env = await storeEnv(t);
  const created = await env.store.create({ kit: kitInput("기준"), setAsDefault: true, expectedRegistryRevision: 0 });
  const before = await readFile(env.registryFile);

  await assert.rejects(env.store.create({ kit: kitInput("유실 금지"), setAsDefault: true, expectedRegistryRevision: 0 }), errorCode("BRAND_KIT_REGISTRY_CONFLICT"));
  await assert.rejects(env.store.update({ id: created.kit.id, expectedRevision: 9, kit: kitInput("충돌"), logoChange: { action: "keep" } }), errorCode("BRAND_KIT_REVISION_CONFLICT"));
  assert.deepEqual(await readFile(env.registryFile), before);
  assert.equal((await env.store.read()).kits.length, 1);
});

test("replace, remove and hash dedupe retain immutable old assets", async (t) => {
  const env = await storeEnv(t);
  const first = await env.store.create({ kit: kitInput("로고"), logoDataUrl: dataUrl("image/png", PNG) });
  const same = await env.store.create({ kit: kitInput("동일 로고"), logoDataUrl: dataUrl("image/png", PNG) });
  assert.equal(first.kit.logo.assetId, sha(PNG));
  assert.equal(first.kit.logo.filename, `${sha(PNG)}.png`);
  assert.deepEqual(same.kit.logo, first.kit.logo);
  assert.deepEqual(await readdir(env.assetsDir), [`${sha(PNG)}.png`]);

  const replaced = await env.store.update({ id: first.kit.id, expectedRevision: 1, kit: kitInput("교체"), logoChange: { action: "replace", dataUrl: dataUrl("image/jpeg", JPEG) } });
  assert.equal(replaced.kit.logo.filename, `${sha(JPEG)}.jpg`);
  const removed = await env.store.update({ id: first.kit.id, expectedRevision: 2, kit: kitInput("제거"), logoChange: { action: "remove" } });
  assert.equal(removed.kit.logo, null);
  await env.store.delete({ id: first.kit.id, expectedRevision: 3, expectedRegistryRevision: 4 });
  assert.deepEqual((await readdir(env.assetsDir)).sort(), [`${sha(JPEG)}.jpg`, `${sha(PNG)}.png`].sort());
});

test("logo tri-state is mandatory on update and validates type, magic, dimensions and decoded size", async (t) => {
  const env = await storeEnv(t);
  await assert.rejects(env.store.create({ kit: { ...kitInput("잘못된 키트"), name: "" }, logoDataUrl: dataUrl("image/png", PNG) }), errorCode("VALIDATION_ERROR"));
  assert.deepEqual(await readdir(env.assetsDir).catch(() => []), []);
  const created = await env.store.create({ kit: kitInput("검증") });
  const update = (logoChange) => env.store.update({ id: created.kit.id, expectedRevision: 1, kit: kitInput("검증 수정"), logoChange });
  await assert.rejects(update(undefined), errorCode("INVALID_LOGO_CHANGE"));
  await assert.rejects(update({ action: "replace" }), errorCode("INVALID_BRAND_KIT_LOGO"));
  await assert.rejects(update({ action: "replace", dataUrl: dataUrl("image/jpeg", PNG) }), errorCode("BRAND_KIT_LOGO_TYPE_UNSUPPORTED"));
  await assert.rejects(update({ action: "replace", dataUrl: "data:image/svg+xml;base64,PHN2Zy8+" }), errorCode("BRAND_KIT_LOGO_TYPE_UNSUPPORTED"));
  await assert.rejects(update({ action: "replace", dataUrl: dataUrl("image/png", PNG.subarray(0, 20)) }), errorCode("INVALID_BRAND_KIT_LOGO"));
  await assert.rejects(update({ action: "replace", dataUrl: dataUrl("image/png", makePng(4097, 1)) }), errorCode("INVALID_BRAND_KIT_LOGO"));
  await assert.rejects(update({ action: "replace", dataUrl: dataUrl("image/png", makePng(4096, 4097)) }), errorCode("INVALID_BRAND_KIT_LOGO"));
  const tooLarge = Buffer.concat([makePng(1, 1), Buffer.alloc(2 * 1024 * 1024)]);
  await assert.rejects(update({ action: "replace", dataUrl: dataUrl("image/png", tooLarge) }), errorCode("BRAND_KIT_LOGO_TOO_LARGE"));
  assert.deepEqual(await readdir(env.assetsDir).catch(() => []), []);
});

test("PNG, JPEG and WebP metadata is derived from trusted bytes", async (t) => {
  const env = await storeEnv(t);
  for (const [index, type, bytes, extension] of [[0, "image/png", PNG, "png"], [1, "image/jpeg", JPEG, "jpg"], [2, "image/webp", WEBP, "webp"]]) {
    const result = await env.store.create({ kit: { ...kitInput(`형식 ${index}`), logo: { url: "/evil" } }, logoDataUrl: dataUrl(type, bytes) });
    assert.deepEqual(result.kit.logo, { assetId: sha(bytes), filename: `${sha(bytes)}.${extension}`, type, size: bytes.length, url: `/outputs/brand-assets/${sha(bytes)}.${extension}` });
  }
});

test("non-canonical and malformed base64 logo payloads reject before persistence", async (t) => {
  const env = await storeEnv(t);
  const canonical = JPEG.toString("base64");
  assert.match(canonical, /k=$/u);
  const malformedPayloads = [
    ...["l", "m", "n"].map((terminal) => canonical.replace(/k=$/u, `${terminal}=`)),
    `${canonical}AAAA`,
    canonical.replace(/A/u, "*"),
    `${canonical}=`,
  ];
  for (const [index, payload] of malformedPayloads.entries()) {
    await assert.rejects(
      env.store.create({ kit: kitInput(`base64 거부 ${index}`), logoDataUrl: `data:image/jpeg;base64,${payload}` }),
      errorCode("INVALID_BRAND_KIT_LOGO"),
    );
  }
  await assert.rejects(access(env.registryFile), { code: "ENOENT" });
  assert.deepEqual(await readdir(env.assetsDir).catch(() => []), []);
});

test("failed registry commit rolls back metadata while retaining an allowed immutable orphan", async (t) => {
  const env = await storeEnv(t);
  const baseline = await env.store.create({ kit: kitInput("기준") });
  const before = await readFile(env.registryFile);
  let fail = true;
  const failingStore = createBrandKitStore({ ...env.options, beforeRegistryRename() { if (fail) throw new Error("injected registry failure"); } });
  await assert.rejects(failingStore.update({ id: baseline.kit.id, expectedRevision: 1, kit: kitInput("커밋 실패"), logoChange: { action: "replace", dataUrl: dataUrl("image/webp", WEBP) } }), errorCode("BRAND_KIT_STORE_WRITE_FAILED"));
  fail = false;
  assert.deepEqual(await readFile(env.registryFile), before);
  assert.equal((await failingStore.read()).kits[0].revision, 1);
  assert.deepEqual(await readdir(env.assetsDir), [`${sha(WEBP)}.webp`]);
});

test("file and directory sync failures abort registry and logo publication", async (t) => {
  const registryFileFailure = await storeEnv(t, { syncRegistryFile: async () => { throw new Error("registry fsync failed"); } });
  await assert.rejects(registryFileFailure.store.create({ kit: kitInput("레지스트리 fsync 실패") }), errorCode("BRAND_KIT_STORE_WRITE_FAILED"));
  await assert.rejects(access(registryFileFailure.registryFile), { code: "ENOENT" });

  const registryDirectoryFailure = await storeEnv(t, { syncRegistryDirectory: async () => { throw new Error("registry directory fsync failed"); } });
  await assert.rejects(registryDirectoryFailure.store.create({ kit: kitInput("레지스트리 디렉터리 fsync 실패") }), errorCode("BRAND_KIT_STORE_WRITE_FAILED"));
  await assert.rejects(access(registryDirectoryFailure.registryFile), { code: "ENOENT" });

  const assetFileFailure = await storeEnv(t, { syncAssetFile: async () => { throw new Error("asset fsync failed"); } });
  await assert.rejects(assetFileFailure.store.create({ kit: kitInput("자산 fsync 실패"), logoDataUrl: dataUrl("image/png", PNG) }), errorCode("BRAND_KIT_ASSET_WRITE_FAILED"));
  await assert.rejects(access(assetFileFailure.registryFile), { code: "ENOENT" });
  assert.deepEqual(await readdir(assetFileFailure.assetsDir).catch(() => []), []);

  const assetDirectoryFailure = await storeEnv(t, { syncAssetDirectory: async () => { throw new Error("asset directory fsync failed"); } });
  await assert.rejects(assetDirectoryFailure.store.create({ kit: kitInput("자산 디렉터리 fsync 실패"), logoDataUrl: dataUrl("image/png", PNG) }), errorCode("BRAND_KIT_ASSET_WRITE_FAILED"));
  await assert.rejects(access(assetDirectoryFailure.registryFile), { code: "ENOENT" });
  assert.deepEqual(await readdir(assetDirectoryFailure.assetsDir), [`${sha(PNG)}.png`]);
});

test("a symlinked asset root is rejected before logo bytes or registry state are committed", async (t) => {
  const env = await storeEnv(t);
  const outsideAssets = join(env.root, "outside-assets");
  await mkdir(outsideAssets);
  await symlink(outsideAssets, env.assetsDir);

  await assert.rejects(env.store.create({ kit: kitInput("루트 심볼릭 링크"), logoDataUrl: dataUrl("image/png", PNG) }), errorCode("BRAND_KIT_ASSET_WRITE_FAILED"));

  await assert.rejects(access(env.registryFile), { code: "ENOENT" });
  assert.deepEqual(await readdir(outsideAssets), []);
});

test("dedupe refuses a corrupted pre-existing hash target without committing metadata", async (t) => {
  const env = await storeEnv(t);
  await mkdir(env.assetsDir, { recursive: true });
  await writeFile(join(env.assetsDir, `${sha(PNG)}.png`), Buffer.from("corrupt"));
  await assert.rejects(env.store.create({ kit: kitInput("충돌 자산"), logoDataUrl: dataUrl("image/png", PNG) }), errorCode("BRAND_KIT_ASSET_WRITE_FAILED"));
  await assert.rejects(access(env.registryFile), { code: "ENOENT" });
});

test("the shared transaction chain prevents lost updates across store instances", async (t) => {
  const env = await storeEnv(t);
  const [first, second] = await Promise.all([env.store.create({ kit: kitInput("동시 A") }), createBrandKitStore(env.options).create({ kit: kitInput("동시 B") })]);
  assert.notEqual(first.kit.id, second.kit.id);
  const another = createBrandKitStore(env.options);
  await Promise.all([
    env.store.update({ id: first.kit.id, expectedRevision: 1, kit: kitInput("동시 A 수정"), logoChange: { action: "keep" } }),
    another.update({ id: second.kit.id, expectedRevision: 1, kit: kitInput("동시 B 수정"), logoChange: { action: "keep" } }),
  ]);
  const registry = await another.read();
  assert.equal(registry.registryRevision, 4);
  assert.deepEqual(registry.kits.map(({ name, revision }) => [name, revision]).sort(), [["동시 A 수정", 2], ["동시 B 수정", 2]]);
});

test("corrupt JSON and invalid schema are explicit and preserve the original", async (t) => {
  const env = await storeEnv(t);
  await mkdir(join(env.root, "state"), { recursive: true });
  await writeFile(env.registryFile, "{not-json", "utf8");
  await assert.rejects(env.store.read(), errorCode("BRAND_KIT_STORE_INVALID"));
  assert.equal(await readFile(env.registryFile, "utf8"), "{not-json");
  await writeFile(env.registryFile, JSON.stringify({ schemaVersion: 7, registryRevision: 0, defaultBrandKitId: null, kits: [] }), "utf8");
  await assert.rejects(createBrandKitStore(env.options).read(), errorCode("BRAND_KIT_STORE_INVALID"));
  assert.equal(JSON.parse(await readFile(env.registryFile, "utf8")).schemaVersion, 7);
});

test("unsafe text and the 50-kit boundary reject without changing persisted bytes", async (t) => {
  const env = await storeEnv(t);
  const injected = kitInput("주입 거부"); injected.voice.summary = "<script>alert(1)</script>";
  await assert.rejects(env.store.create({ kit: injected }), errorCode("VALIDATION_ERROR"));
  await Promise.all(Array.from({ length: 50 }, (_, index) => env.store.create({ kit: kitInput(`키트 ${index + 1}`) })));
  const before = await readFile(env.registryFile);
  await assert.rejects(env.store.create({ kit: kitInput("초과") }), errorCode("BRAND_KIT_LIMIT_REACHED"));
  assert.deepEqual(await readFile(env.registryFile), before);
});

test("resolve and delete are linearizable and never return partial logo state", async (t) => {
  const env = await storeEnv(t);
  const first = await env.store.create({ kit: kitInput("선형화"), logoDataUrl: dataUrl("image/png", PNG) });
  const [resolved, deleted] = await Promise.all([
    env.store.resolveKit({ id: first.kit.id, expectedRevision: 1 }),
    env.store.delete({ id: first.kit.id, expectedRevision: 1, expectedRegistryRevision: 1 }),
  ]);
  assert.equal(resolved.kit.logo.assetId, sha(PNG));
  assert.equal(resolved.logoAbsolutePath, join(env.assetsDir, `${sha(PNG)}.png`));
  assert.equal(deleted.kits.length, 0);
  const second = await env.store.create({ kit: kitInput("삭제 우선") });
  const deletePromise = env.store.delete({ id: second.kit.id, expectedRevision: 1, expectedRegistryRevision: 3 });
  const resolvePromise = env.store.resolveKit({ id: second.kit.id, expectedRevision: 1 });
  await deletePromise;
  await assert.rejects(resolvePromise, errorCode("BRAND_KIT_NOT_FOUND"));
});

test("resolve rejects before returning when an immutable logo asset is missing", async (t) => {
  const env = await storeEnv(t);
  const created = await env.store.create({ kit: kitInput("자산 무결성"), logoDataUrl: dataUrl("image/png", PNG) });
  await rm(join(env.assetsDir, created.kit.logo.filename));
  await assert.rejects(env.store.resolveKit({ id: created.kit.id, expectedRevision: 1 }), errorCode("BRAND_KIT_ASSET_MISSING"));
});

async function storeEnv(t, optionOverrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "store-maker-brand-kit-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const registryFile = join(root, "state", "registry.json");
  const assetsDir = join(root, "assets");
  let sequence = 0;
  const options = { registryFile, assetsDir, now: () => "2026-08-19T00:00:00.000Z", createId: () => `kit-${++sequence}`, ...optionOverrides };
  return { root, registryFile, assetsDir, options, store: createBrandKitStore(options) };
}

function kitInput(name) {
  return {
    schemaVersion: 1, name, sourceUrl: "https://example.com/brand?secret=1#part",
    colors: { primary: "#111111", secondary: "#E8E8E8", accent: "#C24A2E", background: "#FFFFFF", surface: "#F5F5F5", text: "#111111" },
    typography: { displayFontId: "modern-sans-bold", bodyFontId: "readable-sans" },
    voice: { summary: "간결하고 정확하게 말합니다.", dos: ["근거 제시"], donts: ["과장"], sample: "매일 쓰는 도구입니다." },
    imagery: { presetId: "custom", mood: "차분한 분위기", lighting: "부드러운 빛", composition: "제품 중심", background: "밝은 배경", colorTreatment: "중립 색감", avoid: ["과한 네온"] },
    defaults: { adMoodPreset: "warm", imageStyle: "라이프스타일컷", imageBackground: "사용자 지정" },
  };
}

function makePng(width, height) {
  const bytes = Buffer.alloc(45);
  Buffer.from("89504e470d0a1a0a0000000d49484452", "hex").copy(bytes);
  bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20); bytes[24] = 8; bytes[25] = 6;
  Buffer.from("0000000049454e4400000000", "hex").copy(bytes, 33);
  return bytes;
}

function makeJpeg(width, height) {
  const bytes = Buffer.from("ffd8ffc0001108" + "00000000" + "03011100021100031100ffd9", "hex");
  bytes.writeUInt16BE(height, 7); bytes.writeUInt16BE(width, 9);
  return bytes;
}

function makeWebp(width, height) {
  const bytes = Buffer.alloc(30);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(22, 4); bytes.write("WEBPVP8X", 8); bytes.writeUInt32LE(10, 16);
  bytes.writeUIntLE(width - 1, 24, 3); bytes.writeUIntLE(height - 1, 27, 3);
  return bytes;
}

function dataUrl(type, bytes) { return `data:${type};base64,${bytes.toString("base64")}`; }
function sha(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function errorCode(code) { return (error) => error?.code === code; }
