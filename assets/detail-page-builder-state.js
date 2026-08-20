const MAX_SECTIONS = 60;
const PROTECTED_SECTION_FIELDS = new Set(["id", "visible", "source"]);

export const DETAIL_PAGE_BUILDER_FALLBACK = Object.freeze({
  sectionTypes: Object.freeze([
    ["hero", "히어로", "상품과 핵심 가치를 첫 화면에서 소개합니다."],
    ["problem", "문제 제기", "사용자의 불편과 해결 맥락을 설명합니다."],
    ["benefits", "핵심 장점", "검증된 상품 장점을 짧고 선명하게 정리합니다."],
    ["features", "기능 상세", "상품의 구성과 기능을 설명합니다."],
    ["usage", "사용 방법", "사용 순서와 활용 상황을 안내합니다."],
    ["specifications", "제품 사양", "확인된 사양만 정리합니다."],
    ["reviews", "후기", "검증된 고객 후기만 넣을 수 있습니다."],
    ["faq", "자주 묻는 질문", "구매 전 질문과 답을 정리합니다."],
    ["cta", "마지막 제안", "다음 행동을 명확하게 안내합니다."],
    ["comparison", "비교", "확인 가능한 기준으로 선택 차이를 비교합니다."],
    ["before-after", "전후 비교", "근거가 있는 전후 정보만 보여줍니다."],
    ["components", "구성품", "포함 구성과 사용 위치를 정리합니다."],
    ["proof", "신뢰 근거", "인증과 수치처럼 출처가 있는 근거입니다."],
    ["ingredients", "성분·소재", "확인된 성분과 소재만 설명합니다."],
    ["warranty", "보증·교환", "확인된 보증 및 교환 조건을 안내합니다."],
    ["free-text", "자유 텍스트", "직접 작성하는 설명 섹션입니다."],
    ["free-image", "자유 이미지", "직접 선택한 이미지를 중심으로 구성합니다."],
    ["steps", "단계 안내", "구매와 사용의 단계를 안내합니다."],
    ["media", "미디어", "향후 GIF·MP4 확장에 연결할 자리입니다."],
  ].map(([key, labelKo, description]) => Object.freeze({ key, labelKo, description }))),
  templateCategories: Object.freeze(["beauty", "fashion", "food", "electronics", "default"]),
});

export function createDetailPageBuilderState() {
  return {
    registry: clone(DETAIL_PAGE_BUILDER_FALLBACK),
    category: "default",
    activePane: "structure",
    libraryOpen: false,
    candidate: undefined,
    authority: undefined,
    selectedProposalIds: [],
    status: "idle",
    notice: "",
    error: undefined,
  };
}

export function detailPageBuilderReducer(state, action) {
  switch (action.type) {
    case "set-registry":
      return {
        ...state,
        registry: normalizeRegistry(action.registry),
      };
    case "set-category":
      return { ...state, category: categoryValue(action.category), notice: "", error: undefined };
    case "set-pane":
      return { ...state, activePane: paneValue(action.pane), notice: "", error: undefined };
    case "set-library-open":
      return { ...state, libraryOpen: Boolean(action.open) };
    case "candidate-started":
      return {
        ...state,
        candidate: undefined,
        authority: action.authority ? clone(action.authority) : undefined,
        selectedProposalIds: [],
        status: "preparing",
        notice: "AI 후보를 준비하고 있습니다.",
        error: undefined,
      };
    case "candidate-materializing":
      if (!state.candidate) return state;
      return {
        ...state,
        status: "preparing",
        notice: "후보 이미지를 적용 가능한 파일로 준비하고 있습니다.",
        error: undefined,
      };
    case "candidate-received": {
      const candidate = clone(action.candidate);
      const defaultSelectedProposalIds = candidate.operation === "regenerate"
        ? []
        : candidate.proposedSections.map((section) => section.id);
      const selectedProposalIds = Array.isArray(action.selectedProposalIds)
        ? action.selectedProposalIds.filter((id) => defaultSelectedProposalIds.includes(id))
        : defaultSelectedProposalIds;
      return {
        ...state,
        candidate,
        authority: action.authority ? clone(action.authority) : state.authority,
        selectedProposalIds,
        status: candidate.status ?? "preparing",
        notice: candidateNotice(candidate),
        error: candidate.error?.message,
      };
    }
    case "candidate-failed":
      return {
        ...state,
        status: "failed",
        notice: "AI 후보를 만들지 못했습니다.",
        error: action.message ?? "AI 후보를 만들지 못했습니다.",
      };
    case "toggle-proposal": {
      if (!state.candidate || state.candidate.operation === "regenerate") return state;
      const id = String(action.proposalId ?? "");
      if (!state.candidate.proposedSections.some((section) => section.id === id)) return state;
      const selectedProposalIds = state.selectedProposalIds.includes(id)
        ? state.selectedProposalIds.filter((value) => value !== id)
        : [...state.selectedProposalIds, id];
      return { ...state, selectedProposalIds, notice: "" };
    }
    case "edit-proposal":
      return updateCandidateSection(state, action.proposalId, action.changes);
    case "edit-patch":
      return updateCandidatePatch(state, action.changes);
    case "candidate-cleared":
      return {
        ...state,
        candidate: undefined,
        authority: undefined,
        selectedProposalIds: [],
        status: "idle",
        notice: action.notice ?? "후보를 닫았습니다.",
        error: undefined,
      };
    default:
      return state;
  }
}

