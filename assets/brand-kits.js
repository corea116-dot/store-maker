import { BODY_FONT_OPTIONS, DISPLAY_FONT_OPTIONS, IMAGERY_PRESETS, AD_MOOD_PRESET_IDS, IMAGE_BACKGROUND_OPTIONS, IMAGE_STYLE_OPTIONS } from "./brand-kit-options.js";
import { buildBrandKitSelection, createBrandKitState, getBrandKitGenerationBlocker, getVisibleBrandControls, reduceBrandKitState } from "./brand-kit-state.js";

const $ = (selector) => document.querySelector(selector);
const token = () => document.querySelector("meta[name='store-maker-token']")?.content ?? "";
const colorNames = ["primary", "secondary", "accent", "background", "surface", "text"];
const fontMap = new Map([...DISPLAY_FONT_OPTIONS, ...BODY_FONT_OPTIONS].map((item) => [item.id, item]));
let state = createBrandKitState();
let opener = null;
let scrollY = 0;
let inerted = [];
let logoDataUrl = null;
let logoAction = "keep";
let selectedDraftId = null;
let acceptedResetPending = false;

document.addEventListener("DOMContentLoaded", () => {
  populateCatalogs();
  bindBrandKitUi();
  render();
  void loadRegistry();
});

export function createBrandKitController() {
  return Object.freeze({
    getState: () => state,
    getSelection: () => buildBrandKitSelection(state),
    getBlocker: () => getBrandKitGenerationBlocker(state),
    getVisibleControls: () => getVisibleBrandControls(state),
    getView: generationView,
    reload: loadRegistry,
    controlChanged(field, value) { state = reduceBrandKitState(state, { type: "control-changed", field, value }); render(); },
    async generationAccepted(status) {
      if (status !== 202) return;
      acceptedResetPending = true;
      await loadRegistry();
    },
  });
}

