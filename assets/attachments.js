import { $, escapeHtml, showToast } from "./app-utils.js";

const allowedExtensions = new Set(["png", "jpg", "jpeg", "webp", "pdf", "txt", "md", "csv"]);
const imageExtensions = new Set(["png", "jpg", "jpeg", "webp"]);
const textExtensions = new Set(["txt", "md", "csv"]);
const compatibleTypes = {
  png: ["", "image/png"],
  jpg: ["", "image/jpeg"],
  jpeg: ["", "image/jpeg"],
  webp: ["", "image/webp"],
  pdf: ["", "application/pdf"],
  txt: ["", "text/plain"],
  md: ["", "text/markdown", "text/plain"],
  csv: ["", "text/csv", "text/plain", "application/vnd.ms-excel"],
};
const mimeFallbacks = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
};
const maxTextPreview = 1200;
const maxImageSourceBytes = 8 * 1024 * 1024;
const attachments = [];

export function bindAttachmentControls() {
  const dropzone = $("#material-dropzone");
  const input = $("#material-file-input");
  const uploadButton = $("[data-action='upload-materials']");
  if (!dropzone || !input || !uploadButton) return;

  uploadButton.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    void addFiles(input.files);
    input.value = "";
  });

  for (const eventName of ["dragenter", "dragover"]) {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.add("is-dragging");
    });
  }
  for (const eventName of ["dragleave", "drop"]) {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.remove("is-dragging");
    });
  }
  dropzone.addEventListener("drop", (event) => {
    void addFiles(event.dataTransfer?.files);
  });
  dropzone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      input.click();
    }
  });
  $("#material-list")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-material]");
    if (!button) return;
    removeAttachment(button.dataset.removeMaterial ?? "");
  });
  renderAttachments();
}

export function getAttachments() {
  return attachments.map((attachment) => ({
    name: attachment.name,
    type: attachment.type,
    size: attachment.size,
    extension: attachment.extension,
    kind: attachment.kind,
    preview: Boolean(attachment.previewDataUrl),
    sourceDataUrl: attachment.sourceDataUrl,
    previewOmittedReason: attachment.previewOmittedReason,
    textPreview: attachment.textPreview,
  }));
}

async function addFiles(fileList) {
  const files = [...(fileList ?? [])];
  if (files.length === 0) return;

  const accepted = [];
  const rejected = [];
  for (const file of files) {
    if (isAllowed(file)) accepted.push(file);
    else rejected.push(file.name);
  }

  if (rejected.length > 0) showToast(`지원하지 않는 파일 ${rejected.length}개를 건너뛰었습니다.`);
  for (const file of accepted) attachments.push(await readAttachment(file));
  renderAttachments();
}

function removeAttachment(name) {
  const index = attachments.findIndex((attachment) => attachment.name === name);
  if (index < 0) return;
  attachments.splice(index, 1);
  renderAttachments();
}

async function readAttachment(file) {
  const type = normalizedType(file);
  const kind = fileKind(file, type);
  const base = {
    name: file.name,
    type,
    size: file.size,
    extension: fileExtension(file.name),
    kind,
  };
  if (kind === "image" && file.size <= maxImageSourceBytes) {
    const sourceDataUrl = await readDataUrl(file);
    return { ...base, previewDataUrl: sourceDataUrl, sourceDataUrl };
  }
  if (kind === "image") return { ...base, previewOmittedReason: "image exceeds 8 MB" };
  if (kind === "text") return { ...base, textPreview: (await file.text()).slice(0, maxTextPreview) };
  return base;
}

function renderAttachments() {
  const list = $("#material-list");
  if (!list) return;
  list.innerHTML = attachments.map((attachment) => `
    <li class="material-item">
      ${attachment.previewDataUrl ? `<img class="material-thumb" src="${attachment.previewDataUrl}" alt="${escapeHtml(attachment.name)} 미리보기" />` : `<span class="material-file-icon">${escapeHtml(fileLabel(attachment))}</span>`}
      <span class="material-meta">
        <span class="material-name">${escapeHtml(attachment.name)}</span>
        <span class="material-detail">${escapeHtml(formatBytes(attachment.size))} · ${escapeHtml(attachment.type)} · ${escapeHtml(kindLabel(attachment.kind))}${attachment.previewOmittedReason ? " · 미리보기 생략" : ""}</span>
      </span>
      <button class="btn material-remove" type="button" data-remove-material="${escapeHtml(attachment.name)}">삭제</button>
    </li>
  `).join("");
}

function isAllowed(file) {
  const extension = fileExtension(file.name);
  return allowedExtensions.has(extension) && compatibleTypes[extension].includes(file.type);
}

function normalizedType(file) {
  const extension = fileExtension(file.name);
  return file.type || mimeFallbacks[extension] || "application/octet-stream";
}

function fileKind(file, type) {
  const extension = fileExtension(file.name);
  if (type.startsWith("image/") || imageExtensions.has(extension)) return "image";
  if (type.startsWith("text/") || textExtensions.has(extension)) return "text";
  return "document";
}

function fileLabel(attachment) {
  if (attachment.type === "application/pdf") return "PDF";
  if (attachment.kind === "text") return "TXT";
  return "FILE";
}

function kindLabel(kind) {
  if (kind === "image") return "이미지";
  if (kind === "text") return "텍스트";
  return "자료";
}

function formatBytes(size) {
  if (size < 1024) return `${size} bytes`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function fileExtension(name) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function readDataUrl(file) {
  return new Promise((resolveRead, rejectRead) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolveRead(String(reader.result ?? "")));
    reader.addEventListener("error", () => rejectRead(reader.error ?? new Error("파일 미리보기를 읽지 못했습니다.")));
    reader.readAsDataURL(file);
  });
}
