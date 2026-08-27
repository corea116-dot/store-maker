import { escapeHtml } from "./utils.mjs";

const CANVAS_BY_RATIO = Object.freeze({
  "1:1": Object.freeze({ width: 1080, height: 1080 }),
  "4:5": Object.freeze({ width: 1080, height: 1350 }),
  "16:9": Object.freeze({ width: 1600, height: 900 }),
});
const FONT_STACK = "Inter, 'Noto Sans KR', 'Apple SD Gothic Neo', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

export function renderAdCreativeImage({ ad, image, ratio }) {
  const sourceUrl = generatedImageUrl(image?.url);
  const headline = String(ad?.headline ?? "").trim();
  if (!sourceUrl || !headline) return "";

  const canvas = CANVAS_BY_RATIO[image?.brief?.ratio ?? ratio] ?? CANVAS_BY_RATIO["1:1"];
  const layout = headlineLayout(headline, canvas);
  const alt = [headline, String(ad?.visualBrief ?? "").trim()].filter(Boolean).join(" · ");
  const gradientId = `ad-creative-overlay-${safeId(ad?.id ?? image?.filename ?? "image")}`;
  const textNodes = layout.lines.map((line, index) => `<text x="${layout.padding}" y="${layout.startY + index * layout.lineHeight}" font-size="${layout.fontSize}" font-weight="800" letter-spacing="-1.4" fill="#ffffff" stroke="rgba(0, 0, 0, 0.18)" stroke-width="2" paint-order="stroke">${escapeHtml(line)}</text>`).join("");

  return `
    <figure class="ad-creative-image" data-ad-creative-image data-ad-id="${escapeHtml(ad?.id ?? "")}" data-ad-creative-source="${escapeHtml(sourceUrl)}" aria-label="${escapeHtml(alt)}">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvas.width} ${canvas.height}" role="img" aria-label="${escapeHtml(alt)}">
        <title>${escapeHtml(alt)}</title>
        <defs>
          <linearGradient id="${gradientId}" x1="0" x2="0" y1="0" y2="1">
            <stop offset="38%" stop-color="#000000" stop-opacity="0" />
            <stop offset="100%" stop-color="#000000" stop-opacity="0.84" />
          </linearGradient>
        </defs>
        <image href="${escapeHtml(sourceUrl)}" width="${canvas.width}" height="${canvas.height}" preserveAspectRatio="xMidYMid slice" />
        <rect width="${canvas.width}" height="${canvas.height}" fill="url(#${gradientId})" />
        <g font-family="${FONT_STACK}">${textNodes}</g>
      </svg>
    </figure>
  `;
}

function headlineLayout(headline, canvas) {
  const padding = Math.round(canvas.width * 0.07);
  const largestFont = Math.round(canvas.width * 0.066);
  const usableWidth = canvas.width - padding * 2;
  // Hangul glyphs are close to one em wide. Leave room for the outline and
  // font differences so every line remains inside the image safe area.
  const maxCharacters = Math.max(6, Math.floor(usableWidth / (largestFont * 1.03)));
  const lines = wrap(headline, maxCharacters);
  const fontSize = lines.length <= 2 ? largestFont : lines.length === 3 ? Math.round(canvas.width * 0.053) : Math.round(canvas.width * 0.043);
  const lineHeight = Math.round(fontSize * 1.24);
  return {
    lines,
    fontSize,
    lineHeight,
    padding,
    startY: canvas.height - padding - lineHeight * (lines.length - 1),
  };
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

function generatedImageUrl(value) {
  if (typeof value !== "string") return "";
  if (!/^\/outputs\/image-runs\/[a-z0-9-]+\/[a-z0-9._%()/-]+$/iu.test(value)) return "";
  return value.includes("..") ? "" : value;
}

function safeId(value) {
  return String(value).replace(/[^a-z0-9_-]/giu, "-") || "image";
}
