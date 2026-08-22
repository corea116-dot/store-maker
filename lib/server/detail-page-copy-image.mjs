const COPY_IMAGE_TOKENS = Object.freeze({
  frameInset: 24,
  minHeight: 400,
  pagePadding: 72,
  pageWidth: 1120,
  colors: Object.freeze({
    body: "#252525",
    canvas: "#ffffff",
    eyebrow: "#5f5f5f",
    primary: "#0b0b0b",
    rule: "#c8c8c8",
    strong: "#111111",
  }),
  spacing: Object.freeze({
    bodyLine: 48,
    bulletAfter: 8,
    bulletContinuationIndent: 56,
    bulletIndent: 36,
    bulletLine: 46,
    headingAfter: 20,
    headingLine: 74,
    headingTop: 62,
    paragraphAfter: 16,
    ruleAfter: 52,
  }),
  typography: Object.freeze({
    body: Object.freeze({ size: 30, weight: 500 }),
    bullet: Object.freeze({ size: 28, weight: 700 }),
    eyebrow: Object.freeze({ size: 22, weight: 800 }),
    heading: Object.freeze({ size: 58, weight: 900 }),
  }),
});
const PAGE_WIDTH = COPY_IMAGE_TOKENS.pageWidth;
const PAGE_PADDING = COPY_IMAGE_TOKENS.pagePadding;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_PADDING * 2;
const FONT_STACK = "Inter, 'Noto Sans KR', 'Apple SD Gothic Neo', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

export function createDetailPageCopyImage({ productName, title, section, index }) {
  const content = copyImageContent({ productName, title, section, index });
  const layout = layoutCopy(content);
  const svg = renderSvg(layout);
  return {
    alt: content.alt,
    height: layout.height,
    svg,
    width: PAGE_WIDTH,
  };
}

function copyImageContent({ productName, title, section, index }) {
  if (!section) {
    return {
      eyebrow: "상세페이지",
      heading: title,
      body: productName ? [productName] : [],
      bullets: [],
      alt: `${title}${productName ? ` · ${productName}` : ""}`,
    };
  }
  const heading = String(section.heading ?? "").trim() || productName || title;
  const body = lines(section.body);
  const bullets = Array.isArray(section.bullets) ? section.bullets.filter(Boolean) : [];
  return {
    eyebrow: `상세페이지 · ${String(index + 1).padStart(2, "0")} · ${section.kind}`,
    heading,
    body,
    bullets,
    alt: [heading, ...body, ...bullets].filter(Boolean).join(" · "),
  };
}

function layoutCopy(content) {
  const { colors, spacing, typography } = COPY_IMAGE_TOKENS;
  let y = PAGE_PADDING;
  const nodes = [];
  nodes.push(textNode(content.eyebrow, PAGE_PADDING, y, typography.eyebrow.size, typography.eyebrow.weight, colors.eyebrow));
  y += spacing.headingTop;

  for (const line of wrap(content.heading, 16)) {
    nodes.push(textNode(line, PAGE_PADDING, y, typography.heading.size, typography.heading.weight, colors.primary));
    y += spacing.headingLine;
  }

  if (content.body.length > 0 || content.bullets.length > 0) {
    y += spacing.headingAfter;
    nodes.push(ruleNode(PAGE_PADDING, y));
    y += spacing.ruleAfter;
  }

  for (const paragraph of content.body) {
    for (const line of wrap(paragraph, 29)) {
      nodes.push(textNode(line, PAGE_PADDING, y, typography.body.size, typography.body.weight, colors.body));
      y += spacing.bodyLine;
    }
    y += spacing.paragraphAfter;
  }

  for (const bullet of content.bullets) {
    const bulletLines = wrap(bullet, 27);
    for (const [lineIndex, line] of bulletLines.entries()) {
      const x = lineIndex === 0 ? PAGE_PADDING + spacing.bulletIndent : PAGE_PADDING + spacing.bulletContinuationIndent;
      if (lineIndex === 0) nodes.push(circleNode(PAGE_PADDING + 11, y - 10));
      nodes.push(textNode(line, x, y, typography.bullet.size, typography.bullet.weight, colors.strong));
      y += spacing.bulletLine;
    }
    y += spacing.bulletAfter;
  }

  return { height: Math.max(COPY_IMAGE_TOKENS.minHeight, y + PAGE_PADDING - spacing.bulletAfter), nodes };
}

function renderSvg({ height, nodes }) {
  const { colors, frameInset } = COPY_IMAGE_TOKENS;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_WIDTH}" height="${height}" viewBox="0 0 ${PAGE_WIDTH} ${height}" role="img"><rect width="100%" height="100%" fill="${colors.canvas}"/><rect x="${frameInset}" y="${frameInset}" width="${PAGE_WIDTH - frameInset * 2}" height="${height - frameInset * 2}" fill="none" stroke="${colors.rule}" stroke-dasharray="3 8"/><g font-family="${FONT_STACK}">${nodes.join("")}</g></svg>`;
}

function textNode(value, x, y, size, weight, fill) {
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}">${escapeXml(value)}</text>`;
}

function ruleNode(x, y) {
  return `<line x1="${x}" y1="${y}" x2="${x + CONTENT_WIDTH}" y2="${y}" stroke="${COPY_IMAGE_TOKENS.colors.rule}" stroke-width="2"/>`;
}

function circleNode(x, y) {
  return `<circle cx="${x}" cy="${y}" r="6" fill="${COPY_IMAGE_TOKENS.colors.strong}"/>`;
}

function lines(value) {
  return String(value ?? "").split(/\n{2,}/u).map((line) => line.replaceAll("\n", " ").trim()).filter(Boolean);
}

function wrap(value, maxCharacters) {
  const words = String(value).trim().split(/\s+/u).filter(Boolean);
  const wrapped = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (characterCount(candidate) <= maxCharacters) {
      current = candidate;
      continue;
    }
    if (current) wrapped.push(current);
    current = "";
    for (const fragment of splitLongWord(word, maxCharacters)) {
      if (characterCount(fragment) === maxCharacters) wrapped.push(fragment);
      else current = fragment;
    }
  }
  if (current) wrapped.push(current);
  return wrapped.length > 0 ? wrapped : [""];
}

function splitLongWord(value, maxCharacters) {
  const characters = Array.from(value);
  if (characters.length <= maxCharacters) return [value];
  const pieces = [];
  for (let index = 0; index < characters.length; index += maxCharacters) pieces.push(characters.slice(index, index + maxCharacters).join(""));
  return pieces;
}

function characterCount(value) {
  return Array.from(value).length;
}

function escapeXml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}
