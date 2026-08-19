import assert from "node:assert/strict";
import test from "node:test";

import { createBrandKitApplication, createBrandKitSnapshot, deriveEffectiveBrandStyle, normalizeBrandKit } from "../lib/server/brand-kit-model.mjs";
import { AD_MOOD_PRESET_IDS, BODY_FONT_OPTIONS, BRAND_STYLE_PRECEDENCE, CANONICAL_OVERRIDE_FIELDS, DISPLAY_FONT_OPTIONS, IMAGERY_PRESETS, IMAGE_BACKGROUND_OPTIONS, IMAGE_STYLE_OPTIONS } from "../assets/brand-kit-options.js";

const imageStyles = ["자동 다양화", "여러 스타일", "제품 단독컷", "라이프스타일컷", "상세페이지 배너", "사용 장면", "소셜 광고컷", "프리미엄 클로즈업", "구성품/패키지컷", "리뷰/UGC 느낌", "정보형 인포그래픽", "시즌/선물컷"];
const baseKit = () => ({
  schemaVersion: 1, id: "stable-uuid", revision: 3, name: "창이 스튜디오", sourceUrl: "https://user:secret@example.com/?token=remove#private",
  logo: { assetId: "abc123", filename: "logo.png", type: "image/png", size: 184320, url: "/outputs/brand-assets/abc123.png" },
  colors: { primary: "#111111", secondary: "#f2e9df", accent: "#d45535", background: "#ffffff", surface: "#f7f5f2", text: "#111111" },
  typography: { displayFontId: "modern-sans-bold", bodyFontId: "readable-sans" },
  voice: { summary: "짧고 자신감 있게 말하되 근거 없는 과장은 피한다.", dos: ["사용 장면을 먼저 말하기"], donts: ["무조건 1위 표현"], sample: "매일 쓰는 도구일수록 조용한 차이가 오래갑니다." },
  imagery: { presetId: "custom", mood: "차분하고 따뜻한 스튜디오", lighting: "부드러운 오전 자연광", composition: "제품 중심, 넓은 여백", background: "밝은 원목과 크림 톤", colorTreatment: "저채도 웜톤", avoid: ["과한 네온", "복잡한 소품"] },
  defaults: { adMoodPreset: "warm", imageStyle: "라이프스타일컷", imageBackground: "사용자 지정" }, createdAt: "2026-08-19T00:00:00.000Z", updatedAt: "2026-08-19T01:00:00.000Z",
});

function capture(operation) { try { operation(); } catch (error) { return error; } assert.fail("expected validation error"); }
function fields(error) { assert.equal(error.status, 422); assert.equal(error.code, "VALIDATION_ERROR"); return error.fields.map(({ field }) => field); }

