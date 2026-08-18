import { readableError, showToast } from "./app-utils.js";
import { copyDetailPageJson, getDetailPageProject, saveDetailPageProject } from "./detail-page-editor-api.js";
import { trapDialogFocus } from "./detail-page-editor-focus.js";
import { createDetailPageEditorState, detailPageEditorReducer } from "./detail-page-editor-state.js";
import { detailPageAssetToImage, readSectionChanges, renderDetailPageEditor, updateDetailPageEditorSaveStatus } from "./detail-page-editor-view.js";

const autosaveDelayMs = 600;

export function createDetailPageEditorController(options = {}) {
  let editorState;
  let projectUrl;
  let autosaveTimer;
  let savePromise;
  let queuedSave = false;
  let editVersion = 0;
  let openVersion = 0;
  let reloadVersion = 0; let sessionVersion = 0;
  let bound = false;

  return {
    bind, close, open, flush, reloadLatest, overwriteLatest, onEditedImage,
    get active() { return Boolean(editorState); },
    get projectId() { return editorState?.projectId; },
    get sessionId() { return sessionVersion; },
  };
  function bind() {
    if (bound) return;
    bound = true;
    document.addEventListener("click", handleClick);
    document.addEventListener("input", handleFieldEvent);
    document.addEventListener("change", handleFieldEvent);
    document.addEventListener("keydown", handleKeydown);
  }

  async function open(job) {
    const requestVersion = ++openVersion; reloadVersion += 1;
    if (job?.result?.result?.generationMode === "ad-set" || !job?.id) {
      if (editorState?.dirty && !(await flush())) return "blocked";
      if (requestVersion !== openVersion) return "stale";
      close();
      return "unsupported";
    }
    if (editorState?.dirty && !(await flush())) return "blocked";
    if (requestVersion !== openVersion) return "stale";
    const nextProjectUrl = `/api/detail-page-projects/${encodeURIComponent(job.id)}`;
    const payload = await getDetailPageProject(nextProjectUrl);
    if (requestVersion !== openVersion) return "stale";
    projectUrl = nextProjectUrl;
    editorState = createDetailPageEditorState(payload);
    sessionVersion += 1;
    options.onPayload?.(payload, { projectId: editorState.projectId, sessionId: sessionVersion });
    render();
    return "opened";
  }

  function close() {
    clearTimeout(autosaveTimer);
    autosaveTimer = undefined;
    openVersion += 1; reloadVersion += 1; sessionVersion += 1;
    editorState = undefined;
    projectUrl = undefined;
    queuedSave = false;
  }

  async function flush() {
    clearTimeout(autosaveTimer);
    autosaveTimer = undefined;
    if (!editorState?.dirty || editorState.saveStatus === "conflict") return !editorState?.dirty;
    if (savePromise) {
      queuedSave = true;
      await savePromise;
      return editorState?.dirty ? flush() : true;
    }
    savePromise = performSave();
    const saved = await savePromise;
    savePromise = undefined;
    if (queuedSave && editorState?.dirty && editorState.saveStatus !== "conflict") {
      queuedSave = false;
      return flush();
    }
    queuedSave = false;
    return saved;
  }

  async function performSave() {
    const snapshot = editorState.document;
    const snapshotVersion = editVersion;
    const saveSessionId = sessionVersion;
    const expectedRevision = editorState.revision;
    editorState = detailPageEditorReducer(editorState, { type: "save-started" });
    updateDetailPageEditorSaveStatus(editorState);
    try {
      const result = await saveDetailPageProject(projectUrl, expectedRevision, snapshot);
      if (!editorState || saveSessionId !== sessionVersion) return false;
      if (result.conflict) {
        editorState = detailPageEditorReducer(editorState, { type: "save-conflict", project: result.payload.project });
        render();
        return false;
      }
      if (snapshotVersion === editVersion) {
        editorState = detailPageEditorReducer(editorState, { type: "save-succeeded", payload: result.payload });
      } else {
        const localDocument = editorState.document;
        const selectedSectionId = editorState.selectedSectionId;
        editorState = {
          ...createDetailPageEditorState(result.payload),
          document: localDocument,
          selectedSectionId,
          dirty: true,
          saveStatus: "dirty",
        };
      }
      options.onPayload?.(result.payload, { projectId: editorState.projectId, sessionId: sessionVersion });
      render();
      return true;
    } catch (error) {
      if (!editorState || saveSessionId !== sessionVersion) return false;
      editorState = detailPageEditorReducer(editorState, { type: "save-failed", message: readableError(error) });
      render();
      return false;
    }
  }

  function handleFieldEvent(event) {
    const field = event.target.closest?.("[data-section-heading], [data-section-body], [data-section-bullets], [data-section-kind], [data-section-layout]");
    const card = field?.closest("[data-editor-section]");
    if (!field || !card || !editorState) return;
    dispatch({ type: "update-section", sectionId: card.dataset.sectionId, changes: readSectionChanges(card) }, { rerender: false });
  }

  async function handleClick(event) {
    const actionNode = event.target.closest?.("[data-action], [data-editor-tab], [data-detail-asset]");
    if (!actionNode || !editorState || !actionNode.closest("#detail-page-editor")) return;
    const card = actionNode.closest("[data-editor-section]");
    const sectionId = card?.dataset.sectionId;
    const action = actionNode.dataset.action;
    if (actionNode.dataset.editorTab) return switchTab(actionNode.dataset.editorTab);
    if (actionNode.hasAttribute("data-detail-asset")) return assignAsset(actionNode, sectionIdFromPicker());
    if (action === "save-detail-page") return void flush();
    if (action === "add-detail-section") return addSection();
    if (action === "move-detail-section-up") return dispatch({ type: "move-section", sectionId, direction: -1 });
    if (action === "move-detail-section-down") return dispatch({ type: "move-section", sectionId, direction: 1 });
    if (action === "toggle-detail-section") return dispatch({ type: "toggle-section-visibility", sectionId });
    if (action === "delete-detail-section") return dispatch({ type: "delete-section", sectionId });
    if (action === "remove-detail-image") return dispatch({ type: "remove-image", sectionId });
    if (action === "open-detail-image-picker") return openImagePicker(sectionId, actionNode);
    if (action === "close-detail-image-picker") return closeImagePicker();
    if (action === "edit-detail-image") return editSectionImage(sectionId);
    if (action === "reload-latest-detail-page") return void reloadLatest();
    if (action === "copy-local-detail-page") return void copyLocal();
    if (action === "overwrite-latest-detail-page") return void overwriteLatest();
  }

  function handleKeydown(event) {
    const picker = document.querySelector("#detail-page-image-picker:not([hidden])");
    if (trapDialogFocus(event, picker)) return;
    const tab = event.target.closest?.("[role='tab'][data-editor-tab]");
    if (tab && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const target = ["ArrowRight", "End"].includes(event.key) ? "preview" : "edit";
      void switchTab(target, { focus: true });
      return;
    }
    if (event.key === "Escape" && !document.querySelector("#detail-page-image-picker")?.classList.contains("is-hidden")) closeImagePicker();
  }

  async function switchTab(tab, optionsValue = {}) {
    if (tab === "preview" && !(await flush())) return;
    editorState = detailPageEditorReducer(editorState, { type: "set-tab", tab });
    render();
    if (optionsValue.focus) document.querySelector(`[data-editor-tab='${tab}']`)?.focus();
  }

  function addSection() {
    dispatch({
      type: "add-section",
      afterSectionId: editorState.selectedSectionId,
      section: { id: `section-user-${crypto.randomUUID()}`, heading: "새 섹션" },
    });
  }
  function assignAsset(button, sectionId) {
    const asset = editorState.assets[Number(button.dataset.assetIndex)];
    if (!asset || !sectionId) return;
    for (const section of editorState.document.sections) {
      if (section.id !== sectionId && section.image?.url === asset.url) editorState = detailPageEditorReducer(editorState, { type: "remove-image", sectionId: section.id });
    }
    dispatch({ type: "attach-image", sectionId, image: detailPageAssetToImage(asset, sectionId, "generated") });
  }
  function editSectionImage(sectionId) {
    const image = editorState.document.sections.find((section) => section.id === sectionId)?.image;
    if (image) options.openImageEditor?.(image, { projectId: editorState.projectId, sectionId, sourceUrl: image.url, sessionId: sessionVersion });
  }
  function onEditedImage(image, context) {
    if (!editorState || context?.sessionId !== sessionVersion || !context?.projectId || !context?.sectionId || !context?.sourceUrl || !image?.url) return false;
    if (context.projectId !== editorState.projectId) return false;
    const section = editorState.document.sections.find((item) => item.id === context.sectionId);
    if (!section || section.image?.url !== context.sourceUrl) return false;
    dispatch({ type: "attach-image", sectionId: context.sectionId, image: detailPageAssetToImage(image, context.sectionId, "edited") });
    return true;
  }
  async function reloadLatest() {
    if (!editorState || !projectUrl) return "inactive";
    const requestVersion = ++reloadVersion;
    const requestProjectId = editorState.projectId;
    const requestProjectUrl = projectUrl;
    const payload = await getDetailPageProject(requestProjectUrl);
    if (requestVersion !== reloadVersion || requestProjectId !== editorState?.projectId || requestProjectUrl !== projectUrl) return "stale";
    editorState = detailPageEditorReducer(editorState, { type: "load-project", payload });
    options.onPayload?.(payload, { projectId: editorState.projectId, sessionId: sessionVersion });
    render();
    showToast("서버의 최신 편집본을 불러왔습니다.");
    return "reloaded";
  }

  async function overwriteLatest() {
    const previous = editorState;
    editorState = detailPageEditorReducer(editorState, { type: "overwrite-conflict" });
    if (editorState === previous) return false;
    render();
    return flush();
  }

  async function copyLocal() {
    try {
      await copyDetailPageJson(editorState.document);
      showToast("내 로컬 편집 JSON을 복사했습니다.");
    } catch (error) {
      showToast(readableError(error));
    }
  }

  function dispatch(action, config = {}) {
    const previous = editorState;
    editorState = detailPageEditorReducer(editorState, action);
    if (editorState === previous) return;
    if (editorState.dirty && !previous.dirty || editorState.document !== previous.document) editVersion += 1;
    if (config.rerender !== false) render();
    else updateDetailPageEditorSaveStatus(editorState);
    if (editorState.dirty && editorState.saveStatus !== "conflict") scheduleSave();
  }

  function scheduleSave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = window.setTimeout(() => void flush(), autosaveDelayMs);
  }

  function render() {
    const container = document.querySelector(options.containerSelector ?? "#result-preview");
    if (!container || !editorState) return;
    renderDetailPageEditor(container, { ...editorState, projectUrl, sessionId: sessionVersion });
    focusRequestedSection();
  }

  function focusRequestedSection() {
    if (!editorState.focusSectionId) return;
    const card = [...document.querySelectorAll("[data-editor-section]")].find((node) => node.dataset.sectionId === editorState.focusSectionId);
    card?.querySelector("[data-section-heading]")?.focus();
    editorState = detailPageEditorReducer(editorState, { type: "clear-notice" });
  }

  function openImagePicker(sectionId, opener) {
    const picker = document.querySelector("#detail-page-image-picker");
    if (!picker) return;
    picker.dataset.sectionId = sectionId;
    picker.dataset.openerSectionId = opener.closest("[data-editor-section]")?.dataset.sectionId ?? "";
    picker.classList.remove("is-hidden");
    picker.removeAttribute("hidden");
    picker.querySelector("[data-detail-asset]")?.focus();
  }

  function closeImagePicker() {
    const picker = document.querySelector("#detail-page-image-picker");
    const sectionId = picker?.dataset.openerSectionId;
    picker?.classList.add("is-hidden");
    picker?.setAttribute("hidden", "");
    [...document.querySelectorAll("[data-editor-section]")].find((node) => node.dataset.sectionId === sectionId)?.querySelector("[data-action='open-detail-image-picker']")?.focus();
  }

  function sectionIdFromPicker() {
    return document.querySelector("#detail-page-image-picker")?.dataset.sectionId;
  }
}
