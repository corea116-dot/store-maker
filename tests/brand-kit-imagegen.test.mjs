import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";

import { runImageGeneration } from "../lib/server/imagegen.mjs";
import { parseGenerationRequest } from "../lib/server/prompt.mjs";
import { BRAND_ASSETS_DIR, IMAGE_RUNS_DIR, IMAGE_UPLOADS_DIR } from "../lib/server/config.mjs";

const pixelDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const logoBytes = Buffer.from(pixelDataUrl.split(",")[1], "base64");
const logoFilename = `${createHash("sha256").update(logoBytes).digest("hex")}.png`;

const brandStyle = {
  kitId: "kit-imagegen",
  kitRevision: 4,
  colors: {
    primary: "#1A1A1A", secondary: "#E8DFD4", accent: "#D45535",
    background: "#FFFFFF", surface: "#F7F5F2", text: "#111111", onPrimary: "#FFFFFF",
  },
  typography: { displayFontId: "modern-sans-bold", bodyFontId: "readable-sans" },
  voice: { summary: "차분하고 명확하게", dos: ["근거 먼저"], donts: ["과장"], sample: "조용한 차이가 오래갑니다." },
  imagery: {
    presetId: "custom", mood: "차분한 스튜디오", lighting: "부드러운 자연광",
    composition: "제품 중심과 넓은 여백", background: "크림 톤", colorTreatment: "저채도 웜톤", avoid: ["네온"],
  },
  image: { style: "라이프스타일", background: "사용자 지정", customBackground: "크림 톤" },
  ad: { moodPreset: "warm" },
  overrideFields: [],
  source: { brandUrl: "https://brand.example/", urlSafety: { status: "safe-reference", safeForFutureFetch: true, reason: "public" } },
};

test("Given one resolved brand kit When detail and ad images run Then each brief shares brand style and one ordered trusted logo reference", async (t) => {
  // Given: two different product requests, one server-owned logo, and product/design references.
  const logoPath = await trustedLogoFixture(t);

  const detailInput = brandedInput({ productName: "원목 데스크 램프", logoPath });
  const adInput = brandedInput({ productName: "캔버스 수납 바구니", logoPath, generationMode: "ad-set" });

  // When: both modes invoke the deterministic fake ImageGen surface.
  const detail = await runImageGeneration(detailInput);
  const ad = await runImageGeneration(adInput);
  for (const result of [detail, ad]) registerOutputCleanup(t, result);

  // Then: brand style is machine-consumed and equal, while product truth and reference precedence remain distinct.
  assert.equal(detail.ok, true);
  assert.equal(ad.ok, true);
  assert.deepEqual(detail.images.imageBriefs[0].brandStyle, brandStyle);
  assert.deepEqual(ad.images.imageBriefs[0].brandStyle, brandStyle);
  assert.notDeepEqual(detail.images.imageBriefs[0].productTruth, ad.images.imageBriefs[0].productTruth);
  assert.deepEqual(detail.images.referenceFiles.map(({ name, role }) => ({ name, role })), [
    { name: "product.png", role: "product-image" },
    { name: logoFilename, role: "brand-logo" },
    { name: "design.png", role: "design-reference" },
  ]);
  assert.deepEqual(detail.images.manifest.imageInputs, ["01-product.png", logoFilename, "02-design.png"]);
  const serialized = JSON.stringify([detail.images, ad.images]);
  assert.doesNotMatch(serialized, /data:image|logoAbsolutePath|store-maker-brand-imagegen-red|\/tmp\//u);
});

test("Given references are disabled When ImageGen runs Then no product logo or design image argument is passed", async (t) => {
  // Given: all three reference roles exist but the request disables reference use.
  const logoPath = await trustedLogoFixture(t);
  const input = brandedInput({ productName: "참조 해제 상품", logoPath, useReference: false });

  // When: the deterministic fake records its actual image argv.
  const result = await runImageGeneration(input);
  registerOutputCleanup(t, result);

  // Then: the invocation and public result contain zero reference files.
  assert.equal(result.ok, true);
  assert.deepEqual(result.images.manifest.imageInputs, []);
  assert.deepEqual(result.images.referenceFiles, []);
});

test("Given no complete server logo application When ImageGen runs Then brand-logo is omitted", async (t) => {
  // Given: a public snapshot without a runtime path, followed by a runtime path without public logo metadata.
  const logoPath = await trustedLogoFixture(t);
  const missingRuntime = brandedInput({ productName: "런타임 없는 상품", logoPath: undefined });
  const missingPublic = brandedInput({ productName: "공개 메타 없는 상품", logoPath });
  delete missingPublic.brandKitSnapshot.logo;

  // When: both incomplete applications run.
  const first = await runImageGeneration(missingRuntime);
  const second = await runImageGeneration(missingPublic);
  for (const result of [first, second]) registerOutputCleanup(t, result);

  // Then: neither invocation fabricates a brand-logo reference.
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.images.referenceFiles.some(({ role }) => role === "brand-logo"), false);
  assert.equal(second.images.referenceFiles.some(({ role }) => role === "brand-logo"), false);
});

