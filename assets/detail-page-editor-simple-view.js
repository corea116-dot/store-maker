const detailImagePickerLabelsBound = new WeakSet();

export function renderDetailPageEditor(container, state) {
  if (!container || !state?.document) return;
  const document = state.document;
  const sections = Array.isArray(document.sections) ? document.sections : [];
  const activeTab = state.activeTab === "preview" ? "preview" : "edit";
  const projectUrl = state.projectUrl ?? (state.projectId ? "/api/detail-page-projects/" + encodeURIComponent(state.projectId) : "");

  container.innerHTML = [
    '<div id="detail-page-editor" class="detail-editor" data-project-id="' + escapeAttribute(state.projectId ?? "") + '" data-project-revision="' + escapeAttribute(state.revision ?? 1) + '" data-project-url="' + escapeAttribute(projectUrl) + '" data-editor-session="' + escapeAttribute(state.sessionId ?? 0) + '">',
    '<div class="detail-editor-toolbar">',
    '<div><span class="detail-editor-kicker">상세페이지 편집</span><h3>사진과 글을 고쳐 보세요</h3><p>사진을 끌어 순서를 바꾸고, 사진의 수정 메뉴를 사용하세요.</p></div>',
    '<div class="detail-editor-toolbar-actions"><div class="detail-editor-tabs" role="tablist" aria-label="편집 및 미리보기">' + tab("edit", "편집", activeTab) + tab("preview", "미리보기", activeTab) + '</div><span class="detail-editor-revision">저장 버전 <output id="detail-page-project-revision" aria-label="현재 저장 버전">' + escapeHtml(state.revision ?? 1) + '</output></span><button class="btn btn-primary" type="button" data-action="save-detail-page">저장</button></div>',
    '</div>',
    '<div class="detail-editor-status-row"><span class="detail-editor-save-status" role="status" data-editor-save-status="' + escapeAttribute(state.saveStatus ?? "saved") + '">' + escapeHtml(saveLabel(state)) + '</span><span class="detail-editor-notice">' + escapeHtml(state.notice ?? "") + '</span><span class="detail-editor-announcement" data-editor-announcement aria-live="polite">' + escapeHtml(state.notice ?? "") + '</span></div>',
    renderConflict(state),
    '<section id="detail-page-edit-panel" class="detail-editor-panel" role="tabpanel" aria-labelledby="detail-page-edit-tab"' + (activeTab === "edit" ? "" : " hidden") + '>',
    '<section id="detail-builder-edit" class="detail-builder-document" aria-label="상세페이지 내용">',
    '<div class="detail-editor-section-head"><div><span class="detail-editor-kicker">내 상세페이지</span><h4>' + escapeHtml(document.title || "상세페이지") + '</h4><p class="detail-editor-help">사진을 끌어 순서를 바꾸고, 제목과 설명을 바로 고쳐 보세요.</p></div><button class="btn" type="button" data-action="add-detail-section">+ 새 내용 추가</button></div>',
    '<div class="detail-editor-sections">' + sections.map((section, index) => renderSection(section, index)).join("") + '</div>',
    '</section>',
    '</section>',
    '<section id="detail-page-preview-panel" class="detail-editor-panel" role="tabpanel" aria-labelledby="detail-page-preview-tab"' + (activeTab === "preview" ? "" : " hidden") + '>',
    '<div class="detail-editor-preview-head"><div><span class="detail-editor-kicker">미리보기</span><h4>저장된 상세페이지</h4></div><span class="detail-editor-preview-note">저장 버전 ' + escapeHtml(state.revision ?? 1) + '</span></div>',
    '<div id="detail-page-preview-content" class="detail-editor-preview-content">' + (state.preview?.html ?? "<p>미리보기를 준비하고 있습니다.</p>") + '</div>',
    '</section>',
    '<div id="detail-page-image-picker" class="detail-editor-image-picker is-hidden" role="dialog" aria-modal="true" aria-labelledby="detail-page-image-picker-title" hidden>',
    '<div class="detail-editor-picker-card"><div class="detail-editor-picker-head"><div><span class="detail-editor-kicker">사진 고르기</span><h4 id="detail-page-image-picker-title">다른 생성 이미지 고르기</h4></div><button class="btn" type="button" data-action="close-detail-image-picker">닫기</button></div><p class="detail-editor-picker-help">이미지를 고르면 지금 사진이 바뀝니다.</p><div class="detail-editor-assets">' + renderAssets(state.assets) + '</div></div>',
    '</div>',
    '</div>',
  ].join("");

  if (!detailImagePickerLabelsBound.has(container)) {
    container.addEventListener("click", (event) => {
      const opener = event.target.closest?.("[data-action='open-detail-image-picker']");
      if (!opener) return;
      const card = opener.closest("[data-editor-section]");
      const heading = card?.querySelector("[data-section-heading]")?.value?.trim();
      const pickerTitle = container.querySelector("#detail-page-image-picker-title");
      if (pickerTitle) pickerTitle.textContent = heading ? "“" + heading + "”에 쓸 다른 생성 이미지 고르기" : "다른 생성 이미지 고르기";
    });
    detailImagePickerLabelsBound.add(container);
  }
}

