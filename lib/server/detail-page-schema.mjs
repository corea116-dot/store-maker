import {
  DETAIL_PAGE_LAYOUTS as REGISTRY_LAYOUTS,
  DETAIL_PAGE_SECTION_TYPES,
  getDetailPageSectionType,
  normalizeDetailPageSectionKind,
} from "./detail-page-section-registry.mjs";

export const DETAIL_PAGE_KINDS = DETAIL_PAGE_SECTION_TYPES;
export const DETAIL_PAGE_LAYOUTS = REGISTRY_LAYOUTS;
export const DETAIL_PAGE_SECTION_SOURCES = ["generated", "user"];
export const DETAIL_PAGE_IMAGE_SOURCES = ["generated", "edited"];

const MAX_SECTIONS = 60;
const MAX_BULLETS = 30;

export class DetailPageDocumentValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "DetailPageDocumentValidationError";
  }
}

export function normalizeDetailPageDocument(value) {
  const input = objectValue(value, "document");
  if (input.schemaVersion !== 1 && input.schemaVersion !== 2) fail("document.schemaVersion must equal 1 or 2");
  const sectionsInput = arrayValue(input.sections, "document.sections");
  if (sectionsInput.length < 1 || sectionsInput.length > MAX_SECTIONS) {
    fail("document must contain between 1 and 60 sections");
  }
  const sectionIds = new Set();
  const imageIds = new Set();
  const sections = sectionsInput.map((section, index) => normalizeSection(section, index, sectionIds, imageIds));
  if (!sections.some(({ visible }) => visible)) fail("document must contain at least one visible section");
  return {
    schemaVersion: 2,
    title: textValue(input.title, "document.title", 200, { required: true }),
    productName: textValue(input.productName, "document.productName", 200, { required: true }),
    markets: normalizeMarkets(input.markets),
    ...(input.brand === undefined ? {} : { brand: normalizeBrand(input.brand) }),
    sections,
  };
}

export function migrateDetailPageDocument(value) {
  const input = objectValue(value, "document");
  if (input.schemaVersion !== 1 && input.schemaVersion !== 2) fail("document.schemaVersion must equal 1 or 2");
  const rawSections = arrayValue(input.sections, "document.sections");
  if (rawSections.length < 1 || rawSections.length > MAX_SECTIONS) fail("document must contain between 1 and 60 sections");
  const warnings = [];
  const sectionIds = new Set();
  const imageIds = new Set();
  const document = normalizeDetailPageDocument({
    schemaVersion: 2,
    title: migrationText(input.title, "상세페이지", "title", warnings),
    productName: migrationText(input.productName, "상품", "productName", warnings),
    markets: migrationMarkets(input.markets, warnings),
    ...(input.brand === undefined ? {} : { brand: migrationBrand(input.brand, warnings) }),
    sections: rawSections.map((section, index) => migrateSection(section, index, sectionIds, imageIds, warnings)),
  });
  return {
    document,
    report: {
      fromSchemaVersion: input.schemaVersion,
      migrated: input.schemaVersion !== 2 || warnings.length > 0,
      warnings,
    },
  };
}

function normalizeSection(value, index, sectionIds, imageIds) {
  const path = `document.sections[${index}]`;
  const input = objectValue(value, path);
  const id = textValue(input.id, `${path}.id`, 120, { required: true });
  if (sectionIds.has(id)) fail(`${path}.id must be unique`);
  sectionIds.add(id);
  const kind = normalizeDetailPageSectionKind(input.kind);
  if (!kind) fail(`${path}.kind is not supported`);
  const type = getDetailPageSectionType(kind);
  if (!type.allowedLayouts.includes(input.layout)) fail(`${path}.layout is not supported for ${kind}`);
  if (!DETAIL_PAGE_SECTION_SOURCES.includes(input.source)) fail(`${path}.source is not supported`);
  if (typeof input.visible !== "boolean") fail(`${path}.visible must be boolean`);
  const bulletsInput = input.bullets === undefined ? [] : arrayValue(input.bullets, `${path}.bullets`);
  if (bulletsInput.length > MAX_BULLETS) fail(`${path}.bullets must contain at most 30 items`);
  const section = {
    id,
    kind,
    layout: input.layout,
    visible: input.visible,
    heading: textValue(input.heading ?? "", `${path}.heading`, 200),
    body: textValue(input.body ?? "", `${path}.body`, 20_000, { multiline: true }),
    bullets: bulletsInput.map((bullet, bulletIndex) => textValue(bullet, `${path}.bullets[${bulletIndex}]`, 500, { required: true })),
    source: input.source,
  };
  if (input.image !== undefined && input.image !== null) section.image = normalizeImage(input.image, path, imageIds);
  return section;
}

