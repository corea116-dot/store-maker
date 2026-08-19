import {
  AD_MOOD_PRESET_IDS,
  BODY_FONT_OPTIONS,
  CANONICAL_OVERRIDE_FIELDS,
  DISPLAY_FONT_OPTIONS,
  IMAGERY_PRESETS,
  IMAGE_BACKGROUND_OPTIONS,
  IMAGE_STYLE_OPTIONS,
} from "../../assets/brand-kit-options.js";

const COLOR_FIELDS = ["primary", "secondary", "accent", "background", "surface", "text"];
const IMAGERY_SCALARS = ["mood", "lighting", "composition", "background", "colorTreatment"];
const UNSAFE_TEXT = /<\s*\/?\s*[a-z][^>]*>|\bon[a-z]+\s*=|javascript\s*:|data\s*:\s*text\/html|url\s*\(|@import\b|(?:expression|eval|alert)\s*\(|(?:font-family|background(?:-color)?|color|position|display)\s*:/iu;

export class BrandKitValidationError extends Error {
  constructor(fields) {
    super("브랜드 키트 입력을 확인하세요.");
    this.name = "BrandKitValidationError";
    this.code = "VALIDATION_ERROR";
    this.status = 422;
    this.fields = fields;
  }
}

export function normalizeBrandKit(input) {
  const errors = [];
  const value = object(input);
  if (value.schemaVersion !== 1) add(errors, "schemaVersion", "unsupported", "schemaVersion은 1이어야 합니다.");
  const id = identifier(value.id, "id", errors);
  const revision = positiveInteger(value.revision) ? value.revision : (add(errors, "revision", "invalid", "revision은 양의 정수여야 합니다."), undefined);
  const name = text(value.name, "name", errors, 80);
  const source = normalizeSourceUrl(value.sourceUrl, errors);
  const logo = normalizePublicLogo(value.logo, errors);
  const colors = normalizeColors(value.colors, errors);
  const typography = normalizeTypography(value.typography, errors);
  const voice = normalizeVoice(value.voice, errors);
  const imagery = normalizeImagery(value.imagery, errors);
  const defaults = normalizeDefaults(value.defaults, errors, "defaults");
  const createdAt = timestamp(value.createdAt, "createdAt", errors);
  const updatedAt = timestamp(value.updatedAt, "updatedAt", errors);
  if (errors.length) throw new BrandKitValidationError(errors);
  return { schemaVersion: 1, id, revision, name, sourceUrl: source.brandUrl, sourceUrlSafety: source.urlSafety, logo, colors, typography, voice, imagery, defaults, createdAt, updatedAt };
}

export function createBrandKitSnapshot(kit, options = {}) {
  const errors = [];
  const appliedAt = timestamp(options.appliedAt, "appliedAt", errors);
  if (errors.length) throw new BrandKitValidationError(errors);
  return {
    schemaVersion: 1,
    id: kit.id,
    revision: kit.revision,
    name: kit.name,
    source: { brandUrl: kit.sourceUrl, urlSafety: clone(kit.sourceUrlSafety) },
    appliedAt,
    logo: clone(kit.logo),
    colors: clone(kit.colors),
    typography: clone(kit.typography),
    voice: clone(kit.voice),
    imagery: clone(kit.imagery),
    effectiveDefaults: clone(kit.defaults),
    overrideFields: CANONICAL_OVERRIDE_FIELDS.filter((field) => Array.isArray(options.overrideFields) && options.overrideFields.includes(field)),
  };
}

export function createBrandKitApplication(kit, options = {}) {
  const snapshot = createBrandKitSnapshot(kit, options);
  const runtime = options.logoAbsolutePath ? { logoAbsolutePath: String(options.logoAbsolutePath) } : {};
  return { snapshot, runtime };
}

export function deriveEffectiveBrandStyle(snapshot, overrides = {}, appDefaults = {}) {
  const errors = [];
  const base = normalizeDefaults(appDefaults, errors, "appDefaults");
  const kitDefaults = normalizeDefaults(snapshot?.effectiveDefaults, errors, "snapshot.effectiveDefaults");
  const override = normalizeOverrides(overrides, errors);
  if (errors.length) throw new BrandKitValidationError(errors);
  const selected = { ...base, ...kitDefaults, ...override };
  const overrideFields = CANONICAL_OVERRIDE_FIELDS.filter((field) => Object.hasOwn(override, field));
  const customBackground = selected.imageBackground === "사용자 지정"
    ? (Object.hasOwn(override, "imageBackground") ? override.imageCustomBackground : snapshot.imagery.background)
    : null;
  return {
    kitId: snapshot.id,
    kitRevision: snapshot.revision,
    colors: clone(snapshot.colors),
    typography: clone(snapshot.typography),
    voice: clone(snapshot.voice),
    imagery: clone(snapshot.imagery),
    image: { style: selected.imageStyle, background: selected.imageBackground, customBackground },
    ad: { moodPreset: selected.adMoodPreset },
    overrideFields,
    source: clone(snapshot.source),
  };
}

function normalizeSourceUrl(raw, errors) {
  if (raw === null || raw === undefined || raw === "") return { brandUrl: null, urlSafety: { status: "absent", safeForFutureFetch: false, reason: "브랜드 URL이 제공되지 않았습니다." } };
  if (typeof raw !== "string" || raw.length > 2048 || /[\u0000-\u001f\u007f]/u.test(raw)) { add(errors, "sourceUrl", "invalid", "HTTP(S) URL만 입력할 수 있습니다."); return {}; }
  try {
    const url = new URL(raw.trim());
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("protocol");
    const stripped = Boolean(url.username || url.password || url.search || url.hash);
    url.username = ""; url.password = ""; url.search = ""; url.hash = "";
    const unsafeReason = unsafeHostReason(url.hostname);
    return {
      brandUrl: url.toString(),
      urlSafety: unsafeReason
        ? { status: "unsafe-for-future-fetch", safeForFutureFetch: false, reason: unsafeReason }
        : { status: "safe-reference", safeForFutureFetch: true, reason: stripped ? "URL의 자격 정보, query, fragment를 제외한 참조 주소만 사용했습니다." : "공개 참조 주소 형식입니다. 자동 가져오기는 수행하지 않습니다." },
    };
  } catch { add(errors, "sourceUrl", "invalid", "HTTP(S) URL만 입력할 수 있습니다."); return {}; }
}

function normalizePublicLogo(raw, errors) {
  if (raw === null || raw === undefined) return null;
  const value = object(raw);
  const result = { assetId: value.assetId, filename: value.filename, type: value.type, size: value.size, url: value.url };
  if (typeof result.assetId !== "string" || !/^[a-z0-9_-]{1,128}$/u.test(result.assetId)) add(errors, "logo.assetId", "invalid", "공개 자산 ID가 필요합니다.");
  if (typeof result.filename !== "string" || !/^[^/\\\u0000-\u001f\u007f]{1,160}$/u.test(result.filename) || UNSAFE_TEXT.test(result.filename)) add(errors, "logo.filename", "invalid", "안전한 파일명이 필요합니다.");
  if (!["image/png", "image/jpeg", "image/webp"].includes(result.type)) add(errors, "logo.type", "invalid", "PNG, JPEG, WebP만 사용할 수 있습니다.");
  if (!positiveInteger(result.size) || result.size > 2 * 1024 * 1024) add(errors, "logo.size", "invalid", "로고 크기는 2MiB 이하여야 합니다.");
  if (typeof result.url !== "string" || !/^\/outputs\/brand-assets\/[a-z0-9_-]+\.(?:png|jpe?g|webp)$/u.test(result.url)) add(errors, "logo.url", "invalid", "공개 브랜드 자산 URL이 필요합니다.");
  return result;
}

function normalizeColors(raw, errors) {
  const value = object(raw); const result = {};
  for (const field of COLOR_FIELDS) {
    if (typeof value[field] !== "string" || !/^#[0-9a-f]{6}$/iu.test(value[field])) add(errors, `colors.${field}`, "invalid_color", "#RRGGBB 형식이어야 합니다.");
    else result[field] = value[field].toUpperCase();
  }
  if (result.text && result.background && contrast(result.text, result.background) < 4.5) add(errors, "colors.text", "low_contrast", "본문과 배경의 명암비는 4.5:1 이상이어야 합니다.");
  if (result.primary) result.onPrimary = contrast(result.primary, "#000000") >= contrast(result.primary, "#FFFFFF") ? "#000000" : "#FFFFFF";
  return result;
}

function normalizeTypography(raw, errors) {
  const value = object(raw);
  return {
    displayFontId: choice(value.displayFontId, DISPLAY_FONT_OPTIONS.map(({ id }) => id), "typography.displayFontId", errors),
    bodyFontId: choice(value.bodyFontId, BODY_FONT_OPTIONS.map(({ id }) => id), "typography.bodyFontId", errors),
  };
}

function normalizeVoice(raw, errors) {
  const value = object(raw);
  return { summary: text(value.summary, "voice.summary", errors, 500), dos: textArray(value.dos, "voice.dos", errors, 10, 160), donts: textArray(value.donts, "voice.donts", errors, 10, 160), sample: text(value.sample, "voice.sample", errors, 500) };
}

function normalizeImagery(raw, errors) {
  const value = object(raw);
  const presetId = choice(value.presetId, Object.keys(IMAGERY_PRESETS), "imagery.presetId", errors);
  const suggestion = presetId && presetId !== "custom" ? IMAGERY_PRESETS[presetId] : {};
  const result = { presetId };
  for (const field of IMAGERY_SCALARS) result[field] = text(value[field] ?? suggestion?.[field], `imagery.${field}`, errors, 300);
  result.avoid = value.avoid === undefined && presetId !== "custom" ? [] : textArray(value.avoid, "imagery.avoid", errors, 10, 120);
  return result;
}

function normalizeDefaults(raw, errors, prefix) {
  const value = object(raw);
  if (Object.hasOwn(value, "imageCustomBackground")) add(errors, `${prefix}.imageCustomBackground`, "not_allowed", "키트 기본값에는 저장할 수 없습니다.");
  return { adMoodPreset: choice(value.adMoodPreset, AD_MOOD_PRESET_IDS, `${prefix}.adMoodPreset`, errors), imageStyle: choice(value.imageStyle, IMAGE_STYLE_OPTIONS, `${prefix}.imageStyle`, errors), imageBackground: choice(value.imageBackground, IMAGE_BACKGROUND_OPTIONS, `${prefix}.imageBackground`, errors) };
}

function normalizeOverrides(raw, errors) {
  const value = object(raw); const result = {};
  for (const field of Object.keys(value)) if (!CANONICAL_OVERRIDE_FIELDS.includes(field)) add(errors, `overrides.${field}`, "not_allowed", "허용되지 않는 오버라이드입니다.");
  for (const [field, allowed] of [["adMoodPreset", AD_MOOD_PRESET_IDS], ["imageStyle", IMAGE_STYLE_OPTIONS], ["imageBackground", IMAGE_BACKGROUND_OPTIONS]]) if (Object.hasOwn(value, field)) result[field] = choice(value[field], allowed, `overrides.${field}`, errors);
  if (Object.hasOwn(value, "imageCustomBackground")) result.imageCustomBackground = text(value.imageCustomBackground, "overrides.imageCustomBackground", errors, 300);
  if (result.imageBackground === "사용자 지정" && !result.imageCustomBackground) add(errors, "overrides.imageCustomBackground", "required", "사용자 지정 배경 설명이 필요합니다.");
  if (result.imageBackground !== "사용자 지정" && Object.hasOwn(result, "imageCustomBackground")) add(errors, "overrides.imageCustomBackground", "not_allowed", "사용자 지정 배경에서만 사용할 수 있습니다.");
  return result;
}

function textArray(raw, field, errors, maxItems, maxLength) {
  if (!Array.isArray(raw)) { add(errors, field, "invalid_type", "배열이어야 합니다."); return []; }
  if (raw.length > maxItems) add(errors, field, "too_many", `${maxItems}개 이하여야 합니다.`);
  return raw.map((item, index) => text(item, `${field}.${index}`, errors, maxLength));
}

function text(raw, field, errors, max) {
  if (typeof raw !== "string") { add(errors, field, "invalid_type", "문자열이어야 합니다."); return ""; }
  const value = raw.trim();
  if (!value) add(errors, field, "required", "필수 입력입니다.");
  else if (value.length > max) add(errors, field, "too_long", `${max}자 이하여야 합니다.`);
  else if (/[\u0000-\u001f\u007f]/u.test(value) || UNSAFE_TEXT.test(value)) add(errors, field, "unsafe_text", "HTML, CSS, 스크립트 또는 제어 문자를 사용할 수 없습니다.");
  return value;
}

function unsafeHostReason(hostname) {
  const host = String(hostname ?? "").toLowerCase().replace(/^\[/u, "").replace(/\]$/u, "");
  if (host === "localhost" || host.endsWith(".local")) return "로컬 또는 사설 호스트는 자동 가져오기 대상이 아닙니다.";
  const mapped = ipv4MappedAddress(host) ?? host;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(mapped)) { const p = mapped.split(".").map(Number); if (p[0] === 0 || p[0] === 127 || p[0] === 10 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || (p[0] === 169 && p[1] === 254)) return "로컬, 사설 또는 링크 로컬 IPv4 주소는 자동 가져오기 대상이 아닙니다."; }
  const first = Number.parseInt(host.split(":")[0] || "0", 16);
  if (host === "::" || host === "::1" || host === "0:0:0:0:0:0:0:0" || host === "0:0:0:0:0:0:0:1" || (Number.isInteger(first) && ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80))) return "로컬, 사설 또는 링크 로컬 IPv6 주소는 자동 가져오기 대상이 아닙니다.";
  return undefined;
}

function ipv4MappedAddress(host) {
  if (!host.startsWith("::ffff:")) return undefined;
  const tail = host.slice("::ffff:".length);
  if (tail.includes(".")) return tail;
  const groups = tail.split(":");
  if (groups.length !== 2 || groups.some((group) => !/^[0-9a-f]{1,4}$/u.test(group))) return undefined;
  const high = Number.parseInt(groups[0], 16); const low = Number.parseInt(groups[1], 16);
  return [(high >> 8) & 255, high & 255, (low >> 8) & 255, low & 255].join(".");
}

function choice(value, allowed, field, errors) { if (!allowed.includes(value)) { add(errors, field, "unknown_id", "지원하지 않는 값입니다."); return undefined; } return value; }
function identifier(value, field, errors) { if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,120}$/u.test(value)) { add(errors, field, "invalid", "안전한 ID가 필요합니다."); return ""; } return value; }
function timestamp(value, field, errors) { if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) { add(errors, field, "invalid", "유효한 ISO 날짜가 필요합니다."); return undefined; } return new Date(value).toISOString(); }
function contrast(a, b) { const [la, lb] = [a, b].map(luminance); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
function luminance(hex) { const rgb = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]; }
function positiveInteger(value) { return Number.isInteger(value) && value > 0; }
function object(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function add(errors, field, code, message) { errors.push({ field, code, message }); }
function clone(value) { return value === undefined ? undefined : structuredClone(value); }
