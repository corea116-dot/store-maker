import { $, escapeHtml, postJson, readableError, showToast } from "./app-utils.js";
import { appendLog } from "./app-view.js";
import { state } from "./settings-state.js";

let selectedImage;
let editRunning = false;

export function bindImageViewerControls({ generationRequest }) {
  document.addEventListener("click", (event) => {
    const openButton = event.target.closest("[data-action='open-generated-image']");
    if (openButton) {
      openImageViewer(readImageDataset(openButton));
      return;
    }
    if (event.target.closest("[data-action='close-image-viewer']")) closeImageViewer();
  });
  $("[data-action='edit-generated-image']")?.addEventListener("click", () => {
    void runImageEdit(generationRequest);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("#image-viewer-dialog")?.classList.contains("is-hidden")) closeImageViewer();
  });
}

function openImageViewer(image) {
  if (!image?.url) return;
  selectedImage = image;
  $("#image-viewer-img").src = image.url;
  $("#image-viewer-img").alt = `${image.filename} 큰 화면`;
  $("#image-viewer-title").textContent = image.filename ?? "이미지 큰 화면";
  $("#image-viewer-meta").textContent = [image.style, image.purpose, image.type].filter(Boolean).join(" · ") || "생성 이미지";
  $("#image-viewer-caption").textContent = image.relativePath ?? image.url;
  $("#image-viewer-download").href = image.url;
  $("#image-viewer-download").download = image.filename ?? "store-maker-image.png";
  $("#image-edit-instruction").value = "";
  setEditStatus("수정 요청을 입력하세요.");
  $("#image-viewer-overlay").classList.remove("is-hidden");
  $("#image-viewer-dialog").classList.remove("is-hidden");
  $("#image-viewer-dialog").focus();
}

function closeImageViewer() {
  $("#image-viewer-overlay")?.classList.add("is-hidden");
  $("#image-viewer-dialog")?.classList.add("is-hidden");
}

async function runImageEdit(generationRequest) {
  if (editRunning || !selectedImage?.url) return;
  const instruction = $("#image-edit-instruction").value.trim();
  if (!instruction) {
    setEditStatus("수정 요청을 먼저 입력하세요.", "error");
    return;
  }

  editRunning = true;
  setEditStatus("선택한 이미지만 reference로 수정본을 생성 중입니다.");
  const button = $("[data-action='edit-generated-image']");
  if (button) button.disabled = true;
  try {
    const payload = generationRequest();
    payload.imageEdit = { instruction, source: selectedImage };
    const result = await postJson("/api/images/edit", payload);
    for (const log of result.logs ?? []) appendLog(log);
    const image = normalizeImage(result.image);
    if (!image?.url) throw new Error("수정본 이미지 URL을 찾지 못했습니다.");
    appendEditedImageCard(image);
    mergeEditedImageExport(image);
    openImageViewer(image);
    setEditStatus("수정본을 생성했고 갤러리에 추가했습니다.", "good");
    showToast("이미지 수정본을 생성했습니다.");
  } catch (error) {
    const message = readableError(error);
    setEditStatus(message, "error");
    appendLog({ level: "error", title: "image edit failed", message });
  } finally {
    editRunning = false;
    if (button) button.disabled = false;
  }
}

function appendEditedImageCard(image) {
  const grid = $(".generated-image-grid");
  if (!grid) return;
  const card = document.createElement("figure");
  card.className = `generated-image-card generated-image-card-edited${image.isPlaceholder ? " generated-image-card-placeholder" : ""}`;
  card.dataset.generatedImageCard = "";
  const attrs = imageDataAttributes(image);
  card.innerHTML = `
    <div class="generated-image-frame">
      <button class="generated-image-open" type="button" data-action="open-generated-image" ${attrs} aria-label="${escapeHtml(`${image.filename} 큰 화면으로 보기`)}">
        <img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.filename)} 수정본" />
        <span class="generated-image-open-label">큰 화면으로 보기</span>
        <span class="generated-image-badge">수정본</span>
      </button>
    </div>
    <figcaption>
      <strong>${escapeHtml(image.filename)}</strong>
      <span>${escapeHtml(image.relativePath ?? image.url)} · ${escapeHtml(formatBytes(image.size ?? 0))}</span>
      <span class="generated-image-style">스타일: ${escapeHtml(image.style ?? "미지정")}</span>
      <span>목적: ${escapeHtml(image.purpose ?? image.brief?.purpose ?? "개별 수정본")}</span>
      ${image.brief?.visualPrompt ? `<small>${escapeHtml(image.brief.visualPrompt)}</small>` : ""}
      <span>${escapeHtml(image.mimeType ?? image.type ?? "unknown")}</span>
    </figcaption>
    <div class="generated-image-actions">
      <button class="btn" type="button" data-action="open-generated-image" ${attrs}>큰 화면</button>
      <a class="btn" href="${escapeHtml(image.url)}" download="${escapeHtml(image.filename)}">다운로드</a>
    </div>
  `;
  grid.prepend(card);
}

function mergeEditedImageExport(image) {
  if (!state.exports?.json) return;
  const edited = { ...image, editedAt: new Date().toISOString() };
  state.exports.json.editedImages = [...(state.exports.json.editedImages ?? []), edited];
  state.exports.json.result = {
    ...(state.exports.json.result ?? {}),
    editedImages: [...(state.exports.json.result?.editedImages ?? []), edited],
  };
  state.exports.markdown = `${state.exports.markdown ?? ""}\n\n## 개별 수정 이미지\n\n![${image.filename}](${image.url})\n- 파일: ${image.relativePath ?? image.url}\n- 타입: ${image.mimeType ?? image.type ?? "unknown"}`;
  state.exports.html = `${state.exports.html ?? ""}\n<section class="generated-image-section"><h2>개별 수정 이미지</h2><figure class="generated-image-card"><img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.filename)} 수정본" /><figcaption><strong>${escapeHtml(image.filename)}</strong></figcaption></figure></section>`;
}

function readImageDataset(element) {
  return normalizeImage({
    url: element.dataset.imageUrl,
    filename: element.dataset.imageFilename,
    relativePath: element.dataset.imageRelativePath,
    style: element.dataset.imageStyle,
    purpose: element.dataset.imagePurpose,
    type: element.dataset.imageType,
  });
}

function normalizeImage(image) {
  if (!image || typeof image !== "object") return undefined;
  return {
    ...image,
    url: typeof image.url === "string" ? image.url : undefined,
    filename: typeof image.filename === "string" ? image.filename : "store-maker-image.png",
    relativePath: typeof image.relativePath === "string" ? image.relativePath : undefined,
    style: typeof image.style === "string" ? image.style : undefined,
    purpose: typeof image.purpose === "string" ? image.purpose : undefined,
    type: typeof image.type === "string" ? image.type : typeof image.mimeType === "string" ? image.mimeType : undefined,
  };
}

function imageDataAttributes(image) {
  const values = {
    "data-image-url": image.url,
    "data-image-filename": image.filename,
    "data-image-relative-path": image.relativePath,
    "data-image-style": image.style,
    "data-image-purpose": image.purpose,
    "data-image-type": image.mimeType ?? image.type,
  };
  return Object.entries(values)
    .filter(([, value]) => typeof value === "string" && value.trim())
    .map(([name, value]) => `${name}="${escapeHtml(value)}"`)
    .join(" ");
}

function setEditStatus(message, kind = "") {
  const status = $("#image-edit-status");
  if (!status) return;
  status.textContent = message;
  status.className = `image-edit-status${kind ? ` ${kind}` : ""}`;
}

function formatBytes(size) {
  if (size < 1024) return `${size} bytes`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
