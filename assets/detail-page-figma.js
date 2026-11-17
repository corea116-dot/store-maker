import { renderVisualSection } from "./detail-page-visual.js";
import { createDetailPageCopyImage, renderCopyLayoutSvg } from "./detail-page-copy-layout.js";

const WIDTH = 860;

// Both the server's result and this export use the same copy layout.
export function buildFigmaPage(documentValue) {
  const titleCopy = createDetailPageCopyImage({ productName: documentValue.productName, title: documentValue.title, index: 0 });
  const sections = [{ id: "page-title", heading: documentValue.title, copy: titleCopy.layout }];
  for (const [index, section] of (documentValue.sections ?? []).filter((item) => item.visible).entries()) {
    const copy = !section.visual && (section.heading || section.body || section.bullets?.length)
      ? createDetailPageCopyImage({ productName: documentValue.productName, title: documentValue.title, section, index }).layout
      : null;
    sections.push({ id: section.id, heading: section.heading ?? "", copy, visual: section.visual ?? null, body: section.body ?? "", bullets: section.bullets ?? [], image: section.image ?? null });
  }
  return { format: "store-maker-figma", version: 2, width: WIDTH, sourceWidth: 1120, title: documentValue.title, sections };
}

export function renderFigmaPagePreview(page) {
  return `<div class="figma-page-preview" aria-label="가로 860픽셀 상세페이지 미리보기">${page.sections.map((section) => `<section class="figma-page-section">${section.visual ? renderVisualSection(section) : (section.copy ? renderCopyLayoutSvg(section.copy) : "")}${!section.visual && section.image?.url ? `<img src="${escapeHtml(section.image.url)}" alt="${escapeHtml(section.image.alt || "생성 이미지")}" />` : ""}</section>`).join("")}</div>`;
}

export async function makeFigmaPackage(page, { fetchImage = fetch } = {}) {
  const images = {};
  for (const section of page.sections) {
    const url = section.image?.url;
    if (!url || images[url]) continue;
    if (!/^\/outputs\/image-runs\/[0-9a-f-]{8,}\//iu.test(url) || /[?#\\]/u.test(url)) throw new Error("허용되지 않은 이미지 경로입니다.");
    const response = await fetchImage(url);
    if (!response.ok) throw new Error(`이미지를 불러오지 못했습니다: ${section.image.filename ?? url}`);
    const blob = await response.blob();
    if (!/^image\/(png|jpeg|webp)$/u.test(blob.type)) throw new Error("지원하지 않는 이미지 형식입니다.");
    const image = await loadImage(blob);
    let output = blob;
    if (blob.type === "image/webp") {
      const canvas = document.createElement("canvas");
      canvas.width = image.width; canvas.height = image.height;
      canvas.getContext("2d").drawImage(image, 0, 0);
      output = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!output) throw new Error("이미지 변환에 실패했습니다.");
    }
    images[url] = { data: await asDataUrl(output), width: image.width, height: image.height };
  }
  return { ...page, images };
}

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob); const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("이미지를 읽을 수 없습니다.")); };
    image.src = url;
  });
}
function asDataUrl(blob) {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error("이미지를 저장할 수 없습니다.")); reader.readAsDataURL(blob); });
}
function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }
