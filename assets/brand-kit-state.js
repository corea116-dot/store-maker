const CUSTOM_BACKGROUND = "사용자 지정";
const OVERRIDE_FIELDS = ["adMoodPreset", "imageStyle", "imageBackground", "imageCustomBackground"];

function copy(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function finish(value) {
  return freeze(copy(value));
}

function emptySelection() {
  return { id: null, enabled: false, overrides: {} };
}

function emptyDialog() {
  return { draft: null, baseRevision: null, status: "idle", conflict: null, fieldErrors: {}, message: null };
}

function normalizedRegistry(registry) {
  const kits = Array.isArray(registry?.kits) ? copy(registry.kits).filter((kit) => typeof kit?.id === "string" && kit.id && Number.isInteger(kit.revision)) : [];
  const candidate = registry?.defaultBrandKitId;
  const defaultId = typeof candidate === "string" && kits.some((kit) => kit.id === candidate) ? candidate : null;
  return { kits, defaultId, registryRevision: Number.isInteger(registry?.registryRevision) ? registry.registryRevision : 0 };
}

function findKit(state, id = state.selection.id) {
  return state.kits.find((kit) => kit.id === id) ?? null;
}

function controlsForKit(kit) {
  if (!kit) return null;
  const defaults = kit.defaults ?? {};
  const background = defaults.imageBackground ?? null;
  return {
    adMoodPreset: defaults.adMoodPreset ?? null,
    imageStyle: defaults.imageStyle ?? null,
    imageBackground: background,
    imageCustomBackground: background === CUSTOM_BACKGROUND ? kit.imagery?.background ?? "" : null,
  };
}

function selectionFromDefault(defaultId) {
  return defaultId ? { id: defaultId, enabled: true, overrides: {} } : emptySelection();
}

function sameOverrides(left = {}, right = {}) {
  return OVERRIDE_FIELDS.every((field) => left[field] === right[field])
    && Object.keys(left).length === Object.keys(right).length;
}

function selectionMatchesAccepted(selection, accepted, acceptedDraft = accepted) {
  if (!accepted || !acceptedDraft || selection.enabled !== (accepted.enabled === true)) return false;
  return selection.id === (acceptedDraft.id ?? null)
    && selection.enabled === (acceptedDraft.enabled === true)
    && sameOverrides(selection.overrides, acceptedDraft.overrides);
}

function withRegistry(state, registry, { selectDefault } = { selectDefault: false }) {
  const next = normalizedRegistry(registry);
  const selected = findKit({ ...state, kits: next.kits });
  let selection = copy(state.selection);
  let selectionIssue = null;
  if (selectDefault && !selection.id) selection = selectionFromDefault(next.defaultId);
  else if (selection.id && !selected) {
    selection = emptySelection();
    selectionIssue = "selected-kit-missing";
  }
  return { ...state, phase: "ready", ...next, selection, selectionIssue, loadError: null };
}

function overridesFor(kit, controls) {
  const base = controlsForKit(kit);
  if (!base) return {};
  const overrides = {};
  for (const field of OVERRIDE_FIELDS) {
    if (field === "imageCustomBackground" && controls.imageBackground !== CUSTOM_BACKGROUND) continue;
    if (controls[field] !== base[field]) overrides[field] = controls[field];
  }
  return overrides;
}

function updateControls(state, field, value) {
  if (!OVERRIDE_FIELDS.includes(field) || typeof value !== "string") return state;
  const kit = findKit(state);
  const base = controlsForKit(kit);
  if (!base) return state;
  const current = { ...base, ...state.selection.overrides };
  if (field === "imageCustomBackground" && current.imageBackground !== CUSTOM_BACKGROUND) return state;
  const controls = { ...current, [field]: field === "imageCustomBackground" ? value.trim() : value };
  if (field === "imageBackground" && value !== CUSTOM_BACKGROUND) controls.imageCustomBackground = null;
  return finish({ ...state, selection: { ...state.selection, overrides: overridesFor(kit, controls) } });
}

export function createBrandKitState() {
  return finish({
    phase: "loading",
    kits: [],
    registryRevision: null,
    defaultId: null,
    selection: emptySelection(),
    selectionIssue: null,
    loadError: null,
    dialog: emptyDialog(),
  });
}

export function getBrandKitGenerationBlocker(state) {
  if (state?.phase !== "ready") return state?.phase === "error" ? "brand-kit-load-failed" : "brand-kit-loading";
  const kit = state.selection.enabled ? findKit(state) : null;
  const controls = getVisibleBrandControls(state);
  if (kit && controls?.imageBackground === CUSTOM_BACKGROUND && !controls.imageCustomBackground?.trim()) return "custom-background-required";
  return null;
}

export function canGenerateBrandKit(state) {
  return getBrandKitGenerationBlocker(state) === null;
}

export function getVisibleBrandControls(state) {
  const kit = findKit(state);
  const base = controlsForKit(kit);
  if (!base) return null;
  const visible = { ...base, ...state.selection.overrides };
  if (visible.imageBackground !== CUSTOM_BACKGROUND) visible.imageCustomBackground = null;
  return finish(visible);
}

export function buildBrandKitSelection(state) {
  if (!canGenerateBrandKit(state)) return null;
  const kit = state.selection.enabled ? findKit(state) : null;
  if (!kit) return finish({ enabled: false });
  return finish({ enabled: true, id: kit.id, expectedRevision: kit.revision, overrides: overridesFor(kit, getVisibleBrandControls(state)) });
}

export function reduceBrandKitState(state = createBrandKitState(), event = {}) {
  switch (event.type) {
    case "registry-loaded":
      return finish(withRegistry(state, event.registry, { selectDefault: true }));
    case "registry-failed":
      return finish({ ...state, phase: "error", loadError: typeof event.message === "string" ? event.message : "load-failed" });
    case "registry-response":
      return finish(withRegistry(state, event.registry));
    case "kit-selected": {
      const kit = findKit(state, event.id);
      return kit ? finish({ ...state, selection: { id: kit.id, enabled: true, overrides: {} }, selectionIssue: null }) : state;
    }
    case "selection-enabled":
      return state.selection.id ? finish({ ...state, selection: { ...state.selection, enabled: event.enabled === true } }) : state;
    case "control-changed":
      return updateControls(state, event.field, event.value);
    case "overrides-reset":
      return finish({ ...state, selection: { ...state.selection, overrides: {} } });
    case "generation-response":
      return event.status === 202 && selectionMatchesAccepted(state.selection, event.acceptedSelection, event.acceptedDraft)
        ? finish({ ...state, selection: selectionFromDefault(state.defaultId), selectionIssue: null })
        : state;
    case "dialog-opened": {
      const draft = copy(event.draft ?? null);
      return finish({ ...state, dialog: { draft, baseRevision: Number.isInteger(draft?.revision) ? draft.revision : null, status: "idle", conflict: null, fieldErrors: {}, message: null } });
    }
    case "dialog-draft-changed":
      return finish({ ...state, dialog: { ...state.dialog, draft: copy(event.draft ?? null), status: "dirty", fieldErrors: {}, message: null } });
    case "dialog-saving":
      return finish({ ...state, dialog: { ...state.dialog, status: "saving", fieldErrors: {}, message: null } });
    case "dialog-validation-failed":
      return finish({ ...state, dialog: { ...state.dialog, status: "validation-error", fieldErrors: copy(event.fields ?? {}), message: null } });
    case "dialog-conflict":
      return finish({ ...state, dialog: { ...state.dialog, status: "conflict", conflict: copy(event.current ?? null), message: null } });
    case "dialog-network-failed":
      return finish({ ...state, dialog: { ...state.dialog, status: "network-error", message: typeof event.message === "string" ? event.message : "network-error" } });
    case "dialog-saved": {
      const next = withRegistry(state, event.registry);
      return finish({ ...next, dialog: { draft: copy(event.kit ?? null), baseRevision: Number.isInteger(event.kit?.revision) ? event.kit.revision : null, status: "saved", conflict: null, fieldErrors: {}, message: null } });
    }
    default:
      return state;
  }
}
