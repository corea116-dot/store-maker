import { readableError, showToast } from "./app-utils.js";
import { createDetailPageBuilderController } from "./detail-page-builder.js";
import { copyDetailPageJson, getDetailPageProject, recoverDetailPageProject, saveDetailPageProject } from "./detail-page-editor-api.js";
import { trapDialogFocus } from "./detail-page-editor-focus.js";
import { closeImagePicker, openImagePicker, sectionIdFromPicker } from "./detail-page-editor-picker.js";
import { applyCandidateToDocument } from "./detail-page-builder-state.js";
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
  let draggedSectionId;
  let libraryFocusRequested = false;
  let libraryDrawerActive = false;
  const builder = createDetailPageBuilderController({
    getContext: () => editorState ? {
      projectId: editorState.projectId,
      revision: editorState.revision,
      sessionId: sessionVersion,
      documentVersion: editVersion,
    } : undefined,
    getEngine: () => options.getBuilderEngine?.(),
    onStateChange() { render(); },
    async onApply(candidate, authority, selectedProposalIds) {
      if (!editorState) return { ok: false, message: "상세페이지를 다시 열어 주세요." };
      const previousState = editorState;
      const previousEditVersion = editVersion;
      const result = applyCandidateToDocument(editorState.document, candidate, authority, {
        projectId: editorState.projectId,
        revision: editorState.revision,
        sessionId: sessionVersion,
        documentVersion: editVersion,
      }, { selectedProposalIds });
      if (!result.ok) return result;
      dispatch({
        type: "replace-document",
        document: result.document,
        selectedSectionId: result.selectedSectionId,
        notice: "AI 후보를 문서에 적용했습니다. 저장하면 공개 미리보기에 반영됩니다.",
      }, { invalidateBuilder: false });
      if (await flush()) return result;
      editorState = {
        ...previousState,
        error: "AI 후보 적용본을 저장하지 못해 이전 편집 상태로 되돌렸습니다.",
        notice: "AI 후보는 저장되기 전까지 공개 편집본에 반영되지 않습니다.",
      };
      editVersion = previousEditVersion;
      render();
      return { ok: false, message: editorState.error };
    },
  });

  return {
    bind, close, open, flush, reloadLatest, overwriteLatest, onEditedImage,
    get active() { return Boolean(editorState); },
    get projectId() { return editorState?.projectId; },
    get sessionId() { return sessionVersion; },
    get builderState() { return builder.state; },
  };
  function bind() {
    if (bound) return;
    bound = true;
    document.addEventListener("click", handleClick);
    document.addEventListener("input", handleFieldEvent);
    document.addEventListener("change", handleFieldEvent);
    document.addEventListener("keydown", handleKeydown);
    document.addEventListener("dragstart", handleDragStart);
    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("drop", handleDrop);
    document.addEventListener("dragend", handleDragEnd);
    globalThis.addEventListener?.("resize", syncBuilderLibraryDrawer);
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
    builder.invalidate("상세페이지를 새로 열어 기존 AI 후보를 닫았습니다.");
    const nextProjectUrl = `/api/detail-page-projects/${encodeURIComponent(job.id)}`;
    let payload;
    try {
      payload = await getDetailPageProject(nextProjectUrl);
    } catch (error) {
      if (error?.code !== "PROJECT_RECOVERY_REQUIRED" || !error.recovery?.expectedCorruptSha256) throw error;
      const confirmed = await confirmProjectRecovery(error.recovery, options.confirmRecovery);
      if (!confirmed) return "recovery-declined";
      payload = await recoverDetailPageProject(nextProjectUrl, error.recovery.expectedCorruptSha256);
    }
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
    libraryFocusRequested = false;
    if (builder.state.libraryOpen) builder.setLibraryOpen(false);
    syncBuilderLibraryDrawer();
    builder.discard("상세페이지를 닫아 AI 후보를 정리했습니다.");
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
    if (!editorState || !event.target.closest?.("#detail-page-editor")) return;
    const proposalField = event.target.closest?.("[data-builder-proposal-heading], [data-builder-proposal-body], [data-builder-proposal-bullets], [data-builder-proposal-layout]");
    const proposal = proposalField?.closest("[data-builder-proposal]");
    if (proposalField && proposal) {
      builder.editProposal(proposal.dataset.builderProposalId, readBuilderProposalChanges(proposal));
      return;
    }
    const patchField = event.target.closest?.("[data-builder-patch-heading], [data-builder-patch-body], [data-builder-patch-bullets], [data-builder-patch-layout]");
    if (patchField) {
      builder.editPatch(readBuilderPatchChange(patchField));
      return;
    }
    const proposalToggle = event.target.closest?.("[data-builder-proposal-toggle]");
    if (proposalToggle) {
      builder.toggleProposal(proposalToggle.dataset.builderProposalToggle);
      return;
    }
    const field = event.target.closest?.("[data-section-heading], [data-section-body], [data-section-bullets], [data-section-kind], [data-section-layout]");
    const card = field?.closest("[data-editor-section]");
    if (!field || !card) return;
    dispatch({ type: "update-section", sectionId: card.dataset.sectionId, changes: readSectionChanges(card) }, { rerender: false });
  }

  async function handleClick(event) {
    const actionNode = event.target.closest?.("[data-action], [data-editor-tab], [data-detail-asset], [data-builder-pane], [data-builder-category], [data-builder-type]");
    if (!actionNode || !editorState || !actionNode.closest("#detail-page-editor")) return;
    const card = actionNode.closest("[data-editor-section]");
    const sectionId = card?.dataset.sectionId;
    const action = actionNode.dataset.action;
    if (actionNode.dataset.editorTab) return switchTab(actionNode.dataset.editorTab);
    if (actionNode.dataset.builderPane) return builder.setPane(actionNode.dataset.builderPane);
    if (actionNode.dataset.builderCategory) {
      builder.setCategory(actionNode.dataset.builderCategory);
      void builder.loadRegistry();
      return;
    }
    if (actionNode.dataset.builderType) {
      void builder.startDirect(actionNode.dataset.builderType, { afterSectionId: editorState.selectedSectionId, evidenceRefs: readBuilderEvidenceRefs() });
      return;
    }
    if (actionNode.hasAttribute("data-detail-asset")) return assignAsset(actionNode, sectionIdFromPicker());
    if (action === "save-detail-page") return void flush();
    if (action === "add-detail-section") return addSection();
    if (action === "duplicate-detail-section") return dispatch({ type: "duplicate-section", sectionId, id: `section-user-${crypto.randomUUID()}` });
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
    if (action === "toggle-builder-library") {
      const willOpen = !builder.state.libraryOpen;
      if (!willOpen) return closeBuilderLibrary();
      builder.setPane("structure");
      libraryFocusRequested = true;
      builder.setLibraryOpen(true);
      void builder.loadRegistry();
      return;
    }
    if (action === "close-builder-library") return closeBuilderLibrary();
    if (action === "create-builder-template") return void builder.startTemplate({ category: builder.state.category, evidenceRefs: readBuilderEvidenceRefs() });
    if (action === "create-builder-instruction") {
      const instruction = actionNode.closest(".detail-builder-library")?.querySelector("[data-builder-instruction]")?.value ?? "";
      return void builder.startInstruction(instruction, { afterSectionId: editorState.selectedSectionId, evidenceRefs: readBuilderEvidenceRefs() });
    }
    if (action === "regenerate-detail-section") {
      const mode = card?.querySelector("[data-builder-regenerate-mode]")?.value;
      const instruction = document.querySelector("[data-builder-regenerate-instruction]")?.value ?? "";
      return void builder.startRegenerate(sectionId, mode, instruction, { evidenceRefs: readBuilderEvidenceRefs() });
    }
    if (action === "apply-builder-candidate") return void builder.apply();
    if (action === "discard-builder-candidate") return builder.discard();
    if (action === "retry-builder-candidate") return void builder.retry({
      instruction: document.querySelector("[data-builder-regenerate-instruction]")?.value ?? "",
      evidenceRefs: readBuilderEvidenceRefs(),
    });
  }

  function handleKeydown(event) {
    const picker = document.querySelector("#detail-page-image-picker:not([hidden])");
    if (trapDialogFocus(event, picker)) return;
    const library = isBuilderLibraryDrawer() ? document.querySelector("#detail-builder-structure") : undefined;
    if (trapDialogFocus(event, library)) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s" && editorState) {
      event.preventDefault();
      void flush();
      return;
    }
    const tab = event.target.closest?.("[role='tab'][data-editor-tab]");
    if (tab && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const target = ["ArrowRight", "End"].includes(event.key) ? "preview" : "edit";
      void switchTab(target, { focus: true });
      return;
    }
    const pane = event.target.closest?.("[role='tab'][data-builder-pane]");
    if (pane && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const panes = ["structure", "edit", "candidate"];
      const currentIndex = panes.indexOf(pane.dataset.builderPane);
      const targetIndex = event.key === "Home" ? 0 : event.key === "End" ? panes.length - 1 : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + panes.length) % panes.length;
      const target = panes[targetIndex];
      builder.setPane(target);
      document.querySelector(`[data-builder-pane='${target}']`)?.focus();
      return;
    }
    if (event.key === "Escape" && builder.state.libraryOpen) {
      event.preventDefault();
      closeBuilderLibrary();
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
  function handleDragStart(event) {
    if (!editorState || !event.target.closest?.("#detail-page-editor")) return;
    const handle = event.target.closest?.("[data-editor-drag-handle]");
    const card = handle?.closest("[data-editor-section]");
    if (!card) return;
    draggedSectionId = card.dataset.sectionId;
    card.classList.add("is-dragging-section");
    event.dataTransfer?.setData("text/plain", draggedSectionId);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }
  function handleDragOver(event) {
    if (!draggedSectionId || !event.target.closest?.("#detail-page-editor")) return;
    const card = event.target.closest?.("[data-editor-section]");
    if (!card || card.dataset.sectionId === draggedSectionId) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  }
  function handleDrop(event) {
    if (!draggedSectionId || !editorState || !event.target.closest?.("#detail-page-editor")) return;
    const target = event.target.closest?.("[data-editor-section]");
    const draggedId = draggedSectionId;
    clearDragState();
    if (!target || target.dataset.sectionId === draggedId) return;
    event.preventDefault();
    const cards = [...document.querySelectorAll("#detail-page-editor [data-editor-section]")];
    const targetIndex = cards.indexOf(target);
    const fromIndex = cards.findIndex((card) => card.dataset.sectionId === draggedId);
    if (targetIndex < 0 || fromIndex < 0) return;
    const rect = target.getBoundingClientRect();
    let insertIndex = targetIndex + (event.clientY > rect.top + rect.height / 2 ? 1 : 0);
    if (fromIndex < insertIndex) insertIndex -= 1;
    dispatch({ type: "move-section-to", sectionId: draggedId, targetIndex: insertIndex });
  }
  function handleDragEnd() {
    clearDragState();
  }
  function clearDragState() {
    document.querySelectorAll?.("#detail-page-editor .is-dragging-section").forEach((card) => card.classList.remove("is-dragging-section"));
    draggedSectionId = undefined;
  }
  function assignAsset(button, sectionId) {
    const asset = editorState.assets[Number(button.dataset.assetIndex)];
    if (!asset || !sectionId) return;
    const openerSectionId = document.querySelector("#detail-page-image-picker")?.dataset.openerSectionId;
    for (const section of editorState.document.sections) {
      if (section.id !== sectionId && section.image?.url === asset.url) editorState = detailPageEditorReducer(editorState, { type: "remove-image", sectionId: section.id });
    }
    dispatch({ type: "attach-image", sectionId, image: detailPageAssetToImage(asset, sectionId) });
    closeImagePicker(openerSectionId);
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
    builder.invalidate("서버의 최신 버전을 불러와 기존 AI 후보를 닫았습니다.");
    options.onPayload?.(payload, { projectId: editorState.projectId, sessionId: sessionVersion });
    render();
    showToast("서버의 최신 편집본을 불러왔습니다.");
    return "reloaded";
  }

  async function overwriteLatest() {
    const previous = editorState;
    editorState = detailPageEditorReducer(editorState, { type: "overwrite-conflict" });
    if (editorState === previous) return false;
    builder.invalidate("리비전이 바뀌어 기존 AI 후보를 닫았습니다.");
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
    const documentChanged = editorState.document !== previous.document;
    if (editorState.dirty && !previous.dirty || documentChanged) editVersion += 1;
    if (documentChanged && config.invalidateBuilder !== false) builder.invalidate();
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
    const restoreLibraryFocus = Boolean(isBuilderLibraryDrawer() && document.activeElement?.closest?.("#detail-builder-structure"));
    renderDetailPageEditor(container, {
      ...editorState,
      builder: { ...builder.state, evidenceSources: editorState.evidenceSources },
      projectUrl,
      sessionId: sessionVersion,
    });
    syncBuilderLibraryDrawer(restoreLibraryFocus);
    focusRequestedSection();
  }

  function isBuilderLibraryDrawer() {
    return Boolean(builder.state.libraryOpen && globalThis.matchMedia?.("(min-width: 761px) and (max-width: 1179px)")?.matches);
  }

  function closeBuilderLibrary() {
    libraryFocusRequested = false;
    builder.setLibraryOpen(false);
    document.querySelector("[data-action='toggle-builder-library']")?.focus();
  }

  function syncBuilderLibraryDrawer(restoreLibraryFocus = false) {
    const editor = document.querySelector("#detail-page-editor");
    const library = editor?.querySelector("#detail-builder-structure");
    const isDrawer = Boolean(library && isBuilderLibraryDrawer());
    const shouldFocusLibrary = isDrawer && (libraryFocusRequested || restoreLibraryFocus || !libraryDrawerActive);
    document.documentElement?.classList?.toggle("detail-builder-drawer-open", isDrawer);
    for (const node of builderDrawerBackgroundNodes(editor)) node.toggleAttribute("inert", isDrawer);
    if (!library) {
      libraryDrawerActive = false;
      return;
    }
    if (isDrawer) {
      library.setAttribute("role", "dialog");
      library.setAttribute("aria-modal", "true");
      library.setAttribute("aria-labelledby", "detail-builder-library-title");
      if (shouldFocusLibrary) {
        (library.querySelector("[data-action='close-builder-library']") ?? library).focus({ preventScroll: true });
      }
    } else {
      library.removeAttribute("role");
      library.removeAttribute("aria-modal");
      library.removeAttribute("aria-labelledby");
    }
    libraryFocusRequested = false;
    libraryDrawerActive = isDrawer;
  }

  function builderDrawerBackgroundNodes(editor) {
    if (!editor) return [];
    const editPanel = editor.querySelector("#detail-page-edit-panel");
    const workspace = editPanel?.querySelector(":scope > .detail-builder-workspace");
    return [
      ...[...editor.children].filter((node) => node !== editPanel && node.id !== "detail-page-image-picker"),
      editPanel?.querySelector(":scope > .detail-builder-pane-tabs"),
      workspace?.querySelector(":scope > .detail-builder-document"),
      workspace?.querySelector(":scope > .detail-builder-candidate"),
    ].filter(Boolean);
  }

  function focusRequestedSection() {
    if (!editorState.focusSectionId) return;
    const card = [...document.querySelectorAll("[data-editor-section]")].find((node) => node.dataset.sectionId === editorState.focusSectionId);
    card?.querySelector("[data-section-heading]")?.focus();
    editorState = detailPageEditorReducer(editorState, { type: "clear-notice" });
  }

}