function migrateSection(value, index, sectionIds, imageIds, warnings) {
  const path = `document.sections[${index}]`;
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  if (input !== value) warnings.push({ code: "SECTION_FIELD_FALLBACK", sectionIndex: index, field: "section" });
  const id = migrationId(input.id, index, sectionIds, warnings);
  const originalKind = typeof input.kind === "string" ? input.kind : "";
  const kind = normalizeDetailPageSectionKind(originalKind);
  const canonicalKind = kind ?? "free-text";
  if (!kind) warnings.push({ code: "UNKNOWN_SECTION_KIND", sectionId: id, originalKind: originalKind || "unknown" });
  const type = getDetailPageSectionType(canonicalKind);
  const layout = type.allowedLayouts.includes(input.layout) ? input.layout : type.defaultLayout;
  if (layout !== input.layout) warnings.push({ code: "SECTION_FIELD_FALLBACK", sectionId: id, field: "layout" });
  const source = DETAIL_PAGE_SECTION_SOURCES.includes(input.source) ? input.source : "generated";
  if (source !== input.source) warnings.push({ code: "SECTION_FIELD_FALLBACK", sectionId: id, field: "source" });
  const visible = typeof input.visible === "boolean" ? input.visible : true;
  if (visible !== input.visible) warnings.push({ code: "SECTION_FIELD_FALLBACK", sectionId: id, field: "visible" });
  const bullets = Array.isArray(input.bullets)
    ? input.bullets.filter((item) => typeof item === "string").slice(0, MAX_BULLETS).map((item) => migrationText(item, "", "bullet", warnings, { sectionId: id, maxLength: 500 })).filter(Boolean)
    : [];
  if (!Array.isArray(input.bullets) && input.bullets !== undefined) warnings.push({ code: "SECTION_FIELD_FALLBACK", sectionId: id, field: "bullets" });
  const section = {
    id,
    kind: canonicalKind,
    layout,
    visible,
    heading: migrationText(input.heading, "", "heading", warnings, { sectionId: id, maxLength: 200 }),
    body: migrationText(input.body, "", "body", warnings, { sectionId: id, maxLength: 20_000, multiline: true }),
    bullets,
    source,
  };
  const image = migrateImage(input.image, imageIds, warnings, id, path);
  if (image) section.image = image;
  return section;
}

function normalizeImage(value, sectionPath, imageIds) {
  const path = `${sectionPath}.image`;
  const input = objectValue(value, path);
  const id = textValue(input.id, `${path}.id`, 120, { required: true });
  if (imageIds.has(id)) fail(`${path}.id must be unique`);
  imageIds.add(id);
  const inputUrl = textValue(input.url, `${path}.url`, 500, { required: true });
  const outputImage = parseOutputImageUrl(inputUrl);
  if (!outputImage) fail(`${path}.url must reference an output image`);
  if (!DETAIL_PAGE_IMAGE_SOURCES.includes(input.source)) fail(`${path}.source is not supported`);
  const filename = textValue(input.filename, `${path}.filename`, 255, { required: true });
  if (filename.includes("/") || filename.includes("\\") || filename === "." || filename === "..") fail(`${path}.filename is invalid`);
  return {
    id,
    url: outputImage.url,
    filename,
    alt: textValue(input.alt ?? "", `${path}.alt`, 200),
    source: input.source,
  };
}

function migrateImage(value, imageIds, warnings, sectionId, path) {
  if (value === undefined || value === null) return undefined;
  try {
    return normalizeImage(value, path, imageIds);
  } catch (error) {
    warnings.push({ code: "SECTION_FIELD_FALLBACK", sectionId, field: "image" });
    return undefined;
  }
}

function normalizeMarkets(value) {
  const markets = arrayValue(value, "document.markets");
  if (markets.length < 1 || markets.length > 20) fail("document.markets must contain between 1 and 20 items");
  return [...new Set(markets.map((market, index) => textValue(market, `document.markets[${index}]`, 80, { required: true })))];
}