test("all fixed catalogs match the approved ordered literals", () => {
  assert.deepEqual(DISPLAY_FONT_OPTIONS, [
    { id: "modern-sans-bold", stack: 'Pretendard, "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', weight: 700 },
    { id: "editorial-serif-bold", stack: '"Noto Serif KR", "Nanum Myeongjo", Georgia, serif', weight: 700 },
    { id: "rounded-sans-bold", stack: '"Arial Rounded MT Bold", Pretendard, "Noto Sans KR", sans-serif', weight: 700 },
  ]);
  assert.deepEqual(BODY_FONT_OPTIONS, [
    { id: "readable-sans", stack: 'Pretendard, "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', weight: 400 },
    { id: "readable-serif", stack: '"Noto Serif KR", "Nanum Myeongjo", Georgia, serif', weight: 400 },
    { id: "system-sans", stack: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans KR", sans-serif', weight: 400 },
  ]);
  assert.deepEqual(IMAGERY_PRESETS, {
    custom: null,
    "clean-studio": { mood: "정돈되고 선명한 스튜디오", lighting: "균일한 확산광", composition: "제품 중심 넓은 여백", background: "흰색 또는 연회색", colorTreatment: "중립 저채도" },
    "warm-lifestyle": { mood: "차분하고 따뜻한 생활 공간", lighting: "부드러운 오전 자연광", composition: "사용 장면과 자연스러운 여백", background: "밝은 원목과 크림 톤", colorTreatment: "저채도 웜톤" },
    "premium-editorial": { mood: "절제된 고급 편집 화보", lighting: "방향성 있는 소프트 라이트", composition: "비대칭 편집 구도", background: "짙은 중립 배경", colorTreatment: "깊은 저채도" },
    "bold-commerce": { mood: "선명하고 활기찬 커머스", lighting: "또렷한 하이라이트", composition: "모바일 중심 강한 구도", background: "대비 배경", colorTreatment: "선명한 포인트 컬러" },
  });
  assert.deepEqual(AD_MOOD_PRESET_IDS, ["clean", "bold", "editorial", "premium", "warm", "fresh", "minimal", "energetic", "technical", "gift", "seasonal"]);
  assert.deepEqual(IMAGE_STYLE_OPTIONS, imageStyles);
  assert.deepEqual(IMAGE_BACKGROUND_OPTIONS, ["흰 배경", "사무실", "책상 위", "스튜디오", "사용자 지정"]);
  assert.deepEqual(CANONICAL_OVERRIDE_FIELDS, ["adMoodPreset", "imageStyle", "imageBackground", "imageCustomBackground"]);
  assert.deepEqual(BRAND_STYLE_PRECEDENCE, ["product-and-legal", "job-override", "brand-kit", "app-defaults"]);
});

test("literal approved Korean BrandKit normalizes exact shape and limits", () => {
  const normalized = normalizeBrandKit(baseKit());
  assert.deepEqual(Object.keys(normalized), ["schemaVersion", "id", "revision", "name", "sourceUrl", "sourceUrlSafety", "logo", "colors", "typography", "voice", "imagery", "defaults", "createdAt", "updatedAt"]);
  assert.deepEqual(normalized.colors, { primary: "#111111", secondary: "#F2E9DF", accent: "#D45535", background: "#FFFFFF", surface: "#F7F5F2", text: "#111111", onPrimary: "#FFFFFF" });
  assert.deepEqual(normalized.voice, baseKit().voice);
  assert.deepEqual(normalized.imagery, baseKit().imagery);
  assert.deepEqual(normalized.logo, baseKit().logo);
  const benign = baseKit(); benign.voice.summary = "HTML이 아닌 <와 > 기호는 쓰지 않습니다. 한글 문장은 안전합니다."; benign.voice.sample = "생활 속 사용 장면을 차분하게 설명합니다.";
  assert.equal(normalizeBrandKit(benign).voice.sample, benign.voice.sample);
});

test("public, stripped, local, private, link-local and IPv6 URL safety matches existing semantics", () => {
  const cases = [
    ["https://example.com/path", "safe-reference", true, "https://example.com/path"],
    ["https://user:pass@example.com/path?q=1#x", "safe-reference", true, "https://example.com/path"],
    ["http://localhost:4317/x", "unsafe-for-future-fetch", false, "http://localhost:4317/x"],
    ["http://192.168.1.20/x", "unsafe-for-future-fetch", false, "http://192.168.1.20/x"],
    ["http://169.254.1.2/x", "unsafe-for-future-fetch", false, "http://169.254.1.2/x"],
    ["http://[::1]/x", "unsafe-for-future-fetch", false, "http://[::1]/x"],
  ];
  for (const [url, status, safeForFutureFetch, expected] of cases) { const kit = baseKit(); kit.sourceUrl = url; const value = normalizeBrandKit(kit); assert.equal(value.sourceUrl, expected); assert.equal(value.sourceUrlSafety.status, status); assert.equal(value.sourceUrlSafety.safeForFutureFetch, safeForFutureFetch); }
  const stripped = normalizeBrandKit(baseKit()); assert.match(stripped.sourceUrlSafety.reason, /자격 정보, query, fragment/u); assert.equal(JSON.stringify(stripped).includes("secret"), false);
  const optional = baseKit(); optional.sourceUrl = null; optional.logo = null; const absent = normalizeBrandKit(optional); assert.equal(absent.sourceUrl, null); assert.equal(absent.sourceUrlSafety.status, "absent"); assert.equal(absent.logo, null);
});

test("IPv4-mapped IPv6 decodes private, loopback and link-local without blocking public IPv4", () => {
  const cases = [
    ["http://[::ffff:192.168.1.1]/x", "unsafe-for-future-fetch", false],
    ["http://[::ffff:127.0.0.1]/x", "unsafe-for-future-fetch", false],
    ["http://[::ffff:169.254.1.2]/x", "unsafe-for-future-fetch", false],
    ["http://[::ffff:8.8.8.8]/x", "safe-reference", true],
  ];
  for (const [sourceUrl, status, safeForFutureFetch] of cases) { const kit = baseKit(); kit.sourceUrl = sourceUrl; const normalized = normalizeBrandKit(kit); assert.equal(normalized.sourceUrlSafety.status, status, normalized.sourceUrl); assert.equal(normalized.sourceUrlSafety.safeForFutureFetch, safeForFutureFetch); }
});

test("named imagery presets populate explicit scalars and retain explicit avoid", () => {
  for (const presetId of ["clean-studio", "warm-lifestyle", "premium-editorial", "bold-commerce"]) { const kit = baseKit(); kit.imagery = { presetId, avoid: ["워터마크"] }; assert.deepEqual(normalizeBrandKit(kit).imagery, { presetId, ...IMAGERY_PRESETS[presetId], avoid: ["워터마크"] }); }
  const kit = baseKit(); kit.imagery = { presetId: "custom", mood: "차분함", avoid: [] };
  assert.deepEqual(fields(capture(() => normalizeBrandKit(kit))), ["imagery.lighting", "imagery.composition", "imagery.background", "imagery.colorTreatment"]);
  delete kit.imagery.avoid; assert.ok(fields(capture(() => normalizeBrandKit(kit))).includes("imagery.avoid"));
});

test("voice and imagery enforce exact approved limits", () => {
  const boundary = baseKit(); boundary.voice.summary = "가".repeat(500); boundary.voice.sample = "나".repeat(500); boundary.voice.dos = Array(10).fill("다".repeat(160)); boundary.voice.donts = Array(10).fill("라".repeat(160)); boundary.imagery.mood = "마".repeat(300); boundary.imagery.lighting = "바".repeat(300); boundary.imagery.composition = "사".repeat(300); boundary.imagery.background = "아".repeat(300); boundary.imagery.colorTreatment = "자".repeat(300); boundary.imagery.avoid = Array(10).fill("차".repeat(120)); assert.equal(normalizeBrandKit(boundary).voice.summary.length, 500);
  const cases = [
    ["voice.summary", (v) => { v.voice.summary = "가".repeat(501); }], ["voice.sample", (v) => { v.voice.sample = "가".repeat(501); }],
    ["voice.dos", (v) => { v.voice.dos = Array(11).fill("하기"); }], ["voice.donts.0", (v) => { v.voice.donts = ["가".repeat(161)]; }],
    ["imagery.mood", (v) => { v.imagery.mood = "가".repeat(301); }], ["imagery.avoid", (v) => { v.imagery.avoid = Array(11).fill("피하기"); }], ["imagery.avoid.0", (v) => { v.imagery.avoid = ["가".repeat(121)]; }],
  ];
  for (const [field, mutate] of cases) { const kit = baseKit(); mutate(kit); assert.ok(fields(capture(() => normalizeBrandKit(kit))).includes(field), field); }
});

test("every free-text boundary rejects markup, event handlers, CSS and script payloads", () => {
  const payloads = ["<img src=x onerror=alert(1)>", "<svg onload=alert(1)>", "<script>alert(1)</script>", "<style>body{display:none}</style>", "url(https://evil.test/x)", "javascript:alert(1)", "data:text/html,bad", "font-family: Evil;", "color: red;", "alert(1)"];
  const boundaries = [(v, p) => { v.name = p; }, (v, p) => { v.voice.summary = p; }, (v, p) => { v.voice.dos = [p]; }, (v, p) => { v.voice.donts = [p]; }, (v, p) => { v.voice.sample = p; }, (v, p) => { v.imagery.mood = p; }, (v, p) => { v.imagery.lighting = p; }, (v, p) => { v.imagery.composition = p; }, (v, p) => { v.imagery.background = p; }, (v, p) => { v.imagery.colorTreatment = p; }, (v, p) => { v.imagery.avoid = [p]; }];
  for (const payload of payloads) for (const mutate of boundaries) { const kit = baseKit(); mutate(kit, payload); const error = capture(() => normalizeBrandKit(kit)); assert.equal(error.status, 422, payload); }
});

test("snapshot has exact approved public keys and runtime path stays sibling-only", () => {
  const normalized = normalizeBrandKit(baseKit());
  const application = createBrandKitApplication(normalized, { appliedAt: "2026-08-19T10:00:00.000Z", overrideFields: ["imageStyle", "adMoodPreset"], logoAbsolutePath: "/private/runtime/logo.png" });
  const snapshot = application.snapshot;
  assert.deepEqual(Object.keys(snapshot), ["schemaVersion", "id", "revision", "name", "source", "appliedAt", "logo", "colors", "typography", "voice", "imagery", "effectiveDefaults", "overrideFields"]);
  assert.deepEqual(snapshot.source, { brandUrl: normalized.sourceUrl, urlSafety: normalized.sourceUrlSafety });
  assert.deepEqual(snapshot.logo, { assetId: "abc123", filename: "logo.png", type: "image/png", size: 184320, url: "/outputs/brand-assets/abc123.png" });
  assert.deepEqual(snapshot.typography, { displayFontId: "modern-sans-bold", bodyFontId: "readable-sans" });
  assert.deepEqual(snapshot.effectiveDefaults, normalized.defaults);
  assert.deepEqual(snapshot.overrideFields, ["adMoodPreset", "imageStyle"]);
  assert.equal(application.runtime.logoAbsolutePath, "/private/runtime/logo.png");
  assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(snapshot))), Object.keys(snapshot));
  for (const leak of ["kitId", "kitRevision", '"defaults"', "logoAbsolutePath", "/private/", "data:image", "secret", "token="]) assert.equal(JSON.stringify(snapshot).includes(leak), false, leak);
});

