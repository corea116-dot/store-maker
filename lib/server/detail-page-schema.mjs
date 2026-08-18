export const DETAIL_PAGE_KINDS = ["hero", "problem", "benefit", "feature", "usage", "spec", "faq", "cta", "text", "image"];
export const DETAIL_PAGE_LAYOUTS = ["text-only", "image-first", "image-last", "split-left", "split-right", "full-bleed"];
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
  if (input.schemaVersion !== 1) fail("document.schemaVersion must equal 1");
  const sectionsInput = arrayValue(input.sections, "document.sections");
  if (sectionsInput.length < 1 || sectionsInput.length > MAX_SECTIONS) {
    fail("document must contain between 1 and 60 sections");
  }
  const sectionIds = new Set();
  const imageIds = new Set();
  const sections = sectionsInput.map((section, index) => normalizeSection(section, index, sectionIds, imageIds));
  if (!sections.some(({ visible }) => visible)) fail("document must contain at least one visible section");
  return {
    schemaVersion: 1,
    title: textValue(input.title, "document.title", 200, { required: true }),
    productName: textValue(input.productName, "document.productName", 200, { required: true }),
    markets: normalizeMarkets(input.markets),
    sections,
  };
}

function normalizeSection(value, index, sectionIds, imageIds) {
  const path = `document.sections[${index}]`;
  const input = objectValue(value, path);
  const id = textValue(input.id, `${path}.id`, 120, { required: true });
  if (sectionIds.has(id)) fail(`${path}.id must be unique`);
  sectionIds.add(id);
  if (!DETAIL_PAGE_KINDS.includes(input.kind)) fail(`${path}.kind is not supported`);
  if (!DETAIL_PAGE_LAYOUTS.includes(input.layout)) fail(`${path}.layout is not supported`);
  if (!DETAIL_PAGE_SECTION_SOURCES.includes(input.source)) fail(`${path}.source is not supported`);
  if (typeof input.visible !== "boolean") fail(`${path}.visible must be boolean`);
  const bulletsInput = input.bullets === undefined ? [] : arrayValue(input.bullets, `${path}.bullets`);
  if (bulletsInput.length > MAX_BULLETS) fail(`${path}.bullets must contain at most 30 items`);
  const section = {
    id,
    kind: input.kind,
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

function normalizeImage(value, sectionPath, imageIds) {
  const path = `${sectionPath}.image`;
  const input = objectValue(value, path);
  const id = textValue(input.id, `${path}.id`, 120, { required: true });
  if (imageIds.has(id)) fail(`${path}.id must be unique`);
  imageIds.add(id);
  const url = textValue(input.url, `${path}.url`, 500, { required: true });
  if (!isOutputImageUrl(url)) fail(`${path}.url must reference an output image`);
  if (!DETAIL_PAGE_IMAGE_SOURCES.includes(input.source)) fail(`${path}.source is not supported`);
  const filename = textValue(input.filename, `${path}.filename`, 255, { required: true });
  if (filename.includes("/") || filename.includes("\\") || filename === "." || filename === "..") fail(`${path}.filename is invalid`);
  return {
    id,
    url,
    filename,
    alt: textValue(input.alt ?? "", `${path}.alt`, 200),
    source: input.source,
  };
}

function normalizeMarkets(value) {
  const markets = arrayValue(value, "document.markets");
  if (markets.length < 1 || markets.length > 20) fail("document.markets must contain between 1 and 20 items");
  return [...new Set(markets.map((market, index) => textValue(market, `document.markets[${index}]`, 80, { required: true })))];
}

function textValue(value, path, maxLength, options = {}) {
  if (typeof value !== "string") fail(`${path} must be a string`);
  const controls = options.multiline
    ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu
    : /[\u0000-\u001F\u007F]/gu;
  const normalized = value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").replace(controls, "").trim();
  if (options.required && normalized.length === 0) fail(`${path} is required`);
  if (normalized.length > maxLength) fail(`${path} must be ${maxLength} characters or fewer`);
  return normalized;
}

function isOutputImageUrl(value) {
  if (value.includes("%") || value.includes("?") || value.includes("#") || value.includes("..")) return false;
  return /^\/outputs\/image-runs\/[0-9a-f-]{8,}\/[a-z0-9._-]+\.(?:png|jpe?g|webp)$/iu.test(value);
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
