const allowedExtensions = new Set(["png", "jpg", "jpeg", "webp", "pdf", "txt", "md", "csv"]);
const defaultTypes = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
};
const compatibleTypes = {
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  webp: ["image/webp"],
  pdf: ["application/pdf"],
  txt: ["text/plain"],
  md: ["text/markdown", "text/plain"],
  csv: ["text/csv", "text/plain", "application/vnd.ms-excel"],
};

export function readAttachments(value) {
  if (!Array.isArray(value)) return { ok: true, value: [] };
  const attachments = [];
  for (const item of value) {
    const result = readAttachment(item);
    if (!result.ok) return result;
    attachments.push(result.value);
  }
  return { ok: true, value: attachments };
}

export function readImageAttachmentSources(rawValue, attachments) {
  if (!Array.isArray(rawValue)) return [];
  const available = new Map((attachments ?? []).filter((attachment) => attachment.kind === "image").map((attachment) => [attachment.name, attachment]));
  const sources = [];
  for (const item of rawValue) {
    const input = readObject(item);
    const name = safeFileName(readString(input.name));
    const attachment = name ? available.get(name) : undefined;
    if (!attachment) continue;
    const dataUrl = readString(input.sourceDataUrl) ?? readString(input.previewDataUrl);
    if (!dataUrl || !isImageDataUrl(dataUrl, attachment.type)) continue;
    sources.push({
      name: attachment.name,
      type: attachment.type,
      size: attachment.size,
      extension: attachment.extension,
      dataUrl,
    });
  }
  return sources;
}

export function materialLines(product) {
  const materials = product.materials ?? [];
  const attachments = product.attachments ?? [];
  if (materials.length === 0 && attachments.length === 0) return ["- 이미지/자료: 제공 없음"];
  const lines = [];
  if (materials.length > 0) lines.push(`- 이미지/자료 메모: ${materials.join(", ")}`);
  for (const attachment of attachments) lines.push(`- 첨부 파일: ${attachmentSummary(attachment)}`);
  return lines;
}

function readAttachment(value) {
  const input = readObject(value);
  const name = safeFileName(readString(input.name));
  if (!name) return { ok: false, error: "attachment.name is required" };
  const extension = fileExtension(name);
  const type = normalizedType(readString(input.type), extension);
  if (!isAllowedAttachment(extension, type)) {
    return { ok: false, error: `unsupported attachment file type: ${name}` };
  }
  const size = readSafeSize(input.size);
  const kind = attachmentKind(extension);
  const textPreview = limitInlineText(readString(input.textPreview) ?? readString(input.text));
  return {
    ok: true,
    value: {
      name,
      type,
      size,
      extension,
      kind,
      preview: Boolean(input.preview || input.previewDataUrl || input.objectUrl),
      previewOmittedReason: readString(input.previewOmittedReason),
      ...(textPreview ? { textPreview } : {}),
    },
  };
}

function attachmentSummary(attachment) {
  const parts = [attachment.name, attachment.type, `${attachment.size} bytes`, attachment.kind];
  if (attachment.preview) parts.push("preview available");
  if (attachment.textPreview) parts.push(`텍스트 요약: ${attachment.textPreview}`);
  return parts.join(" | ");
}

function attachmentKind(extension) {
  if (["png", "jpg", "jpeg", "webp"].includes(extension)) return "image";
  if (["txt", "md", "csv"].includes(extension)) return "text";
  return "document";
}

function readSafeSize(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
}

function isAllowedAttachment(extension, type) {
  return allowedExtensions.has(extension) && compatibleTypes[extension].includes(type);
}

function normalizedType(type, extension) {
  return type ?? defaultTypes[extension] ?? "application/octet-stream";
}

function safeFileName(name) {
  if (!name) return undefined;
  return name.replace(/\\/gu, "/").split("/").pop()?.replace(/[\u0000-\u001F\u007F]/gu, "").trim();
}

function safeExtension(value) {
  return value?.replace(/^\./u, "").toLowerCase() ?? "";
}

function fileExtension(name) {
  return safeExtension(name.split(".").pop());
}

function limitInlineText(value) {
  if (!value) return undefined;
  return value.length > 1200 ? `${value.slice(0, 1200)}...` : value;
}

function isImageDataUrl(value, expectedType) {
  const match = value.match(/^data:([^;,]+);base64,[a-z0-9+/=\s]+$/iu);
  if (!match) return false;
  return match[1].toLowerCase() === expectedType.toLowerCase() && expectedType.startsWith("image/");
}

function readObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