function bindBrandKitUi() {
  window.storeMakerBrandKits = createBrandKitController();
  $("#brand-kit-retry").addEventListener("click", loadRegistry);
  $("#brand-kit-create").addEventListener("click", (event) => openDialog(event.currentTarget, null));
  $("#brand-kit-manage").addEventListener("click", (event) => openDialog(event.currentTarget, currentKit()));
  $("#brand-kit-new").addEventListener("click", () => editDraft(null));
  $("#brand-kit-close").addEventListener("click", requestClose);
  $("#brand-kit-dialog-overlay").addEventListener("click", requestClose);
  $("#brand-kit-select").addEventListener("change", (event) => { state = reduceBrandKitState(state, { type: "kit-selected", id: event.target.value }); render(); });
  $("#brand-kit-enabled").addEventListener("change", (event) => { state = reduceBrandKitState(state, { type: "selection-enabled", enabled: event.target.checked }); render(); });
  $("#brand-kit-reset-overrides").addEventListener("click", () => { state = reduceBrandKitState(state, { type: "overrides-reset" }); render(); });
  $("#brand-kit-editor").addEventListener("input", onDraftInput);
  $("#brand-kit-editor").addEventListener("change", onDraftInput);
  $("#brand-kit-editor").addEventListener("submit", saveDraft);
  $("#brand-kit-imagery-preset").addEventListener("change", applyImageryPreset);
  $("#brand-kit-logo-input").addEventListener("change", readLogo);
  $("#brand-kit-remove-logo").addEventListener("change", (event) => { logoAction = event.target.checked ? "remove" : "keep"; logoDataUrl = null; updatePreview(); markDirty(); });
  $("#brand-kit-duplicate").addEventListener("click", duplicateSelected);
  $("#brand-kit-set-default").addEventListener("click", setSelectedDefault);
  $("#brand-kit-delete").addEventListener("click", openDeleteConfirmation);
  $("#brand-kit-delete-cancel").addEventListener("click", closeDeleteConfirmation);
  $("#brand-kit-delete-confirm").addEventListener("click", deleteSelected);
  $("#brand-kit-load-current").addEventListener("click", loadConflictCurrent);
  $("#brand-kit-duplicate-draft").addEventListener("click", saveConflictAsDuplicate);
  document.addEventListener("keydown", onDialogKeydown);
  for (const name of colorNames) {
    const picker = document.querySelector(`[name="colors.${name}"]`);
    const hex = document.querySelector(`[name="colors.${name}.hex"]`);
    picker.addEventListener("input", () => { hex.value = picker.value.toUpperCase(); onDraftInput(); });
    hex.addEventListener("input", () => { if (/^#[0-9a-f]{6}$/iu.test(hex.value)) picker.value = hex.value; });
  }
}

async function api(path, { method = "GET", body } = {}) {
  let response;
  try {
    response = await fetch(path, { method, headers: { "x-store-maker-token": token(), ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  } catch (cause) {
    throw Object.assign(new Error("브랜드 키트 서버에 연결할 수 없습니다."), { code: "NETWORK_ERROR", cause });
  }
  let payload;
  try { payload = await response.json(); } catch { payload = {}; }
  if (!response.ok) throw Object.assign(new Error(payload.error?.message ?? `HTTP ${response.status}`), { status: response.status, code: payload.error?.code, fields: payload.error?.fields ?? [], current: payload.current });
  return payload;
}

async function loadRegistry() {
  setStatus("브랜드 키트 목록을 불러오고 있습니다.");
  try {
    const payload = await api("/api/brand-kits");
    state = reduceBrandKitState(state, { type: "registry-loaded", registry: payload });
    if (acceptedResetPending) {
      state = reduceBrandKitState(state, { type: "generation-response", status: 202 });
      acceptedResetPending = false;
    }
  } catch (error) {
    state = reduceBrandKitState(state, { type: "registry-failed", message: error.message });
  }
  render();
}

function render() {
  const panel = $("#brand-kit-panel");
  panel.dataset.phase = state.phase;
  const select = $("#brand-kit-select");
  select.replaceChildren();
  if (!state.kits.length) select.append(option("", state.phase === "loading" ? "키트를 불러오는 중입니다" : "저장된 키트가 없습니다"));
  else if (!state.selection.id) select.append(option("", "선택된 브랜드 키트 없음"));
  for (const kit of state.kits) select.append(option(kit.id, `${kit.name}${kit.id === state.defaultId ? " · 기본" : ""}`));
  select.value = state.selection.id ?? "";
  select.disabled = state.phase !== "ready" || !state.kits.length;
  $("#brand-kit-enabled").disabled = !state.selection.id || state.phase !== "ready";
  $("#brand-kit-enabled").checked = state.selection.enabled;
  $("#brand-kit-create").disabled = state.phase !== "ready";
  $("#brand-kit-manage").disabled = state.phase !== "ready";
  $("#brand-kit-retry").classList.toggle("is-hidden", state.phase !== "error");
  const phaseLabel = state.phase === "loading" ? "불러오는 중" : state.phase === "error" ? "불러오기 실패" : !state.kits.length ? "키트 없음" : state.selection.enabled ? "적용 준비" : "적용 안 함";
  $("#brand-kit-readiness").textContent = phaseLabel;
  const kit = currentKit();
  const summary = $("#brand-kit-summary");
  summary.classList.toggle("is-hidden", !kit);
  if (kit) renderSummary(kit);
  $("#brand-kit-override").classList.toggle("is-hidden", !Object.keys(state.selection.overrides ?? {}).length);
  const message = state.phase === "error" ? `목록을 불러오지 못했습니다. ${state.loadError} 다시 시도하기 전에는 브랜드 적용 준비가 완료되지 않습니다.` : state.phase === "loading" ? "브랜드 키트 목록을 불러오고 있습니다. 생성 준비가 잠시 보류됩니다." : !state.kits.length ? "저장된 브랜드 키트가 없습니다. 새 키트를 만들어도 브랜드 없이 생성할 수 있습니다." : kit ? `${kit.name} ${state.selection.enabled ? "적용 준비됨" : "적용 안 함"}. 리비전 ${kit.revision}.` : "브랜드 키트를 선택하세요.";
  setStatus(message);
  renderList();
  document.dispatchEvent(new CustomEvent("store-maker:brand-kit-state", { detail: generationView() }));
}

function generationView() {
  const kit = currentKit();
  return Object.freeze({
    phase: state.phase,
    enabled: state.selection.enabled === true && Boolean(kit),
    sourceUrl: kit?.sourceUrl ?? "",
    controls: getVisibleBrandControls(state),
    blocker: getBrandKitGenerationBlocker(state),
  });
}

function renderSummary(kit) {
  $("#brand-kit-summary-name").textContent = kit.name;
  $("#brand-kit-revision").textContent = `revision ${kit.revision}`;
  $("#brand-kit-default-badge").classList.toggle("is-hidden", kit.id !== state.defaultId);
  const image = $("#brand-kit-summary-logo");
  image.toggleAttribute("hidden", !kit.logo?.url);
  if (kit.logo?.url) { image.src = kit.logo.url; image.alt = `${kit.name} 로고`; } else image.removeAttribute("src");
  $("#brand-kit-logo-empty").toggleAttribute("hidden", Boolean(kit.logo?.url));
  const swatches = $("#brand-kit-summary-swatches"); swatches.replaceChildren();
  for (const [name, hex] of Object.entries(kit.colors ?? {})) { if (name === "onPrimary") continue; const item = document.createElement("span"); item.className = "brand-kit-swatch"; const chip = document.createElement("i"); chip.style.setProperty("--brand-swatch", hex); chip.setAttribute("aria-hidden", "true"); item.append(chip, document.createTextNode(`${name} ${hex}`)); swatches.append(item); }
}

function openDialog(button, kit) {
  opener = button; scrollY = window.scrollY;
  editDraft(kit);
  const dialog = $("#brand-kit-dialog");
  $("#brand-kit-dialog-overlay").classList.remove("is-hidden"); dialog.classList.remove("is-hidden");
  document.body.classList.add("brand-kit-dialog-open");
  inerted = [...document.body.children].filter((node) => node !== dialog && node.id !== "brand-kit-dialog-overlay" && !node.inert).map((node) => { node.inert = true; return node; });
  window.setTimeout(() => (kit ? $("#brand-kit-list [aria-current='true']") : $("#brand-kit-name"))?.focus(), 0);
}

function requestClose() {
  if (state.dialog.status === "dirty" && !window.confirm("저장하지 않은 변경을 버리고 닫을까요?")) return;
  closeDialog();
}

function closeDialog() {
  $("#brand-kit-dialog").classList.add("is-hidden"); $("#brand-kit-dialog-overlay").classList.add("is-hidden");
  document.body.classList.remove("brand-kit-dialog-open");
  inerted.forEach((node) => { node.inert = false; }); inerted = [];
  window.scrollTo({ top: scrollY, behavior: "instant" }); opener?.focus(); opener = null;
}

function onDialogKeydown(event) {
  const dialog = $("#brand-kit-dialog"); if (dialog.classList.contains("is-hidden")) return;
  if (event.key === "Escape") { event.preventDefault(); requestClose(); return; }
  if (event.key !== "Tab") return;
  const focusable = [...dialog.querySelectorAll("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])")].filter((item) => item.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0]; const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

function editDraft(kit) {
  selectedDraftId = kit?.id ?? null; logoAction = "keep"; logoDataUrl = null;
  state = reduceBrandKitState(state, { type: "dialog-opened", draft: kit ?? emptyDraft() });
  fillForm(state.dialog.draft); clearErrors(); closeDeleteConfirmation(); renderList(); updateEditorState(); updatePreview();
}

function fillForm(kit) {
  $("#brand-kit-name").value = kit.name ?? ""; $("#brand-kit-source-url").value = kit.sourceUrl ?? "";
  for (const name of colorNames) { const value = kit.colors?.[name] ?? emptyDraft().colors[name]; document.querySelector(`[name="colors.${name}"]`).value = value; document.querySelector(`[name="colors.${name}.hex"]`).value = value; }
  $("#brand-kit-display-font").value = kit.typography?.displayFontId ?? DISPLAY_FONT_OPTIONS[0].id;
  $("#brand-kit-body-font").value = kit.typography?.bodyFontId ?? BODY_FONT_OPTIONS[0].id;
  $("#brand-kit-voice-summary").value = kit.voice?.summary ?? ""; $("#brand-kit-voice-dos").value = (kit.voice?.dos ?? []).join("\n"); $("#brand-kit-voice-donts").value = (kit.voice?.donts ?? []).join("\n"); $("#brand-kit-voice-sample").value = kit.voice?.sample ?? "";
  $("#brand-kit-imagery-preset").value = kit.imagery?.presetId ?? "custom"; $("#brand-kit-mood").value = kit.imagery?.mood ?? ""; $("#brand-kit-lighting").value = kit.imagery?.lighting ?? ""; $("#brand-kit-composition").value = kit.imagery?.composition ?? ""; $("#brand-kit-background").value = kit.imagery?.background ?? ""; $("#brand-kit-color-treatment").value = kit.imagery?.colorTreatment ?? ""; $("#brand-kit-avoid").value = (kit.imagery?.avoid ?? []).join("\n");
  $("#brand-kit-ad-mood").value = kit.defaults?.adMoodPreset ?? AD_MOOD_PRESET_IDS[0]; $("#brand-kit-image-style").value = kit.defaults?.imageStyle ?? IMAGE_STYLE_OPTIONS[0]; $("#brand-kit-image-background").value = kit.defaults?.imageBackground ?? IMAGE_BACKGROUND_OPTIONS[0];
  $("#brand-kit-logo-input").value = ""; $("#brand-kit-remove-logo").checked = false;
}

function draftFromForm() {
  const lines = (value) => value.split("\n").map((item) => item.trim()).filter(Boolean);
  return { schemaVersion: 1, name: $("#brand-kit-name").value, sourceUrl: $("#brand-kit-source-url").value || null, colors: Object.fromEntries(colorNames.map((name) => [name, document.querySelector(`[name="colors.${name}.hex"]`).value.toUpperCase()])), typography: { displayFontId: $("#brand-kit-display-font").value, bodyFontId: $("#brand-kit-body-font").value }, voice: { summary: $("#brand-kit-voice-summary").value, dos: lines($("#brand-kit-voice-dos").value), donts: lines($("#brand-kit-voice-donts").value), sample: $("#brand-kit-voice-sample").value }, imagery: { presetId: $("#brand-kit-imagery-preset").value, mood: $("#brand-kit-mood").value, lighting: $("#brand-kit-lighting").value, composition: $("#brand-kit-composition").value, background: $("#brand-kit-background").value, colorTreatment: $("#brand-kit-color-treatment").value, avoid: lines($("#brand-kit-avoid").value) }, defaults: { adMoodPreset: $("#brand-kit-ad-mood").value, imageStyle: $("#brand-kit-image-style").value, imageBackground: $("#brand-kit-image-background").value } };
}

function onDraftInput() { markDirty(); updatePreview(); }
function markDirty() { state = reduceBrandKitState(state, { type: "dialog-draft-changed", draft: draftFromForm() }); updateEditorState(); }
function updateEditorState() { $("#brand-kit-editor-title").textContent = selectedDraftId ? "키트 수정" : "새 키트 만들기"; $("#brand-kit-draft-state").textContent = state.dialog.status === "dirty" ? "저장 안 됨" : selectedDraftId ? `revision ${currentDraftKit()?.revision ?? "-"}` : "새 초안"; $("#brand-kit-delete").classList.toggle("is-hidden", !selectedDraftId); $("#brand-kit-duplicate").disabled = !selectedDraftId; $("#brand-kit-set-default").disabled = !selectedDraftId || selectedDraftId === state.defaultId; }

async function saveDraft(event) {
  event.preventDefault(); clearErrors(); const kit = draftFromForm(); const editing = currentDraftKit();
  state = reduceBrandKitState(state, { type: "dialog-saving" }); setDialogStatus("저장 중입니다…");
  try {
    const body = editing ? { expectedRevision: editing.revision, kit, logoChange: logoAction === "replace" ? { action: "replace", dataUrl: logoDataUrl } : { action: logoAction } } : { kit, ...(logoDataUrl ? { logoDataUrl } : {}), setAsDefault: state.kits.length === 0, expectedRegistryRevision: state.registryRevision };
    const payload = await api(editing ? `/api/brand-kits/${encodeURIComponent(editing.id)}` : "/api/brand-kits", { method: editing ? "PUT" : "POST", body });
    state = reduceBrandKitState(state, { type: "dialog-saved", registry: payload, kit: payload.kit });
    if (!state.selection.id) state = reduceBrandKitState(state, { type: "kit-selected", id: payload.kit.id });
    selectedDraftId = payload.kit.id; logoAction = "keep"; logoDataUrl = null; fillForm(payload.kit); render(); updateEditorState(); updatePreview(); setDialogStatus("키트를 저장했습니다.");
  } catch (error) { handleSaveError(error); }
}

function handleSaveError(error) {
  if (error.status === 422) { const fields = Object.fromEntries((error.fields ?? []).map((item) => [item.field, item.message])); state = reduceBrandKitState(state, { type: "dialog-validation-failed", fields }); showFieldErrors(error.fields ?? []); setDialogStatus("입력 내용을 확인하세요."); return; }
  if (error.status === 409) { state = reduceBrandKitState(state, { type: "dialog-conflict", current: error.current }); $("#brand-kit-conflict").classList.remove("is-hidden"); $("#brand-kit-current-copy").textContent = JSON.stringify(error.current, null, 2); setDialogStatus("충돌이 감지되었습니다. ", "내 초안은 유지되었습니다."); return; }
  state = reduceBrandKitState(state, { type: "dialog-network-failed", message: error.message }); setDialogStatus(`저장 실패: ${error.message}`);
}

async function duplicateSelected() { const kit = currentDraftKit(); if (!kit) return; await mutate(`/api/brand-kits/${encodeURIComponent(kit.id)}/duplicate`, { expectedRevision: kit.revision, name: `${kit.name} 복사본` }, "키트를 복제했습니다."); }
async function setSelectedDefault() { const kit = currentDraftKit(); if (!kit) return; await mutate(`/api/brand-kits/${encodeURIComponent(kit.id)}/default`, { expectedRegistryRevision: state.registryRevision }, "기본 키트로 지정했습니다.", false); }
function openDeleteConfirmation() { const kit = currentDraftKit(); if (!kit) return; $("#brand-kit-delete-name").textContent = kit.name; $("#brand-kit-delete-name-input").value = ""; $("#brand-kit-delete-name-error").textContent = ""; $("#brand-kit-delete-confirmation").classList.remove("is-hidden"); $("#brand-kit-delete-name-input").focus(); }
function closeDeleteConfirmation() { $("#brand-kit-delete-confirmation")?.classList.add("is-hidden"); }
async function deleteSelected() { const kit = currentDraftKit(); if (!kit) return; const typed = $("#brand-kit-delete-name-input").value; if (typed !== kit.name) { $("#brand-kit-delete-name-error").textContent = "키트 이름이 일치하지 않습니다."; $("#brand-kit-delete-name-input").setAttribute("aria-invalid", "true"); $("#brand-kit-delete-name-input").focus(); setDialogStatus("이름이 일치하지 않아 삭제하지 않았습니다."); return; } $("#brand-kit-delete-name-input").removeAttribute("aria-invalid"); await mutate(`/api/brand-kits/${encodeURIComponent(kit.id)}/delete`, { expectedRevision: kit.revision, expectedRegistryRevision: state.registryRevision }, "키트를 삭제했습니다.", false, true); }
async function mutate(path, body, success, selectKit = true, deleted = false) { setDialogStatus("처리 중입니다…"); try { const payload = await api(path, { method: "POST", body }); state = reduceBrandKitState(state, { type: "registry-response", registry: payload }); if (deleted) editDraft(null); else if (selectKit && payload.kit) editDraft(payload.kit); render(); setDialogStatus(success); } catch (error) { handleSaveError(error); } }

function loadConflictCurrent() { const current = state.dialog.conflict; const kit = current?.id ? current : current?.kits?.find((item) => item.id === selectedDraftId); if (!kit) { void loadRegistry(); return; } state = reduceBrandKitState(state, { type: "registry-response", registry: current.kits ? current : { registryRevision: state.registryRevision, defaultBrandKitId: state.defaultId, kits: state.kits.map((item) => item.id === kit.id ? kit : item) } }); editDraft(kit); $("#brand-kit-conflict").classList.add("is-hidden"); setDialogStatus("서버의 현재 버전을 불러왔습니다."); }
async function saveConflictAsDuplicate() { const draft = draftFromForm(); try { const latest = await api("/api/brand-kits"); state = reduceBrandKitState(state, { type: "registry-response", registry: latest }); const payload = await api("/api/brand-kits", { method: "POST", body: { kit: { ...draft, name: `${draft.name} 복구본` }, ...(logoDataUrl ? { logoDataUrl } : {}), setAsDefault: false, expectedRegistryRevision: latest.registryRevision } }); state = reduceBrandKitState(state, { type: "dialog-saved", registry: payload, kit: payload.kit }); selectedDraftId = payload.kit.id; $("#brand-kit-conflict").classList.add("is-hidden"); fillForm(payload.kit); render(); updateEditorState(); setDialogStatus("내 초안을 복구본으로 저장했습니다."); } catch (error) { handleSaveError(error); } }

function renderList() { const list = $("#brand-kit-list"); if (!list) return; list.replaceChildren(); if (!state.kits.length) { const p = document.createElement("p"); p.textContent = "아직 저장된 키트가 없습니다."; list.append(p); return; } for (const kit of state.kits) { const button = document.createElement("button"); button.type = "button"; button.className = "btn brand-kit-list-item"; button.setAttribute("aria-current", String(kit.id === selectedDraftId)); const strong = document.createElement("strong"); strong.textContent = kit.name; const meta = document.createElement("span"); meta.textContent = `${kit.id === state.defaultId ? "기본 · " : ""}revision ${kit.revision}`; button.append(strong, meta); button.addEventListener("click", () => { if (state.dialog.status === "dirty" && !window.confirm("저장하지 않은 변경을 버리고 다른 키트를 열까요?")) return; editDraft(kit); }); list.append(button); } }

function updatePreview() { const kit = draftFromForm(); const preview = $("#brand-kit-preview"); if (!preview) return; preview.style.setProperty("--brand-primary", safeHex(kit.colors.primary)); preview.style.setProperty("--brand-accent", safeHex(kit.colors.accent)); preview.style.setProperty("--brand-background", safeHex(kit.colors.background)); preview.style.setProperty("--brand-text", safeHex(kit.colors.text)); preview.style.setProperty("--brand-display-font", fontMap.get(kit.typography.displayFontId)?.stack ?? "inherit"); preview.style.setProperty("--brand-body-font", fontMap.get(kit.typography.bodyFontId)?.stack ?? "inherit"); $("#brand-kit-preview-mood").textContent = kit.imagery.mood || "분위기 미리보기"; $("#brand-kit-preview-heading").textContent = kit.name || "매일 쓰는 제품의 조용한 차이"; $("#brand-kit-preview-body").textContent = kit.voice.sample || kit.voice.summary || "브랜드 말투와 색상, 글꼴이 콘텐츠 안에서만 적용됩니다."; $("#brand-kit-preview-url").textContent = kit.sourceUrl || "원본 URL 없음"; const image = $("#brand-kit-preview-logo"); const stored = currentDraftKit()?.logo?.url; const source = logoAction === "remove" ? "" : logoDataUrl || stored || ""; if (source) image.src = source; else image.removeAttribute("src"); }
function applyImageryPreset() { const preset = IMAGERY_PRESETS[$("#brand-kit-imagery-preset").value]; if (preset) { $("#brand-kit-mood").value = preset.mood; $("#brand-kit-lighting").value = preset.lighting; $("#brand-kit-composition").value = preset.composition; $("#brand-kit-background").value = preset.background; $("#brand-kit-color-treatment").value = preset.colorTreatment; } onDraftInput(); }
function readLogo(event) { const file = event.target.files?.[0]; if (!file) return; if (file.size > 2 * 1024 * 1024 || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) { $("#brand-kit-error-logo").textContent = "PNG, JPEG, WebP 파일을 2 MiB 이하로 선택하세요."; event.target.value = ""; return; } const reader = new FileReader(); reader.addEventListener("load", () => { logoDataUrl = String(reader.result); logoAction = selectedDraftId ? "replace" : "keep"; $("#brand-kit-remove-logo").checked = false; markDirty(); updatePreview(); }); reader.readAsDataURL(file); }
function showFieldErrors(fields) { clearErrors(); let first; for (const item of fields) { const field = String(item.field); const root = field.split(".")[0]; const color = root === "colors" ? field.split(".")[1] : null; const target = root === "name" ? $("#brand-kit-name") : root === "sourceUrl" ? $("#brand-kit-source-url") : colorNames.includes(color) ? document.querySelector(`[name="colors.${color}.hex"]`) : root === "logo" ? $("#brand-kit-logo-input") : document.querySelector(`[id^="brand-kit-${root}"]`); const output = root === "name" ? $("#brand-kit-error-name") : root === "sourceUrl" ? $("#brand-kit-error-sourceUrl") : root === "colors" ? $("#brand-kit-error-colors") : $("#brand-kit-dialog-status"); output.textContent = output.textContent ? `${output.textContent} ${item.message}` : item.message; if (target?.id) { target.setAttribute("aria-invalid", "true"); target.setAttribute("aria-describedby", output.id); first ??= target; } } first?.focus(); }
function clearErrors() { document.querySelectorAll("#brand-kit-editor [aria-invalid]").forEach((item) => item.removeAttribute("aria-invalid")); document.querySelectorAll("#brand-kit-editor .field-error").forEach((item) => { item.textContent = ""; }); $("#brand-kit-conflict").classList.add("is-hidden"); }
function populateCatalogs() { fillSelect($("#brand-kit-display-font"), DISPLAY_FONT_OPTIONS.map((item) => [item.id, labelId(item.id)])); fillSelect($("#brand-kit-body-font"), BODY_FONT_OPTIONS.map((item) => [item.id, labelId(item.id)])); fillSelect($("#brand-kit-imagery-preset"), Object.keys(IMAGERY_PRESETS).map((id) => [id, labelId(id)])); fillSelect($("#brand-kit-ad-mood"), AD_MOOD_PRESET_IDS.map((id) => [id, labelId(id)])); fillSelect($("#brand-kit-image-style"), IMAGE_STYLE_OPTIONS.map((id) => [id, id])); fillSelect($("#brand-kit-image-background"), IMAGE_BACKGROUND_OPTIONS.map((id) => [id, id])); }
function emptyDraft() { return { schemaVersion: 1, name: "", sourceUrl: null, colors: { primary: "#111111", secondary: "#E8E8E8", accent: "#C24A2E", background: "#FFFFFF", surface: "#F5F5F5", text: "#111111" }, typography: { displayFontId: DISPLAY_FONT_OPTIONS[0].id, bodyFontId: BODY_FONT_OPTIONS[0].id }, voice: { summary: "", dos: [], donts: [], sample: "" }, imagery: { presetId: "custom", mood: "", lighting: "", composition: "", background: "", colorTreatment: "", avoid: [] }, defaults: { adMoodPreset: AD_MOOD_PRESET_IDS[0], imageStyle: IMAGE_STYLE_OPTIONS[0], imageBackground: IMAGE_BACKGROUND_OPTIONS[0] } }; }
function currentKit() { return state.kits.find((kit) => kit.id === state.selection.id) ?? null; }
function currentDraftKit() { return state.kits.find((kit) => kit.id === selectedDraftId) ?? null; }
function setStatus(message) { $("#brand-kit-status").textContent = message; }
function setDialogStatus(message, keepTogether = "") { const status = $("#brand-kit-dialog-status"); status.textContent = message; if (keepTogether) { const phrase = document.createElement("span"); phrase.className = "brand-kit-keep-together"; phrase.textContent = keepTogether; status.append(phrase); } }
function option(value, label) { const item = document.createElement("option"); item.value = value; item.textContent = label; return item; }
function fillSelect(select, items) { select.replaceChildren(...items.map(([value, label]) => option(value, label))); }
function labelId(id) { return id.replaceAll("-", " "); }
function safeHex(value) { return /^#[0-9A-F]{6}$/iu.test(value) ? value : "#111111"; }