test("effectiveBrandStyle is deterministic with exact schema, precedence and canonical overrides", () => {
  const snapshot = createBrandKitSnapshot(normalizeBrandKit(baseKit()), { appliedAt: "2026-08-19T10:00:00.000Z" });
  const defaults = { adMoodPreset: "clean", imageStyle: "제품 단독컷", imageBackground: "흰 배경" };
  const overrides = { imageCustomBackground: "짙은 한지", imageBackground: "사용자 지정", imageStyle: "소셜 광고컷", adMoodPreset: "bold" };
  const style = deriveEffectiveBrandStyle(snapshot, overrides, defaults);
  assert.deepEqual(style, deriveEffectiveBrandStyle(snapshot, { adMoodPreset: "bold", imageStyle: "소셜 광고컷", imageBackground: "사용자 지정", imageCustomBackground: "짙은 한지" }, defaults));
  assert.deepEqual(Object.keys(style), ["kitId", "kitRevision", "colors", "typography", "voice", "imagery", "image", "ad", "overrideFields", "source"]);
  assert.deepEqual(style.image, { style: "소셜 광고컷", background: "사용자 지정", customBackground: "짙은 한지" }); assert.deepEqual(style.ad, { moodPreset: "bold" }); assert.deepEqual(style.overrideFields, CANONICAL_OVERRIDE_FIELDS);
});

