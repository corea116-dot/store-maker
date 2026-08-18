const KINDS = ["hero", "problem", "benefit", "feature", "usage", "spec", "faq", "cta", "text", "image"];
const LAYOUTS = ["text-only", "image-first", "image-last", "split-left", "split-right", "full-bleed"];

export function renderDetailPageEditor(container, state) {
  if (!container || !state?.document) return;
  const document = state.document;
  const sections = Array.isArray(document.sections) ? document.sections : [];
  const activeTab = state.activeTab === "preview" ? "preview" : "edit";
  const projectUrl = state.projectUrl ?? (state.projectId ? `/api/detail-page-projects/${encodeURIComponent(state.projectId)}` : "");
  container.innerHTML = `<div id="detail-page-editor" class="detail-editor" data-project-revision="${escapeAttribute(state.revision ?? 1)}" data-project-url="${escapeAttribute(projectUrl)}">
    <div class="detail-editor-toolbar">
      <div>
        <span class="detail-editor-kicker">DETAIL PAGE / EDITOR</span>
        <h3>상세페이지 편집기</h3>
        <p>AI 초안을 섹션별로 다듬고, 저장된 버전을 미리보세요.</p>
      </div>
      <div class="detail-editor-toolbar-actions">
        <div class="detail-editor-tabs" role="tablist" aria-label="편집 및 미리보기">
          ${tab("edit", "편집", activeTab)}
          ${tab("preview", "미리보기", activeTab)}
        </div>
        <span class="detail-editor-revision">REV <output id="detail-page-project-revision" aria-label="프로젝트 리비전">${escapeHtml(state.revision ?? 1)}</output></span>
        <button class="btn btn-primary" type="button" data-action="save-detail-page">저장</button>
      </div>
    </div>
    <div class="detail-editor-status-row">
      <span class="detail-editor-save-status" role="status" data-editor-save-status="${escapeAttribute(state.saveStatus ?? "saved")}">${escapeHtml(saveLabel(state))}</span>
      <span class="detail-editor-notice">${escapeHtml(state.notice ?? "")}</span>
      <span class="detail-editor-announcement" data-editor-announcement aria-live="polite">${escapeHtml(state.notice ?? "")}</span>
    </div>
    <div class="detail-editor-conflict" data-editor-conflict role="alert"${state.saveStatus === "conflict" ? "" : " hidden"}>
      <strong>최신 버전과 충돌했습니다.</strong>
      <span>서버의 최신 편집본을 불러오거나 로컬 문서를 복사해 보관하세요.</span>
      <div class="detail-editor-conflict-actions">
        <button class="btn" type="button" data-action="reload-latest-detail-page">최신 버전 불러오기</button>
        <button class="btn" type="button" data-action="copy-local-detail-page">로컬 편집본 복사</button>
      </div>
    </div>
    <section id="detail-page-edit-panel" class="detail-editor-panel" role="tabpanel" aria-labelledby="detail-page-edit-tab"${activeTab === "edit" ? "" : " hidden"}>
      <div class="detail-editor-section-head"><div><span class="detail-editor-kicker">CONTENT MAP</span><h4>${escapeHtml(document.title || "상세페이지")}</h4></div><button class="btn" type="button" data-action="add-detail-section">+ 섹션 추가</button></div>
      <div class="detail-editor-sections">${sections.map((section, index) => renderSection(section, index, sections.length, state.assets)).join("")}</div>
    </section>
    <section id="detail-page-preview-panel" class="detail-editor-panel" role="tabpanel" aria-labelledby="detail-page-preview-tab"${activeTab === "preview" ? "" : " hidden"}>
      <div class="detail-editor-preview-head"><div><span class="detail-editor-kicker">PUBLISHED VIEW</span><h4>저장된 상세페이지 미리보기</h4></div><span class="detail-editor-preview-note">현재 리비전 ${escapeHtml(state.revision ?? 1)}</span></div>
      <div id="detail-page-preview-content" class="detail-editor-preview-content">${state.preview?.html ?? "<p>미리보기를 준비하고 있습니다.</p>"}</div>
    </section>
    <div id="detail-page-image-picker" class="detail-editor-image-picker is-hidden" role="dialog" aria-modal="true" aria-labelledby="detail-page-image-picker-title" hidden>
      <div class="detail-editor-picker-card"><div class="detail-editor-picker-head"><div><span class="detail-editor-kicker">IMAGE LIBRARY</span><h4 id="detail-page-image-picker-title">섹션 이미지 선택</h4></div><button class="btn" type="button" data-action="close-detail-image-picker">닫기</button></div>
      <div class="detail-editor-assets">${renderAssets(state.assets)}</div></div>
    </div>
  </div>`;
}

export function readSectionChanges(sectionElement) {
  if (!sectionElement) return { heading: "", body: "", bullets: [], kind: "text", layout: "text-only" };
  return {
    heading: fieldValue(sectionElement, "[data-section-heading]"),
    body: fieldValue(sectionElement, "[data-section-body]"),
    bullets: fieldValue(sectionElement, "[data-section-bullets]").split("\n").map((item) => item.trim()).filter(Boolean),
    kind: fieldValue(sectionElement, "[data-section-kind]") || "text",
    layout: fieldValue(sectionElement, "[data-section-layout]") || "text-only",
  };
}