export function createCandidateAuthority(candidate, context) {
  return {
    candidateId: candidate?.candidateId,
    requestToken: candidate?.requestToken,
    projectId: context?.projectId,
    revision: context?.revision,
    sessionId: context?.sessionId,
    documentVersion: context?.documentVersion,
  };
}

export function candidateMatchesCurrentAuthority(candidate, authority, context) {
  if (!candidate || !authority || !context) return false;
  return candidate.candidateId === authority.candidateId
    && candidate.requestToken === authority.requestToken
    && candidate.projectId === authority.projectId
    && candidate.baseRevision === authority.revision
    && context.projectId === authority.projectId
    && context.revision === authority.revision
    && context.sessionId === authority.sessionId
    && context.documentVersion === authority.documentVersion;
}

export function applyCandidateToDocument(documentValue, candidate, authority, context, options = {}) {
  if (!candidateMatchesCurrentAuthority(candidate, authority, context)) return rejected("CANDIDATE_STALE", "문서가 변경되어 이 후보를 적용할 수 없습니다. 다시 만들어 주세요.");
  if (candidate.status !== "ready") return rejected("CANDIDATE_NOT_APPLICABLE", "준비된 후보만 적용할 수 있습니다.");
  if (!candidate.canApply) return rejected("EVIDENCE_REQUIRED", "확인 가능한 근거를 추가한 뒤 후보를 다시 만들어 주세요.");
  if ((candidateHasImages(candidate) && !candidate.materializedAt) || (Array.isArray(candidate.stagedAssets) && candidate.stagedAssets.length > 0)) {
    return rejected("CANDIDATE_ASSETS_NOT_MATERIALIZED", "후보 이미지를 먼저 적용 가능한 파일로 준비해야 합니다.");
  }
  if (!documentValue || !Array.isArray(documentValue.sections)) return rejected("DOCUMENT_UNAVAILABLE", "현재 상세페이지 문서를 찾을 수 없습니다.");
  if (candidate.operation === "regenerate") return applyPatch(documentValue, candidate);
  return insertProposals(documentValue, candidate, options);
}

function insertProposals(documentValue, candidate, options) {
  const proposals = selectedProposals(candidate, options.selectedProposalIds);
  if (proposals.length === 0) return rejected("NO_PROPOSALS_SELECTED", "적용할 후보 섹션을 하나 이상 선택해 주세요.");
  if (documentValue.sections.length + proposals.length > MAX_SECTIONS) return rejected("SECTION_LIMIT", "상세페이지는 최대 60개 섹션까지 저장할 수 있습니다.");
  const createId = typeof options.createId === "function" ? options.createId : defaultId;
  const usedIds = new Set(documentValue.sections.map((section) => section.id));
  const accepted = proposals.map((proposal) => acceptedSection(proposal, createUniqueSectionId(usedIds, createId)));
  const afterIndex = documentValue.sections.findIndex((section) => section.id === candidate.afterSectionId);
  const insertAt = afterIndex < 0 ? documentValue.sections.length : afterIndex + 1;
  const sections = [...documentValue.sections];
  sections.splice(insertAt, 0, ...accepted);
  return {
    ok: true,
    document: { ...clone(documentValue), sections },
    selectedSectionId: accepted.at(-1).id,
    application: {
      type: "insert",
      proposals: accepted.map((section, index) => ({
        proposalId: proposals[index].id,
        sectionId: section.id,
        editable: editableSectionFields(section),
      })),
    },
  };
}

function applyPatch(documentValue, candidate) {
  const targetId = candidate.targetSectionId ?? candidate.patch?.sectionId;
  const index = documentValue.sections.findIndex((section) => section.id === targetId);
  if (index < 0) return rejected("CANDIDATE_STALE", "다시 만들 섹션을 찾을 수 없습니다.");
  const changes = candidate.patch?.changes;
  if (!isRecord(changes)) return rejected("INVALID_CANDIDATE", "후보 변경 내용을 읽을 수 없습니다.");
  const allowed = new Set(Array.isArray(candidate.allowedFields) ? candidate.allowedFields : []);
  const next = { ...documentValue.sections[index] };
  const appliedChanges = {};
  for (const [key, value] of Object.entries(changes)) {
    if (PROTECTED_SECTION_FIELDS.has(key) || !allowed.has(key)) continue;
    next[key] = clone(value);
    appliedChanges[key] = clone(value);
  }
  const sections = [...documentValue.sections];
  sections[index] = next;
  return {
    ok: true,
    document: { ...clone(documentValue), sections },
    selectedSectionId: targetId,
    application: { type: "patch", sectionId: targetId, changes: appliedChanges },
  };
}

