const EDITABLE_SECTION_FIELDS = new Set(["kind", "layout", "heading", "body", "bullets"]);

export function createDetailPageEditorState(payload, options = {}) {
  const project = clone(payload.project);
  return {
    projectId: project.id,
    revision: project.revision,
    document: project.document,
    preview: clone(payload.preview ?? {}),
    exports: clone(payload.exports ?? {}),
    assets: clone(payload.assets ?? []),
    activeTab: options.activeTab ?? "edit",
    selectedSectionId: project.document.sections[0]?.id,
    focusSectionId: undefined,
    dirty: false,
    saveStatus: "saved",
    lastSavedAt: project.updatedAt,
    error: undefined,
    conflict: undefined,
    notice: "",
  };
}

export function detailPageEditorReducer(state, action) {
  switch (action.type) {
    case "load-project":
      return createDetailPageEditorState(action.payload, { activeTab: state.activeTab });
    case "set-tab":
      return ["edit", "preview"].includes(action.tab) ? { ...state, activeTab: action.tab, notice: "" } : state;
    case "select-section":
      return sectionIndex(state, action.sectionId) >= 0 ? { ...state, selectedSectionId: action.sectionId } : state;
    case "update-section":
      return updateSection(state, action.sectionId, (section) => applySectionChanges(section, action.changes));
    case "add-section":
      return addSection(state, action);
    case "move-section":
      return moveSection(state, action.sectionId, action.direction);
    case "toggle-section-visibility":
      return toggleVisibility(state, action.sectionId);
    case "delete-section":
      return deleteSection(state, action.sectionId);
    case "attach-image":
      return updateSection(state, action.sectionId, (section) => ({ ...section, image: clone(action.image) }));
    case "remove-image":
      return updateSection(state, action.sectionId, (section) => {
        const { image, ...withoutImage } = section;
        return withoutImage;
      });
    case "save-started":
      return { ...state, saveStatus: "saving", error: undefined, notice: "" };
    case "save-failed":
      return { ...state, dirty: true, saveStatus: "failed", error: action.message, notice: "" };
    case "save-conflict":
      return {
        ...state,
        dirty: true,
        saveStatus: "conflict",
        error: undefined,
        conflict: { project: clone(action.project) },
        notice: "서버에 더 최신 편집본이 있습니다.",
      };
    case "save-succeeded": {
      const saved = createDetailPageEditorState(action.payload, { activeTab: state.activeTab });
      return { ...saved, selectedSectionId: state.selectedSectionId ?? saved.selectedSectionId };
    }
    case "clear-notice":
      return { ...state, notice: "", focusSectionId: undefined };
    default:
      return state;
  }
}

function updateSection(state, id, update) {
  const index = sectionIndex(state, id);
  if (index < 0) return state;
  const sections = state.document.sections.map((section, sectionIndexValue) => sectionIndexValue === index ? update(section) : section);
  if (sections[index] === state.document.sections[index]) return state;
  return dirtyState(state, sections, { selectedSectionId: id });
}

function applySectionChanges(section, changes) {
  if (typeof changes !== "object" || changes === null) return section;
  const next = { ...section };
  let changed = false;
  for (const [field, value] of Object.entries(changes)) {
    if (!EDITABLE_SECTION_FIELDS.has(field)) continue;
    next[field] = field === "bullets" && Array.isArray(value) ? [...value] : value;
    changed = true;
  }
  return changed ? next : section;
}

function addSection(state, action) {
  const id = action.section?.id;
  if (typeof id !== "string" || !id.trim()) return { ...state, notice: "새 섹션 ID가 필요합니다." };
  if (state.document.sections.some((section) => section.id === id)) return { ...state, notice: "같은 섹션 ID가 이미 있습니다." };
  if (state.document.sections.length >= 60) return { ...state, notice: "섹션은 최대 60개까지 추가할 수 있습니다." };
  const section = {
    id,
    kind: "text",
    layout: "text-only",
    visible: true,
    heading: action.section.heading ?? "새 섹션",
    body: action.section.body ?? "",
    bullets: Array.isArray(action.section.bullets) ? [...action.section.bullets] : [],
    source: "user",
  };
  const afterIndex = sectionIndex(state, action.afterSectionId);
  const insertAt = afterIndex < 0 ? state.document.sections.length : afterIndex + 1;
  const sections = [...state.document.sections];
  sections.splice(insertAt, 0, section);
  return dirtyState(state, sections, { selectedSectionId: id, focusSectionId: id, notice: `${insertAt + 1}번째에 새 섹션을 추가했습니다.` });
}

function moveSection(state, id, direction) {
  const from = sectionIndex(state, id);
  const delta = direction === -1 ? -1 : direction === 1 ? 1 : 0;
  const to = from + delta;
  if (from < 0 || delta === 0 || to < 0 || to >= state.document.sections.length) return state;
  const sections = [...state.document.sections];
  const [section] = sections.splice(from, 1);
  sections.splice(to, 0, section);
  return dirtyState(state, sections, { selectedSectionId: id, focusSectionId: id, notice: `${section.heading || "섹션"}을 ${to + 1}번째로 이동했습니다.` });
}

function toggleVisibility(state, id) {
  const index = sectionIndex(state, id);
  if (index < 0) return state;
  const section = state.document.sections[index];
  if (section.visible && visibleCount(state.document.sections) === 1) return visibleGuard(state);
  return updateSection(state, id, (current) => ({ ...current, visible: !current.visible }));
}

function deleteSection(state, id) {
  const index = sectionIndex(state, id);
  if (index < 0) return state;
  const section = state.document.sections[index];
  if (state.document.sections.length === 1 || (section.visible && visibleCount(state.document.sections) === 1)) return visibleGuard(state);
  const sections = state.document.sections.filter((candidate) => candidate.id !== id);
  const selectedSectionId = state.selectedSectionId === id ? sections[Math.min(index, sections.length - 1)]?.id : state.selectedSectionId;
  return dirtyState(state, sections, { selectedSectionId, notice: `${section.heading || "섹션"}을 삭제했습니다.` });
}

function visibleGuard(state) {
  return { ...state, notice: "상세페이지에는 표시되는 섹션이 하나 이상 필요합니다." };
}

function dirtyState(state, sections, extras = {}) {
  return {
    ...state,
    ...extras,
    document: { ...state.document, sections },
    dirty: true,
    saveStatus: state.conflict ? "conflict" : "dirty",
    error: undefined,
  };
}

function sectionIndex(state, id) {
  return state.document.sections.findIndex((section) => section.id === id);
}

function visibleCount(sections) {
  return sections.filter(({ visible }) => visible).length;
}

function clone(value) {
  return structuredClone(value);
}