test("Given complete logo metadata with a missing runtime asset When ImageGen runs Then brand-logo is omitted", async (t) => {
  // Given: canonical public metadata paired with a stale resolver path that does not exist.
  const missingPath = join(BRAND_ASSETS_DIR, `${"f".repeat(64)}.png`);
  await rm(missingPath, { force: true });
  const input = brandedInput({ productName: "누락 자산 상품", logoPath: missingPath });

  // When: the deterministic fake records the actual reference argv.
  const result = await runImageGeneration(input);
  registerOutputCleanup(t, result);

  // Then: stale runtime state cannot create a trusted public or provider reference.
  assert.equal(result.ok, true);
  assert.equal(result.images.referenceFiles.some(({ role }) => role === "brand-logo"), false);
  assert.deepEqual(result.images.manifest.imageInputs, ["01-product.png", "02-design.png"]);
});

test("Given directory symlink escape or out-of-root logo paths When ImageGen runs Then only product and design references remain", async (t) => {
  const outside = await mkdtemp(join(tmpdir(), "store-maker-brand-logo-boundary-"));
  const directoryPath = join(BRAND_ASSETS_DIR, `${"d".repeat(64)}.png`);
  const symlinkPath = join(BRAND_ASSETS_DIR, `${"e".repeat(64)}.png`);
  const outsidePath = join(outside, `${"c".repeat(64)}.png`);
  await mkdir(BRAND_ASSETS_DIR, { recursive: true });
  await Promise.all([rm(directoryPath, { recursive: true, force: true }), rm(symlinkPath, { force: true }), writeFile(outsidePath, logoBytes)]);
  await mkdir(directoryPath);
  await symlink(outsidePath, symlinkPath);
  t.after(() => rm(outside, { recursive: true, force: true }));
  t.after(() => rm(directoryPath, { recursive: true, force: true }));
  t.after(() => rm(symlinkPath, { force: true }));

  for (const [label, logoPath] of [["directory", directoryPath], ["symlink", symlinkPath], ["outside", outsidePath]]) {
    const result = await runImageGeneration(brandedInput({ productName: `${label} 경계 상품`, logoPath }));
    registerOutputCleanup(t, result);
    assert.equal(result.ok, true);
    assert.deepEqual(result.images.referenceFiles.map(({ role }) => role), ["product-image", "design-reference"]);
    assert.deepEqual(result.images.manifest.imageInputs, ["01-product.png", "02-design.png"]);
    assert.doesNotMatch(JSON.stringify(result), /store-maker-brand-logo-boundary|\/tmp\//u);
  }
});

test("Given hostile client logo roles and paths When ImageGen runs Then only the resolved server logo is used", async (t) => {
  // Given: client-shaped attachment/runtime logo attempts plus one canonical server application.
  const tempRoot = await mkdtemp(join(tmpdir(), "store-maker-brand-imagegen-hostile-"));
  const logoPath = await trustedLogoFixture(t);
  const hostilePath = join(tempRoot, "client-logo.png");
  await writeFile(hostilePath, logoBytes);
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const input = brandedInput({ productName: "신뢰 경계 상품", logoPath });
  input.runtime.imageAttachmentSources.push({ name: "client-logo.png", role: "brand-logo", type: "image/png", dataUrl: pixelDataUrl });
  input.runtime.imageReferenceFiles = [{ name: "client-path.png", role: "brand-logo", type: "image/png", size: 68, absolutePath: hostilePath }];

  // When: ImageGen resolves references.
  const result = await runImageGeneration(input);
  registerOutputCleanup(t, result);

  // Then: client logo channels are absent and the trusted logo appears exactly once.
  assert.equal(result.ok, true);
  assert.deepEqual(result.images.referenceFiles.filter(({ role }) => role === "brand-logo"), [
    { name: logoFilename, role: "brand-logo", type: "image/png", size: 68 },
  ]);
  assert.equal(result.images.manifest.imageInputs.filter((name) => name === logoFilename).length, 1);
  assert.doesNotMatch(JSON.stringify(result), /client-logo|client-path|logoAbsolutePath|store-maker-brand-imagegen-hostile/u);
});

test("Given shortfall retry and duplicate repair When ImageGen reruns Then the brand logo never accumulates", async (t) => {
  // Given: one request that needs a shortfall retry and one that needs duplicate repair.
  const logoPath = await trustedLogoFixture(t);
  const retryInput = brandedInput({ productName: "재시도 상품", logoPath, imageCount: 2, command: "./scripts/fake-codex-imagegen.mjs --limit-images 1" });
  const repairInput = brandedInput({ productName: "중복 복구 상품", logoPath, imageCount: 2, command: "./scripts/fake-codex-imagegen.mjs --duplicate-first-pass" });

  // When: the retry and duplicate-repair paths complete through the fake executable.
  const retry = await runImageGeneration(retryInput);
  const repair = await runImageGeneration(repairInput);
  for (const result of [retry, repair]) registerOutputCleanup(t, result);

  // Then: both complete with two unique files and one public logo reference per invocation contract.
  assert.equal(retry.ok, true);
  assert.equal(repair.ok, true);
  for (const result of [retry, repair]) {
    assert.equal(result.images.files.length, 2);
    assert.equal(new Set(result.images.files.map(({ contentHash }) => contentHash)).size, 2);
    assert.equal(result.images.referenceFiles.filter(({ role }) => role === "brand-logo").length, 1);
    assert.equal(result.images.manifest.imageInputs.filter((name) => name === logoFilename).length, 1);
  }
});

test("Given an already cancelled request When ImageGen is called Then no reference metadata or runtime path is emitted", async () => {
  // Given: cancellation before any provider preparation.
  const controller = new AbortController();
  controller.abort();
  const input = brandedInput({ productName: "취소 상품", logoPath: "/tmp/never-used-logo.png" });

  // When: the ImageGen boundary observes cancellation.
  const result = await runImageGeneration(input, { signal: controller.signal });

  // Then: cancellation is terminal and leak-free.
  assert.equal(result.ok, false);
  assert.equal(result.aborted, true);
  assert.doesNotMatch(JSON.stringify(result), /never-used-logo|logoAbsolutePath|brand-logo/u);
});

test("Given a branded provider reports completion without an image When ImageGen runs Then it fails without leaking references", async (t) => {
  // Given: a fake provider that prints completion but writes no image and one trusted logo.
  const logoPath = await trustedLogoFixture(t);
  const input = brandedInput({ productName: "실패 상품", logoPath, command: "./scripts/fake-codex-imagegen.mjs --no-image-output" });
  const ownerMarker = `failure-owned-${process.pid}.png`;
  input.runtime.imageAttachmentSources[0].name = ownerMarker;

  // When: both the initial attempt and bounded retry produce zero files.
  const result = await runImageGeneration(input);
  const ownedRunIds = [];
  for (const runId of await readdir(IMAGE_UPLOADS_DIR)) {
    const files = await readdir(join(IMAGE_UPLOADS_DIR, runId)).catch(() => []);
    if (files.some((name) => name.endsWith(ownerMarker))) ownedRunIds.push(runId);
  }
  t.after(async () => {
    await Promise.all(ownedRunIds.map((runId) => rm(join(IMAGE_RUNS_DIR, runId), { recursive: true, force: true })));
    await Promise.all(ownedRunIds.map((runId) => rm(join(IMAGE_UPLOADS_DIR, runId), { recursive: true, force: true })));
  });

  // Then: provider prose cannot masquerade as image success and public diagnostics remain clean.
  assert.equal(result.ok, false);
  assert.equal(ownedRunIds.length, 1);
  assert.equal(result.logs.some(({ level, title }) => level === "error" && title === "image generation failed"), true);
  assert.doesNotMatch(JSON.stringify(result), /logoAbsolutePath|data:image|store-maker-brand-imagegen-failure|\/tmp\//u);
});

test("Given no brand kit When ImageGen runs Then the legacy brief shape has no brand-only fields", async (t) => {
  // Given: a legacy parsed request with no server brand application.
  const input = brandedInput({ productName: "비브랜드 상품", logoPath: undefined });
  delete input.brandKitSnapshot;
  delete input.effectiveBrandStyle;

  // When: ImageGen runs through the existing fake.
  const result = await runImageGeneration(input);
  registerOutputCleanup(t, result);

  // Then: the old brief does not acquire brand-only structured fields.
  assert.equal(result.ok, true);
  assert.equal(Object.hasOwn(result.images.imageBriefs[0], "brandStyle"), false);
  assert.equal(Object.hasOwn(result.images.imageBriefs[0], "productTruth"), false);
  assert.equal(result.images.referenceFiles.some(({ role }) => role === "brand-logo"), false);
});

function brandedInput({ productName, logoPath, generationMode, useReference = true, imageCount = 1, command = "./scripts/fake-codex-imagegen.mjs" }) {
  const parsed = parseGenerationRequest({
    ...(generationMode ? { generationMode, brand: { url: "https://legacy.example/" }, adAutomation: { moodPreset: "warm" } } : {}),
    engine: { mode: "local-cli", engineId: "custom", command: `${process.execPath} scripts/mock-engine.mjs` },
    imageGeneration: {
      enabled: true,
      provider: "codex-imagegen",
      command,
      count: imageCount,
      ratio: "1:1",
      style: "라이프스타일",
      background: "사용자 지정",
      customBackground: "크림 톤",
      useReference,
      timeoutMs: 2000,
    },
    product: {
      name: productName,
      description: `${productName}의 실제 상품 설명`,
      requirements: `${productName} 형태와 재질을 보존`,
      attachments: [
        { name: "product.png", role: "product-image", type: "image/png", size: 68, kind: "image", previewDataUrl: pixelDataUrl },
        { name: "design.png", role: "design-reference", type: "image/png", size: 68, kind: "image", previewDataUrl: pixelDataUrl },
      ],
    },
    markets: ["smartstore"],
  });
  assert.equal(parsed.ok, true);
  const filename = logoPath ? basename(logoPath) : logoFilename;
  return {
    ...parsed.value,
    brandKitSnapshot: {
      id: brandStyle.kitId,
      revision: brandStyle.kitRevision,
      logo: { assetId: filename.replace(/\.png$/u, ""), filename, type: "image/png", size: 68, url: `/outputs/brand-assets/${filename}` },
    },
    effectiveBrandStyle: structuredClone(brandStyle),
    runtime: { ...parsed.value.runtime, ...(logoPath ? { logoAbsolutePath: logoPath } : {}) },
  };
}

async function trustedLogoFixture(t) {
  await mkdir(BRAND_ASSETS_DIR, { recursive: true });
  const logoPath = join(BRAND_ASSETS_DIR, logoFilename);
  await writeFile(logoPath, logoBytes);
  t.after(() => rm(logoPath, { force: true }));
  return logoPath;
}

function registerOutputCleanup(t, result) {
  if (!result.ok) return;
  t.after(() => rm(new URL(`../${result.images.outputDir}/`, import.meta.url), { recursive: true, force: true }));
  t.after(() => rm(new URL(`../outputs/uploads/${result.images.runId}/`, import.meta.url), { recursive: true, force: true }));
}