function migrationMarkets(value, warnings) {
  if (!Array.isArray(value)) {
    warnings.push({ code: "DOCUMENT_FIELD_FALLBACK", field: "markets" });
    return ["smartstore"];
  }
  const markets = value.filter((item) => typeof item === "string").map((item) => cleanText(item, 80)).filter(Boolean).slice(0, 20);
  if (markets.length === 0) {
    warnings.push({ code: "DOCUMENT_FIELD_FALLBACK", field: "markets" });
    return ["smartstore"];
  }
  return [...new Set(markets)];
}

function normalizeBrand(value) {
  const input = objectValue(value, "document.brand");
  return { name: textValue(input.name, "document.brand.name", 200) };
}

function migrationBrand(value, warnings) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    warnings.push({ code: "DOCUMENT_FIELD_FALLBACK", field: "brand" });
    return { name: "" };
  }
  return { name: migrationText(value.name, "", "brand.name", warnings, { maxLength: 200 }) };
}

function migrationId(value, index, usedIds, warnings) {
  let id = typeof value === "string" ? cleanText(value, 120) : "";
  if (!id || usedIds.has(id)) {
    const base = `legacy-section-${index + 1}`;
    id = base;
    let suffix = 1;
    while (usedIds.has(id)) id = `${base}-${suffix++}`;
    warnings.push({ code: "SECTION_FIELD_FALLBACK", sectionIndex: index, field: "id" });
  }
  usedIds.add(id);
  return id;
}

function migrationText(value, fallback, field, warnings, options = {}) {
  if (typeof value !== "string") {
    if (value !== undefined) warnings.push({ code: "SECTION_FIELD_FALLBACK", ...(options.sectionId ? { sectionId: options.sectionId } : {}), field });
    return fallback;
  }
  const normalized = cleanText(value, options.maxLength ?? 200, options);
  if (normalized !== value.trim().replaceAll("\r\n", "\n").replaceAll("\r", "\n")) {
    warnings.push({ code: "SECTION_FIELD_FALLBACK", ...(options.sectionId ? { sectionId: options.sectionId } : {}), field });
  }
  return normalized || fallback;
}

function cleanText(value, maxLength, options = {}) {
  const controls = options.multiline
    ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu
    : /[\u0000-\u001F\u007F]/gu;
  return String(value).replaceAll("\r\n", "\n").replaceAll("\r", "\n").replace(controls, "").trim().slice(0, maxLength);
}

function textValue(value, path, maxLength, options = {}) {
  if (typeof value !== "string") fail(`${path} must be a string`);
  const normalized = cleanText(value, Number.POSITIVE_INFINITY, options);
  if (options.required && normalized.length === 0) fail(`${path} is required`);
  if (normalized.length > maxLength) fail(`${path} must be ${maxLength} characters or fewer`);
  return normalized;
}

export function parseOutputImageUrl(value) {
  if (typeof value !== "string" || value.length > 500 || /[?#\\\u0000-\u001F\u007F]/u.test(value)) return undefined;
  const segments = value.split("/");
  if (segments.length < 5 || segments[0] !== "" || segments[1] !== "outputs" || segments[2] !== "image-runs") return undefined;
  const runId = segments[3];
  if (!/^[0-9a-f-]{8,}$/iu.test(runId)) return undefined;
  const decodedSegments = [];
  for (const segment of segments.slice(4)) {
    if (!segment) return undefined;
    let decoded;
    try {
      decoded = decodeURIComponent(segment);
    } catch (error) {
      return undefined;
    }
    if (!decoded || decoded === "." || decoded === ".." || /[\/#?\\\u0000-\u001F\u007F]/u.test(decoded)) return undefined;
    decodedSegments.push(decoded);
  }
  if (!/\.(?:png|jpe?g|webp)$/iu.test(decodedSegments.at(-1))) return undefined;
  return {
    url: `/outputs/image-runs/${runId}/${decodedSegments.map((segment) => encodeURIComponent(segment)).join("/")}`,
    relativePath: [runId, ...decodedSegments].join("/"),
    filename: decodedSegments.at(-1),
  };
}

function objectValue(value, path) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(`${path} must be an object`);
  return value;
}

function arrayValue(value, path) {
  if (!Array.isArray(value)) fail(`${path} must be an array`);
  return value;
}

function fail(message) {
  throw new DetailPageDocumentValidationError(message);
}