export function detailPageAssetToImage(asset, sectionId, sourceOverride) {
  const filename = String(asset?.filename ?? asset?.name ?? "asset.png").split(/[\\/]/u).pop() || "asset.png";
  const url = String(asset?.url ?? "");
  const source = sourceOverride ?? (asset?.source === "edited" || asset?.isEdited ? "edited" : "generated");
  const id = `image-${String(sectionId).slice(0, 40)}-${crypto.randomUUID()}`.slice(0, 120);
  return { id, url, filename, alt: String(asset?.purpose ?? asset?.alt ?? filename), source };
}

export function updateDetailPageEditorSaveStatus(state) {
  const node = document.querySelector("[data-editor-save-status]");
  if (!node || !state) return;
  node.dataset.editorSaveStatus = state.saveStatus;
  node.textContent = ({ saved: "저장됨", dirty: "저장 대기", saving: "저장 중", failed: "저장 실패", conflict: "저장 충돌" })[state.saveStatus] ?? "저장 상태";
}

function renderSection(section, index, count, assets) {
  const image = section.image;
  const bullets = Array.isArray(section.bullets) ? section.bullets.join("\n") : "";
  return `<article class="detail-editor-section-card${section.visible ? "" : " is-hidden-section"}" data-editor-section data-section-id="${escapeAttribute(section.id)}" data-section-source="${escapeAttribute(section.source ?? "generated")}">
    <div class="detail-editor-section-card-head"><div><span class="detail-editor-section-number">${String(index + 1).padStart(2, "0")}</span><span class="detail-editor-section-kind">${escapeHtml(section.source === "user" ? "USER SECTION" : "AI SECTION")}</span></div><span class="detail-editor-visibility">${section.visible ? "표시 중" : "숨김"}</span></div>
    <div class="detail-editor-fields"><label>섹션 제목<input data-section-heading value="${escapeAttribute(section.heading ?? "")}" /></label><label>본문<textarea data-section-body rows="4">${escapeHtml(section.body ?? "")}</textarea></label><label>핵심 포인트<textarea data-section-bullets rows="3" placeholder="한 줄에 하나씩">${escapeHtml(bullets)}</textarea></label><div class="detail-editor-selects"><label>종류<select data-section-kind>${options(KINDS, section.kind)}</select></label><label>배치<select data-section-layout>${options(LAYOUTS, section.layout)}</select></label></div></div>
    <div class="detail-editor-media-row">${image ? `<figure data-section-image><img src="${escapeAttribute(image.url)}" alt="${escapeAttribute(image.alt || image.filename)}" /><figcaption>${escapeHtml(image.filename)}</figcaption></figure>` : `<div class="detail-editor-empty-image">이미지 없음<span>필요한 섹션에 생성 이미지를 연결하세요.</span></div>`}<div class="detail-editor-section-actions"><button class="btn" type="button" data-action="open-detail-image-picker" data-mobile-label="${image ? "교체" : "선택"}" aria-label="${image ? "섹션 이미지 교체" : "섹션 이미지 선택"}">${image ? "이미지 교체" : "이미지 선택"}</button>${image ? `<button class="btn" type="button" data-action="edit-detail-image" data-mobile-label="수정" aria-label="이미지 수정본 만들기">수정본 만들기</button><button class="btn" type="button" data-action="remove-detail-image" data-mobile-label="제거" aria-label="섹션 이미지 제거">이미지 제거</button>` : ""}<button class="btn" type="button" data-action="move-detail-section-up"${index === 0 ? " disabled" : ""}>위로</button><button class="btn" type="button" data-action="move-detail-section-down"${index === count - 1 ? " disabled" : ""}>아래로</button><button class="btn" type="button" data-action="toggle-detail-section">${section.visible ? "숨기기" : "표시하기"}</button><button class="btn btn-danger" type="button" data-action="delete-detail-section">삭제</button></div></div>
  </article>`;
}

function renderAssets(assets) {
  if (!Array.isArray(assets) || assets.length === 0) return `<p class="detail-editor-empty-assets">생성된 이미지가 없습니다.</p>`;
  return assets.map((asset, index) => `<button class="detail-editor-asset" type="button" data-detail-asset data-asset-index="${index}" data-asset-url="${escapeAttribute(asset.url ?? "")}" data-asset-filename="${escapeAttribute(asset.filename ?? asset.name ?? "asset.png")}"><img src="${escapeAttribute(asset.url ?? "")}" alt="${escapeAttribute(asset.purpose ?? asset.filename ?? "생성 이미지")}" /><span>${escapeHtml(asset.filename ?? asset.name ?? "이미지")}</span></button>`).join("");
}

function tab(id, label, active) {
  return `<button id="detail-page-${id}-tab" class="detail-editor-tab" type="button" role="tab" data-editor-tab="${id}" aria-selected="${id === active}" aria-controls="detail-page-${id}-panel" tabindex="${id === active ? "0" : "-1"}">${label}</button>`;
}

function options(values, selected) { return values.map((value) => `<option value="${value}"${value === selected ? " selected" : ""}>${value}</option>`).join(""); }
function fieldValue(root, selector) { return root.querySelector(selector)?.value ?? ""; }
function saveLabel(state) { return ({ dirty: "변경사항 있음", saving: "저장 중…", saved: "저장됨", conflict: "충돌 해결 필요", failed: "저장 실패" }[state.saveStatus] ?? "저장 대기"); }
function escapeHtml(value) { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }
function escapeAttribute(value) { return escapeHtml(value); }