export function readSectionChanges(sectionElement) {
  if (!sectionElement) return { heading: "", body: "", bullets: [], kind: "free-text", layout: "text-only" };
  return {
    heading: fieldValue(sectionElement, "[data-section-heading]"),
    body: fieldValue(sectionElement, "[data-section-body]"),
    bullets: fieldValue(sectionElement, "[data-section-bullets]").split("\n").map((item) => item.trim()).filter(Boolean),
    kind: fieldValue(sectionElement, "[data-section-kind]") || "free-text",
    layout: fieldValue(sectionElement, "[data-section-layout]") || "text-only",
  };
}

export function detailPageAssetToImage(asset, sectionId, sourceOverride) {
  const filename = String(asset?.filename ?? asset?.name ?? "asset.png").split(/[\\/]/u).pop() || "asset.png";
  const url = String(asset?.url ?? "");
  const source = sourceOverride ?? (asset?.source === "edited" || asset?.isEdited ? "edited" : "generated");
  const id = ("image-" + String(sectionId).slice(0, 40) + "-" + crypto.randomUUID()).slice(0, 120);
  return { id, url, filename, alt: String(asset?.purpose ?? asset?.alt ?? filename), source };
}

export function updateDetailPageEditorSaveStatus(state) {
  const node = document.querySelector("[data-editor-save-status]");
  if (!node || !state) return;
  node.dataset.editorSaveStatus = state.saveStatus;
  node.textContent = saveLabel(state);
}

function renderConflict(state) {
  return '<div class="detail-editor-conflict" data-editor-conflict role="alert"' + (state.saveStatus === "conflict" ? "" : " hidden") + '><strong>최신 버전과 충돌했습니다.</strong><span>서버의 최신 편집본을 불러오거나, 현재 편집본으로 명시적으로 덮어쓸 수 있습니다.</span><div class="detail-editor-conflict-actions"><button class="btn" type="button" data-action="reload-latest-detail-page">최신 버전 불러오기</button><button class="btn" type="button" data-action="copy-local-detail-page">현재 글 복사</button><button class="btn btn-danger" type="button" data-action="overwrite-latest-detail-page">현재 글로 덮어쓰기</button></div></div>';
}

function renderSection(section, index) {
  const label = sectionAccessibilityLabel(section, index);
  const bullets = Array.isArray(section.bullets) ? section.bullets.join("\n") : "";
  return [
    '<article class="detail-editor-section-card" data-editor-section data-section-id="' + escapeAttribute(section.id) + '">',
    '<div class="detail-editor-section-card-head"><div><span class="detail-editor-section-number">' + String(index + 1).padStart(2, "0") + '</span><span class="detail-editor-section-kind">상품 내용</span></div></div>',
    '<div class="detail-editor-fields">',
    '<label>제목<input data-section-heading value="' + escapeAttribute(section.heading ?? "") + '" /></label>',
    '<label>설명<textarea data-section-body rows="5">' + escapeHtml(section.body ?? "") + '</textarea></label>',
    '<label>한 줄 장점 <span class="detail-editor-field-note">한 줄에 하나씩 적어 주세요. (선택)</span><textarea data-section-bullets rows="3">' + escapeHtml(bullets) + '</textarea></label>',
    '<input type="hidden" data-section-kind value="' + escapeAttribute(section.kind ?? "free-text") + '" />',
    '<input type="hidden" data-section-layout value="' + escapeAttribute(section.layout ?? "text-only") + '" />',
    '</div>',
    '<div class="detail-editor-media-row">' + (section.image?.url ? renderAssignedImage(section, label) : renderEmptyImage(label)) + '</div>',
    '</article>',
  ].join("");
}