function selectedProposals(candidate, selectedProposalIds) {
  const proposals = Array.isArray(candidate.proposedSections) ? candidate.proposedSections : [];
  const selected = selectedProposalIds === undefined ? proposals.map((section) => section.id) : selectedProposalIds;
  const selectedIds = new Set(Array.isArray(selected) ? selected : []);
  return proposals.filter((section) => selectedIds.has(section.id));
}

function acceptedSection(proposal, id) {
  const accepted = clone(proposal);
  accepted.id = id;
  if (accepted.image && typeof accepted.image === "object") {
    accepted.image = { ...accepted.image, id: `image-${id}` };
  }
  return accepted;
}

function editableSectionFields(section) {
  return {
    heading: clone(section.heading),
    body: clone(section.body),
    bullets: clone(section.bullets),
    layout: clone(section.layout),
  };
}

function createUniqueSectionId(usedIds, createId) {
  let id;
  do {
    id = `section-ai-${String(createId()).replaceAll(/[^a-zA-Z0-9_-]/gu, "-")}`.slice(0, 120);
  } while (usedIds.has(id));
  usedIds.add(id);
  return id;
}

function updateCandidateSection(state, proposalId, changes) {
  if (!state.candidate || state.candidate.operation === "regenerate" || !isRecord(changes)) return state;
  const index = state.candidate.proposedSections.findIndex((section) => section.id === proposalId);
  if (index < 0) return state;
  const allowed = new Set(["heading", "body", "bullets", "layout"]);
  const next = { ...state.candidate.proposedSections[index] };
  for (const [key, value] of Object.entries(changes)) if (allowed.has(key)) next[key] = clone(value);
  const proposedSections = [...state.candidate.proposedSections];
  proposedSections[index] = next;
  return { ...state, candidate: { ...state.candidate, proposedSections }, notice: "" };
}

function updateCandidatePatch(state, changes) {
  if (!state.candidate || state.candidate.operation !== "regenerate" || !isRecord(changes)) return state;
  const allowed = new Set(state.candidate.allowedFields ?? []);
  const patch = { ...(state.candidate.patch ?? {}), changes: { ...(state.candidate.patch?.changes ?? {}) } };
  for (const [key, value] of Object.entries(changes)) if (allowed.has(key) && !PROTECTED_SECTION_FIELDS.has(key)) patch.changes[key] = clone(value);
  return { ...state, candidate: { ...state.candidate, patch }, notice: "" };
}

function candidateNotice(candidate) {
  if (candidate.status === "ready" && candidate.canApply) return "후보를 확인하고 적용할 섹션을 선택하세요.";
  if (candidate.status === "ready") return candidate.evidence?.warnings?.[0] ?? "후보를 적용하려면 추가 정보가 필요합니다.";
  if (candidate.status === "running") return "AI 후보를 준비하고 있습니다.";
  return candidate.error?.message ?? "후보 상태를 확인하세요.";
}

function candidateHasImages(candidate) {
  return [
    ...(candidate?.proposedSections ?? []).map((section) => section?.image),
    candidate?.patch?.changes?.image,
  ].some(Boolean);
}

function normalizeRegistry(registry) {
  if (!isRecord(registry) || !Array.isArray(registry.sectionTypes) || registry.sectionTypes.length === 0) return clone(DETAIL_PAGE_BUILDER_FALLBACK);
  return {
    sectionTypes: registry.sectionTypes.map((entry) => ({
      key: String(entry.key ?? ""),
      labelKo: String(entry.labelKo ?? entry.key ?? "섹션"),
      description: String(entry.description ?? ""),
      evidencePolicy: String(entry.evidencePolicy ?? "not-applicable"),
    })).filter((entry) => entry.key),
    templateCategories: Array.isArray(registry.templateCategories) && registry.templateCategories.length > 0
      ? registry.templateCategories.map(categoryValue)
      : [...DETAIL_PAGE_BUILDER_FALLBACK.templateCategories],
  };
}

function categoryValue(value) {
  const category = String(value ?? "default").toLowerCase();
  return DETAIL_PAGE_BUILDER_FALLBACK.templateCategories.includes(category) ? category : "default";
}

function paneValue(value) {
  return ["structure", "edit", "candidate"].includes(value) ? value : "structure";
}

function rejected(code, message) {
  return { ok: false, code, message };
}

function defaultId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}