test("unknown IDs, contrast, raw fonts and incomplete custom background return structured 422 fields", () => {
  const invalid = [["typography.displayFontId", (v) => { v.typography.displayFontId = "font-family: url(x)"; }], ["imagery.presetId", (v) => { v.imagery.presetId = "unknown"; }], ["defaults.adMoodPreset", (v) => { v.defaults.adMoodPreset = "unknown"; }], ["defaults.imageStyle", (v) => { v.defaults.imageStyle = "unknown"; }], ["colors.text", (v) => { v.colors.text = "#FFFFFF"; }]];
  for (const [field, mutate] of invalid) { const kit = baseKit(); mutate(kit); assert.ok(fields(capture(() => normalizeBrandKit(kit))).includes(field), field); }
  const snapshot = createBrandKitSnapshot(normalizeBrandKit(baseKit()), { appliedAt: "2026-08-19T10:00:00.000Z" }); const defaults = { adMoodPreset: "clean", imageStyle: "제품 단독컷", imageBackground: "흰 배경" };
  assert.ok(fields(capture(() => deriveEffectiveBrandStyle(snapshot, { imageBackground: "사용자 지정" }, defaults))).includes("overrides.imageCustomBackground"));
  assert.ok(fields(capture(() => deriveEffectiveBrandStyle(snapshot, { fontFamily: "url(x)" }, defaults))).includes("overrides.fontFamily"));
});