function readBuilderProposalChanges(proposal) {
  if (!proposal) return {};
  return {
    heading: proposal.querySelector("[data-builder-proposal-heading]")?.value ?? "",
    body: proposal.querySelector("[data-builder-proposal-body]")?.value ?? "",
    bullets: (proposal.querySelector("[data-builder-proposal-bullets]")?.value ?? "").split("\n").map((item) => item.trim()).filter(Boolean),
    layout: proposal.querySelector("[data-builder-proposal-layout]")?.value ?? "text-only",
  };
}

function readBuilderPatchChange(field) {
  if (field?.hasAttribute("data-builder-patch-heading")) return { heading: field.value ?? "" };
  if (field?.hasAttribute("data-builder-patch-body")) return { body: field.value ?? "" };
  if (field?.hasAttribute("data-builder-patch-bullets")) {
    return { bullets: (field.value ?? "").split("\n").map((item) => item.trim()).filter(Boolean) };
  }
  if (field?.hasAttribute("data-builder-patch-layout")) return { layout: field.value ?? "text-only" };
  return {};
}

function readBuilderEvidenceRefs() {
  return [...document.querySelectorAll("[data-builder-evidence-ref]:checked")]
    .map((input) => input.value)
    .filter(Boolean);
}

async function confirmProjectRecovery(recovery, confirmRecovery) {
  if (typeof confirmRecovery === "function") return Boolean(await confirmRecovery(recovery));
  return Boolean(globalThis.confirm?.("저장된 상세페이지 편집본을 읽을 수 없습니다. 원본 생성 결과로 복구할까요? 손상된 원본은 별도 보관됩니다."));
}
