import { DETAIL_PAGE_BUILDER_FALLBACK } from "./detail-page-builder-state.js";

const LAYOUTS = ["text-only", "image-first", "image-last", "split-left", "split-right", "full-bleed"];
const LEGACY_KIND_ALIASES = Object.freeze({ benefit: "benefits", feature: "features", spec: "specifications", text: "free-text", image: "free-image" });
const detailImagePickerLabelsBound = new WeakSet();

export function renderDetailPageEditor(container, state) {
  if (!container || !state?.document) return;
  const document = state.document;
  const sections = Array.isArray(document.sections) ? document.sections : [];
  const builder = state.builder ?? {};
  const sectionTypes = builder.registry?.sectionTypes?.length ? builder.registry.sectionTypes : DETAIL_PAGE_BUILDER_FALLBACK.sectionTypes;
  const activeTab = state.activeTab === "preview" ? "preview" : "edit";
  const projectUrl = state.projectUrl ?? (state.projectId ? `/api/detail-page-projects/${encodeURIComponent(state.projectId)}` : "");
  container.innerHTML = `<div id="detail-page-editor" class="detail-editor" data-project-id="${escapeAttribute(state.projectId ?? "")}" data-project-revision="${escapeAttribute(state.revision ?? 1)}" data-project-url="${escapeAttribute(projectUrl)}" data-editor-session="${escapeAttribute(state.sessionId ?? 0)}">
    <div class="detail-editor-toolbar">
      <div>
        <span class="detail-editor-kicker">DETAIL PAGE / AI BUILDER</span>
        <h3>상세페이지 편집기</h3>
        <p>AI 초안을 섹션별로 조립하고, 필요한 부분만 다시 만들어 저장하세요.</p>
      </div>
      <div class="detail-editor-toolbar-actions">
        <button class="btn" type="button" data-action="toggle-builder-library" aria-expanded="${Boolean(builder.libraryOpen)}" aria-controls="detail-builder-structure">섹션 라이브러리</button>
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
      <span>서버의 최신 편집본을 불러오거나, 현재 로컬 편집본으로 명시적으로 덮어쓸 수 있습니다.</span>
      <div class="detail-editor-conflict-actions">
        <button class="btn" type="button" data-action="reload-latest-detail-page">최신 버전 불러오기</button>
        <button class="btn" type="button" data-action="copy-local-detail-page">로컬 편집본 복사</button>
        <button class="btn btn-danger" type="button" data-action="overwrite-latest-detail-page">로컬 편집본으로 덮어쓰기</button>
      </div>
    </div>
    <section id="detail-page-edit-panel" class="detail-editor-panel" role="tabpanel" aria-labelledby="detail-page-edit-tab"${activeTab === "edit" ? "" : " hidden"}>
      <div class="detail-builder-pane-tabs" role="tablist" aria-label="상세페이지 빌더 패널">
        ${builderPaneTab("structure", "구성", builder.activePane)}
        ${builderPaneTab("edit", "편집", builder.activePane)}
        ${builderPaneTab("candidate", "후보", builder.activePane)}
      </div>
      ${builder.libraryOpen ? `<button class="detail-builder-library-backdrop" type="button" data-action="close-builder-library" aria-label="섹션 라이브러리 닫기"></button>` : ""}
      <div class="detail-builder-workspace${builder.libraryOpen ? " is-library-open" : ""}" data-builder-active-pane="${escapeAttribute(builder.activePane ?? "structure")}">
        ${renderBuilderLibrary(builder, sectionTypes, state.selectedSectionId)}
        <section id="detail-builder-edit" class="detail-builder-document" data-builder-pane-panel="edit" aria-label="상세페이지 문서 구성">
          <div class="detail-editor-section-head"><div><span class="detail-editor-kicker">CONTENT MAP</span><h4>${escapeHtml(document.title || "상세페이지")}</h4></div><button class="btn" type="button" data-action="add-detail-section">+ 직접 섹션 추가</button></div>
          <div class="detail-editor-sections">${sections.map((section, index) => renderSection(section, index, sections.length, sectionTypes)).join("")}</div>
        </section>
        ${renderCandidate(builder, sectionTypes)}
      </div>
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
  if (!detailImagePickerLabelsBound.has(container)) {
    container.addEventListener("click", (event) => {
      const opener = event.target.closest?.("[data-action='open-detail-image-picker']");
      if (!opener) return;
      const card = opener.closest("[data-editor-section]");
      const title = card?.querySelector("[data-section-heading]")?.value?.trim() || card?.querySelector("[data-section-heading]")?.getAttribute("value")?.trim();
      const position = card ? [...container.querySelectorAll("[data-editor-section]")].indexOf(card) + 1 : 0;
      const pickerTitle = container.querySelector("#detail-page-image-picker-title");
      if (pickerTitle) pickerTitle.textContent = `섹션 ${position || ""} 이미지 선택${title ? ` — ${title}` : ""}`;
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
  const id = `image-${String(sectionId).slice(0, 40)}-${crypto.randomUUID()}`.slice(0, 120);
  return { id, url, filename, alt: String(asset?.purpose ?? asset?.alt ?? filename), source };
}

export function updateDetailPageEditorSaveStatus(state) {
  const node = document.querySelector("[data-editor-save-status]");
  if (!node || !state) return;
  node.dataset.editorSaveStatus = state.saveStatus;
  node.textContent = ({ saved: "저장됨", dirty: "저장 대기", saving: "저장 중", failed: "저장 실패", conflict: "저장 충돌" })[state.saveStatus] ?? "저장 상태";
}

function renderBuilderLibrary(builder, sectionTypes, selectedSectionId) {
  const categories = builder.registry?.templateCategories?.length ? builder.registry.templateCategories : DETAIL_PAGE_BUILDER_FALLBACK.templateCategories;
  return `<aside id="detail-builder-structure" class="detail-builder-library" data-builder-pane-panel="structure" aria-label="상세페이지 섹션 라이브러리" tabindex="-1">
    <div class="detail-builder-panel-head"><div><span class="detail-editor-kicker">SECTION LIBRARY</span><h4 id="detail-builder-library-title">섹션 추가</h4></div><button class="btn detail-builder-library-close" type="button" data-action="close-builder-library">닫기</button></div>
    <p class="detail-builder-help">템플릿과 섹션은 먼저 후보로 만들어집니다. 적용 전에는 저장되지 않습니다.</p>
    <div class="detail-builder-category-list" aria-label="템플릿 카테고리">${categories.map((category) => `<button class="btn${category === builder.category ? " is-selected" : ""}" type="button" data-builder-category="${escapeAttribute(category)}" aria-pressed="${category === builder.category}">${escapeHtml(categoryLabel(category))}</button>`).join("")}</div>
    <button class="btn btn-primary detail-builder-library-action" type="button" data-action="create-builder-template">${escapeHtml(categoryLabel(builder.category ?? "default"))} 템플릿 후보 만들기</button>
    <div class="detail-builder-divider"></div>
    <span class="detail-editor-kicker">DIRECT SECTION</span>
    <div class="detail-builder-type-grid">${sectionTypes.map((type) => `<button class="btn" type="button" data-builder-type="${escapeAttribute(type.key)}" title="${escapeAttribute(type.description ?? "")}">${escapeHtml(type.labelKo)}</button>`).join("")}</div>
    <div class="detail-builder-divider"></div>
    <label class="detail-builder-natural-label">자연어로 섹션 추가<textarea data-builder-instruction rows="4" placeholder="예: 첫 구매자가 이해하기 쉬운 비교 섹션을 만들어 주세요."></textarea></label>
    <p class="detail-builder-anchor">현재 선택 섹션 뒤에 삽입: ${escapeHtml(selectedSectionId ?? "마지막 위치")}</p>
    <button class="btn detail-builder-library-action" type="button" data-action="create-builder-instruction">AI 후보 만들기</button>
  </aside>`;
}

function renderCandidate(builder, sectionTypes) {
  const candidate = builder.candidate;
  const status = builder.status ?? "idle";
  const notice = builder.notice ?? "";
  if (!candidate) return `<aside id="detail-builder-candidate" class="detail-builder-candidate" data-builder-pane-panel="candidate" aria-label="AI 후보 패널">
    <div class="detail-builder-panel-head"><div><span class="detail-editor-kicker">AI CANDIDATE</span><h4>후보 확인</h4></div><span class="detail-builder-status" data-builder-status="${escapeAttribute(status)}">${escapeHtml(statusLabel(status))}</span></div>
    <p class="detail-builder-empty">왼쪽 라이브러리에서 템플릿 또는 섹션을 선택하거나, 각 섹션의 “AI 다시 만들기”로 부분 후보를 만드세요.</p>
    <label class="detail-builder-natural-label">재생성 요청 메모<textarea data-builder-regenerate-instruction rows="4" placeholder="예: 짧고 담백한 문장으로 바꿔 주세요."></textarea></label>
    ${renderEvidenceSources(builder)}
    ${builder.error ? `<div class="detail-builder-error" role="alert"><strong>후보 오류</strong><span>${escapeHtml(builder.error)}</span></div>` : ""}
    <p class="detail-builder-notice" role="status">${escapeHtml(notice)}</p>
  </aside>`;
  const evidenceWarning = candidate.evidence?.warnings?.[0] ?? "";
  return `<aside id="detail-builder-candidate" class="detail-builder-candidate" data-builder-pane-panel="candidate" aria-label="AI 후보 패널">
    <div class="detail-builder-panel-head"><div><span class="detail-editor-kicker">AI CANDIDATE</span><h4>${escapeHtml(candidateOperationLabel(candidate))}</h4></div><span class="detail-builder-status" data-builder-status="${escapeAttribute(status)}">${escapeHtml(statusLabel(status))}</span></div>
    <p class="detail-builder-notice" role="status">${escapeHtml(notice)}</p>
    ${candidate.status === "running" || status === "preparing" ? `<div class="detail-builder-pending"><strong>후보를 준비하고 있습니다.</strong><span>문서와 리비전이 바뀌면 이 후보는 자동으로 무효화됩니다.</span></div>` : ""}
    ${candidate.error || builder.error ? `<div class="detail-builder-error" role="alert"><strong>${escapeHtml(candidate.error?.code ?? "후보 오류")}</strong><span>${escapeHtml(candidate.error?.message ?? builder.error ?? "후보를 다시 만들어 주세요.")}</span><button class="btn" type="button" data-action="retry-builder-candidate">다시 시도</button></div>` : ""}
    ${candidate.status === "ready" && status === "ready" ? `${renderCandidateBody(candidate, builder.selectedProposalIds, sectionTypes)}
      <label class="detail-builder-natural-label">재생성 요청 메모<textarea data-builder-regenerate-instruction rows="3" placeholder="다시 만들 때 반영할 추가 요청을 입력하세요."></textarea></label>
      ${renderEvidenceSources(builder, candidate.evidence?.refs)}
      ${evidenceWarning ? `<div class="detail-builder-evidence"><strong>근거 확인 필요</strong><span>${escapeHtml(evidenceWarning)}</span></div>` : ""}
      <div class="detail-builder-candidate-actions"><button class="btn btn-primary" type="button" data-action="apply-builder-candidate"${candidate.canApply ? "" : " disabled"}>문서에 적용</button><button class="btn" type="button" data-action="retry-builder-candidate">후보 다시 만들기</button><button class="btn" type="button" data-action="discard-builder-candidate">후보 닫기</button></div>` : ""}
  </aside>`;
}

function renderEvidenceSources(builder, selectedRefs = []) {
  const sources = Array.isArray(builder.evidenceSources) ? builder.evidenceSources : [];
  if (sources.length === 0) {
    return `<div class="detail-builder-evidence"><strong>검증 근거 / 출처</strong><span>후기·성분·인증·보증 같은 사실 후보에는 생성 시 등록한 자료 파일이 필요합니다.</span></div>`;
  }
  const selected = new Set(Array.isArray(selectedRefs) ? selectedRefs : []);
  return `<fieldset class="detail-builder-evidence-sources"><legend>검증 근거 / 출처</legend>${sources.map((source) => {
    const available = source.available === true && typeof source.excerpt === "string" && source.excerpt.trim();
    return `<label><input type="checkbox" data-builder-evidence-ref value="${escapeAttribute(source.id ?? "")}"${selected.has(source.id) ? " checked" : ""}${available ? "" : " disabled"} /> <span>${escapeHtml(source.label ?? source.id ?? "자료 파일")}${available ? "" : " · 텍스트 내용이 없어 자동 근거로 사용할 수 없음"}</span></label>`;
  }).join("")}</fieldset>`;
}

function renderCandidateBody(candidate, selectedProposalIds, sectionTypes) {
  if (candidate.operation === "regenerate") return renderCandidatePatch(candidate, sectionTypes);
  const proposals = Array.isArray(candidate.proposedSections) ? candidate.proposedSections : [];
  if (proposals.length === 0) return `<p class="detail-builder-empty">표시할 후보 섹션이 없습니다.</p>`;
  return `<div class="detail-builder-proposals">${proposals.map((proposal, index) => renderProposal(proposal, index, selectedProposalIds, sectionTypes)).join("")}</div>`;
}

function renderProposal(proposal, index, selectedProposalIds, sectionTypes) {
  const selected = selectedProposalIds.includes(proposal.id);
  const bullets = Array.isArray(proposal.bullets) ? proposal.bullets.join("\n") : "";
  return `<article class="detail-builder-proposal" data-builder-proposal data-builder-proposal-id="${escapeAttribute(proposal.id)}">
    <label class="detail-builder-proposal-select"><input type="checkbox" data-builder-proposal-toggle="${escapeAttribute(proposal.id)}"${selected ? " checked" : ""} /> <span>후보 ${index + 1} 적용</span></label>
    <span class="detail-editor-section-kind">${escapeHtml(sectionTypeLabel(proposal.kind, sectionTypes))}</span>
    <label>제목<input data-builder-proposal-heading value="${escapeAttribute(proposal.heading ?? "")}" /></label>
    <label>본문<textarea data-builder-proposal-body rows="3">${escapeHtml(proposal.body ?? "")}</textarea></label>
    <label>핵심 포인트<textarea data-builder-proposal-bullets rows="2">${escapeHtml(bullets)}</textarea></label>
    <label>배치<select data-builder-proposal-layout>${layoutOptions(proposal.layout)}</select></label>
  </article>`;
}

function renderCandidatePatch(candidate, sectionTypes) {
  const patch = candidate.patch?.changes ?? {};
  const allowed = new Set(candidate.allowedFields ?? []);
  const kind = patch.kind ?? candidate.targetKind;
  return `<article class="detail-builder-proposal" data-builder-patch>
    <span class="detail-editor-section-kind">부분 재생성 · ${escapeHtml(sectionTypeLabel(kind, sectionTypes))}</span>
    ${allowed.has("heading") ? `<label>제목<input data-builder-patch-heading value="${escapeAttribute(patch.heading ?? "")}" /></label>` : ""}
    ${allowed.has("body") ? `<label>본문<textarea data-builder-patch-body rows="3">${escapeHtml(patch.body ?? "")}</textarea></label>` : ""}
    ${allowed.has("bullets") ? `<label>핵심 포인트<textarea data-builder-patch-bullets rows="2">${escapeHtml(Array.isArray(patch.bullets) ? patch.bullets.join("\n") : "")}</textarea></label>` : ""}
    ${allowed.has("layout") ? `<label>배치<select data-builder-patch-layout>${layoutOptions(patch.layout)}</select></label>` : ""}
    ${allowed.has("image") ? renderCandidateImage(patch.image) : ""}
  </article>`;
}

function renderCandidateImage(image) {
  if (!image?.url) return `<div class="detail-builder-image-placeholder">이미지 후보는 적용 직전에 안전한 저장소로 옮겨집니다.</div>`;
  return `<figure class="detail-builder-candidate-image"><img src="${escapeAttribute(image.url)}" alt="${escapeAttribute(image.alt ?? image.filename ?? "AI 후보 이미지")}" /><figcaption>${escapeHtml(image.filename ?? "후보 이미지")}</figcaption></figure>`;
}

function renderSection(section, index, count, sectionTypes) {
  const image = section.image;
  const bullets = Array.isArray(section.bullets) ? section.bullets.join("\n") : "";
  const sectionLabel = sectionAccessibilityLabel(section, index);
  const kind = canonicalKind(section.kind);
  return `<article class="detail-editor-section-card${section.visible ? "" : " is-hidden-section"}" data-editor-section data-section-id="${escapeAttribute(section.id)}" data-section-source="${escapeAttribute(section.source ?? "generated")}">
    <div class="detail-editor-section-card-head"><div><button class="detail-editor-drag-handle" type="button" draggable="true" data-editor-drag-handle aria-label="${escapeAttribute(`${sectionLabel} 끌어서 이동`)}">끌어 이동</button><span class="detail-editor-section-number">${String(index + 1).padStart(2, "0")}</span><span class="detail-editor-section-kind">${escapeHtml(section.source === "user" ? "USER SECTION" : "AI SECTION")} · ${escapeHtml(sectionTypeLabel(kind, sectionTypes))}</span></div><span class="detail-editor-visibility">${section.visible ? "표시 중" : "숨김"}</span></div>
    <div class="detail-editor-fields"><label>섹션 제목<input data-section-heading value="${escapeAttribute(section.heading ?? "")}" /></label><label>본문<textarea data-section-body rows="4">${escapeHtml(section.body ?? "")}</textarea></label><label>핵심 포인트<textarea data-section-bullets rows="3" placeholder="한 줄에 하나씩">${escapeHtml(bullets)}</textarea></label><div class="detail-editor-selects"><label>종류<select data-section-kind>${kindOptions(sectionTypes, kind)}</select></label><label>배치<select data-section-layout>${layoutOptions(section.layout)}</select></label></div></div>
    <div class="detail-editor-media-row">${image ? `<figure data-section-image><img src="${escapeAttribute(image.url)}" alt="${escapeAttribute(image.alt || image.filename)}" /><figcaption>${escapeHtml(image.filename)}</figcaption></figure>` : `<div class="detail-editor-empty-image">이미지 없음<span>필요한 섹션에 생성 이미지를 연결하세요.</span></div>`}<div class="detail-editor-section-actions"><button class="btn" type="button" data-action="open-detail-image-picker" data-mobile-label="${image ? "교체" : "선택"}" aria-label="${escapeAttribute(`${sectionLabel} 이미지 ${image ? "교체" : "선택"}`)}">${image ? "이미지 교체" : "이미지 선택"}</button>${image ? `<button class="btn" type="button" data-action="edit-detail-image" data-mobile-label="수정" aria-label="${escapeAttribute(`${sectionLabel} 이미지 수정본 만들기`)}">수정본 만들기</button><button class="btn" type="button" data-action="remove-detail-image" data-mobile-label="제거" aria-label="${escapeAttribute(`${sectionLabel} 이미지 제거`)}">이미지 제거</button>` : ""}<button class="btn" type="button" data-action="duplicate-detail-section" data-mobile-label="복제" aria-label="${escapeAttribute(`${sectionLabel} 복제`)}">복제</button><button class="btn" type="button" data-action="move-detail-section-up" aria-label="${escapeAttribute(`${sectionLabel} 위로 이동`)}"${index === 0 ? " disabled" : ""}>위로</button><button class="btn" type="button" data-action="move-detail-section-down" aria-label="${escapeAttribute(`${sectionLabel} 아래로 이동`)}"${index === count - 1 ? " disabled" : ""}>아래로</button><button class="btn" type="button" data-action="toggle-detail-section" aria-label="${escapeAttribute(`${sectionLabel} ${section.visible ? "숨기기" : "표시하기"}`)}">${section.visible ? "숨기기" : "표시하기"}</button><button class="btn btn-danger" type="button" data-action="delete-detail-section" aria-label="${escapeAttribute(`${sectionLabel} 삭제`)}">삭제</button></div></div>
    <div class="detail-editor-regenerate"><label>${escapeHtml(sectionLabel)} AI 다시 만들기<select data-builder-regenerate-mode>${regenerationModeOptions()}</select></label><button class="btn" type="button" data-action="regenerate-detail-section" aria-label="${escapeAttribute(`${sectionLabel} AI 다시 만들기`)}">AI 다시 만들기</button></div>
  </article>`;
}

function renderAssets(assets) {
  if (!Array.isArray(assets) || assets.length === 0) return `<p class="detail-editor-empty-assets">생성된 이미지가 없습니다.</p>`;
  return assets.map((asset, index) => `<button class="detail-editor-asset" type="button" data-detail-asset data-asset-index="${index}" data-asset-url="${escapeAttribute(asset.url ?? "")}" data-asset-filename="${escapeAttribute(asset.filename ?? asset.name ?? "asset.png")}"><img src="${escapeAttribute(asset.url ?? "")}" alt="${escapeAttribute(asset.purpose ?? asset.filename ?? "생성 이미지")}" /><span>${escapeHtml(asset.filename ?? asset.name ?? "이미지")}</span></button>`).join("");
}

function tab(id, label, active) { return `<button id="detail-page-${id}-tab" class="detail-editor-tab" type="button" role="tab" data-editor-tab="${id}" aria-selected="${id === active}" aria-controls="detail-page-${id}-panel" tabindex="${id === active ? "0" : "-1"}">${label}</button>`; }
function builderPaneTab(id, label, active) { return `<button class="detail-builder-pane-tab" type="button" role="tab" data-builder-pane="${id}" aria-selected="${id === active}" aria-controls="detail-builder-${id}" tabindex="${id === active ? "0" : "-1"}">${label}</button>`; }
function kindOptions(sectionTypes, selected) { return sectionTypes.map((type) => `<option value="${escapeAttribute(type.key)}"${type.key === selected ? " selected" : ""}>${escapeHtml(type.labelKo)}</option>`).join(""); }
function layoutOptions(selected) { return LAYOUTS.map((value) => `<option value="${value}"${value === selected ? " selected" : ""}>${escapeHtml(layoutLabel(value))}</option>`).join(""); }
function regenerationModeOptions() { return [["copy", "문구만"], ["image", "이미지만"], ["layout", "디자인 배치만"], ["copy+image", "문구와 이미지"], ["whole", "섹션 전체"]].map(([value, label]) => `<option value="${value}">${label}</option>`).join(""); }
function fieldValue(root, selector) { return root.querySelector(selector)?.value ?? ""; }
function canonicalKind(value) { return LEGACY_KIND_ALIASES[value] ?? value ?? "free-text"; }
function sectionTypeLabel(kind, sectionTypes) { return sectionTypes.find((type) => type.key === canonicalKind(kind))?.labelKo ?? canonicalKind(kind); }
function categoryLabel(category) { return ({ beauty: "뷰티", fashion: "패션", food: "식품", electronics: "전자", default: "기본" })[category] ?? "기본"; }
function layoutLabel(value) { return ({ "text-only": "텍스트", "image-first": "이미지 먼저", "image-last": "이미지 나중", "split-left": "좌측 분할", "split-right": "우측 분할", "full-bleed": "전체 이미지" })[value] ?? value; }
function candidateOperationLabel(candidate) { return ({ template: "템플릿 후보", add: "새 섹션 후보", regenerate: "부분 재생성 후보" })[candidate.operation] ?? "AI 후보"; }
function statusLabel(status) { return ({ idle: "대기", preparing: "준비 중", running: "생성 중", ready: "검토 필요", failed: "실패", stale: "무효", cancelled: "취소됨", expired: "만료" })[status] ?? "대기"; }
function sectionAccessibilityLabel(section, index) { const heading = String(section.heading ?? "").trim(); return heading ? `섹션 ${index + 1}번 ‘${heading}’` : `섹션 ${index + 1}번`; }
function saveLabel(state) { return ({ dirty: "변경사항 있음", saving: "저장 중…", saved: "저장됨", conflict: "충돌 해결 필요", failed: "저장 실패" }[state.saveStatus] ?? "저장 대기"); }
function escapeHtml(value) { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }
function escapeAttribute(value) { return escapeHtml(value); }
