import { normalizeDetailPageDocument } from "./detail-page-schema.mjs";

export {
  DETAIL_PAGE_IMAGE_SOURCES,
  DETAIL_PAGE_KINDS,
  DETAIL_PAGE_LAYOUTS,
  DETAIL_PAGE_SECTION_SOURCES,
  DetailPageDocumentValidationError,
  normalizeDetailPageDocument,
} from "./detail-page-schema.mjs";
export { renderDetailPageDocument } from "./detail-page-render.mjs";

const KIND_PATTERNS = [
  ["problem", /문제|불편|고민|pain|problem/iu],
  ["benefit", /장점|효과|혜택|benefit/iu],
  ["feature", /기능|특징|핵심|feature/iu],
  ["usage", /사용|방법|활용|how\s*to|usage/iu],
  ["spec", /사양|스펙|제원|spec/iu],
  ["faq", /자주\s*묻|질문|faq/iu],
  ["cta", /구매|지금|선택|cta|order/iu],
];

const IMAGE_KIND_PATTERNS = [
  ["hero", /대표|메인|hero|main/iu],
  ["feature", /기능|특징|상세|feature|detail/iu],
  ["usage", /사용|활용|라이프스타일|usage|lifestyle/iu],
];

export function createDetailPageDocument({ title, productName, markets, markdown, images }) {
  const parsed = parseMarkdown(typeof markdown === "string" ? markdown : "");
  const sections = parsed.sections.length > 0
    ? parsed.sections.map((block, index) => toSection(block, index, !parsed.hasSectionHeadings))
    : [toSection({ heading: "", body: parsed.fallbackBody, bullets: [], preamble: false }, 0)];
  assignImages(sections, imageFiles(images), productName);
  return normalizeDetailPageDocument({
    schemaVersion: 1,
    title: parsed.title || title || `${productName} 상세페이지`,
    productName,
    markets,
    sections,
  });
}

function parseMarkdown(markdown) {
  const lines = markdown.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  let title = "";
  let current = { heading: "", bodyLines: [], bullets: [], preamble: true };
  const blocks = [];
  let hasSectionHeadings = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!title && /^#\s+/u.test(line)) {
      title = line.replace(/^#\s+/u, "").trim();
      continue;
    }
    if (/^#{2,3}\s+/u.test(line)) {
      hasSectionHeadings = true;
      pushBlock(blocks, current);
      current = { heading: line.replace(/^#{2,3}\s+/u, "").trim(), bodyLines: [], bullets: [], preamble: false };
      continue;
    }
    if (/^-\s+/u.test(line)) {
      current.bullets.push(line.replace(/^-\s+/u, "").trim());
      continue;
    }
    current.bodyLines.push(rawLine.trimEnd());
  }
  pushBlock(blocks, current);
  const fallbackBody = markdown.replace(/^#\s+.*(?:\n|$)/u, "").trim();
  return { title, sections: blocks, fallbackBody, hasSectionHeadings };
}

function pushBlock(blocks, block) {
  const body = trimBlankLines(block.bodyLines).join("\n").trim();
  if (!block.heading && !body && block.bullets.length === 0) return;
  blocks.push({ heading: block.heading, body, bullets: block.bullets.filter(Boolean), preamble: block.preamble });
}

function toSection(block, index = 0, forceText = false) {
  const kind = forceText ? "text" : block.preamble ? "hero" : inferKind(block.heading);
  return {
    id: sectionId(index, block.heading || kind),
    kind,
    layout: "text-only",
    visible: true,
    heading: block.heading || (kind === "hero" ? "" : "상세 정보"),
    body: block.body,
    bullets: block.bullets,
    source: "generated",
  };
}

function assignImages(sections, files, productName) {
  let splitIndex = 0;
  const unmatched = [];
  files.forEach((file, index) => {
    const image = toImage(file, index, productName);
    const desiredKind = inferImageKind(`${file.purpose ?? ""} ${file.brief?.purpose ?? ""}`);
    const target = desiredKind ? sections.find((section) => section.kind === desiredKind && !section.image) : undefined;
    if (!target) {
      unmatched.push({ image, purpose: file.purpose ?? file.brief?.purpose ?? "생성 이미지" });
      return;
    }
    target.image = image;
    target.layout = target.kind === "hero" ? "full-bleed" : splitIndex++ % 2 === 0 ? "split-left" : "split-right";
  });
  for (const { image, purpose } of unmatched) {
    sections.push({
      id: sectionId(sections.length, image.filename),
      kind: "image",
      layout: "full-bleed",
      visible: true,
      heading: purpose,
      body: "",
      bullets: [],
      image,
      source: "generated",
    });
  }
}

function imageFiles(images) {
  if (Array.isArray(images?.files)) return images.files.filter((file) => file && typeof file === "object" && file.url && file.filename);
  return [];
}

function toImage(file, index, productName) {
  return {
    id: `image-${index + 1}-${slug(file.filename) || "asset"}`,
    url: file.url,
    filename: String(file.filename).split(/[\\/]/u).at(-1) || "asset.png",
    alt: `${productName} ${file.purpose ?? file.brief?.purpose ?? file.filename}`.trim(),
    source: file.source === "edited" ? "edited" : "generated",
  };
}

function inferKind(heading) {
  return KIND_PATTERNS.find(([, pattern]) => pattern.test(heading))?.[0] ?? "text";
}

function inferImageKind(purpose) {
  return IMAGE_KIND_PATTERNS.find(([, pattern]) => pattern.test(purpose))?.[0];
}

function sectionId(index, label) {
  return `section-${index + 1}-${slug(label) || "content"}`;
}

function slug(value) {
  return String(value).normalize("NFKC").toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 48);
}

function trimBlankLines(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start += 1;
  while (end > start && !lines[end - 1].trim()) end -= 1;
  return lines.slice(start, end);
}
