export function readObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

export function shorten(value, max) {
  if (!value) return "상품 입력";
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

export function firstUsefulLine(markdown) {
  if (!markdown?.trim()) return undefined;
  return markdown.split("\n").map((line) => line.replace(/^#+\s*/u, "").trim()).find((line) => line.length > 0);
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function clampConfidence(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Number(Math.min(1, Math.max(0, number)).toFixed(2));
}

export function cleanText(value, max = 240) {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized ? shorten(normalized, max) : undefined;
}