function renderAssignedImage(section, label) {
  return [
    '<figure class="detail-editor-image-frame" data-section-image data-editor-image-drag draggable="true" tabindex="0" aria-label="' + escapeAttribute(label + " 사진. 끌어서 순서를 바꿀 수 있습니다.") + '">',
    '<img src="' + escapeAttribute(section.image.url) + '" alt="' + escapeAttribute(section.image.alt ?? section.image.filename ?? "상품 이미지") + '" />',
    '<figcaption><span>사진을 끌어 순서를 바꾸세요.</span><span>' + escapeHtml(section.image.filename ?? "생성 이미지") + '</span></figcaption>',
    '<div class="detail-editor-image-menu" data-editor-image-menu role="group" aria-label="' + escapeAttribute(label + " 사진 메뉴") + '">',
    '<button class="btn" type="button" data-action="edit-detail-image" aria-label="' + escapeAttribute(label + " 사진 수정") + '">수정</button>',
    '<button class="btn" type="button" data-action="remove-detail-image" aria-label="' + escapeAttribute(label + " 사진 제거") + '">제거</button>',
    '<button class="btn" type="button" data-action="open-detail-image-picker" aria-label="' + escapeAttribute(label + " 사진 다시 만들기") + '">다시 만들기</button>',
    '</div>',
    '</figure>',
    '<div class="detail-editor-order-actions" data-editor-order-actions aria-label="' + escapeAttribute(label + " 순서 바꾸기") + '">',
    '<button class="detail-editor-sr-only" type="button" data-action="move-detail-section-up" aria-label="' + escapeAttribute(label + " 위로 이동") + '">위로 이동</button>',
    '<button class="detail-editor-sr-only" type="button" data-action="move-detail-section-down" aria-label="' + escapeAttribute(label + " 아래로 이동") + '">아래로 이동</button>',
    '</div>',
  ].join("");
}

function renderEmptyImage(label) {
  return '<button class="detail-editor-empty-image" type="button" data-action="open-detail-image-picker" aria-label="' + escapeAttribute(label + "에 사진 넣기") + '"><strong>사진 넣기</strong><span>생성된 사진에서 골라 넣을 수 있어요.</span></button>';
}

function renderAssets(assets) {
  if (!Array.isArray(assets) || assets.length === 0) return '<p class="detail-editor-empty-assets">생성된 이미지가 없습니다.</p>';
  return assets.map((asset, index) => '<button class="detail-editor-asset" type="button" data-detail-asset data-asset-index="' + index + '" data-asset-url="' + escapeAttribute(asset.url ?? "") + '" data-asset-filename="' + escapeAttribute(asset.filename ?? asset.name ?? "asset.png") + '"><img src="' + escapeAttribute(asset.url ?? "") + '" alt="' + escapeAttribute(asset.purpose ?? asset.filename ?? "생성 이미지") + '" /><span>' + escapeHtml(asset.filename ?? asset.name ?? "이미지") + '</span></button>').join("");
}

function tab(id, label, active) {
  return '<button id="detail-page-' + id + '-tab" class="detail-editor-tab" type="button" role="tab" data-editor-tab="' + id + '" aria-selected="' + (id === active) + '" aria-controls="detail-page-' + id + '-panel" tabindex="' + (id === active ? "0" : "-1") + '">' + label + '</button>';
}

function fieldValue(root, selector) {
  return root.querySelector(selector)?.value ?? "";
}

function sectionAccessibilityLabel(section, index) {
  const heading = String(section.heading ?? "").trim();
  return heading ? "섹션 " + (index + 1) + "번 ‘" + heading + "’" : "섹션 " + (index + 1) + "번";
}

function saveLabel(state) {
  return ({ dirty: "변경사항 있음", saving: "저장 중…", saved: "저장됨", conflict: "충돌 해결 필요", failed: "저장 실패" })[state.saveStatus] ?? "저장 대기";
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
