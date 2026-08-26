import assert from "node:assert/strict";

const persistedHeading = "저소음 키보드, 더 조용하게";

function lines(...values) {
  return values.join("\n");
}

function sectionSelector(sectionId) {
  return "[data-editor-section][data-section-id='" + sectionId + "']";
}

export async function runDetailPageEditorScenario(context) {
  const {
    cdp,
    evidencePrefix,
    generationWaitMs,
    click,
    setValue,
    evaluate,
    text,
    value,
    waitFor,
    setViewport,
    screenshot,
  } = context;

  await waitFor(cdp, "Boolean(document.querySelector('#detail-page-editor'))", generationWaitMs);
  const editorContract = await evaluate(cdp, lines(
    "(() => ({",
    "  shellTitle: document.querySelector('.page-header h1')?.textContent ?? '',",
    "  kicker: document.querySelector('.detail-editor-kicker')?.textContent ?? '',",
    "  helper: document.querySelector('.detail-editor-toolbar p')?.textContent ?? '',",
    "  tabs: [...document.querySelectorAll('#detail-page-editor [role=\"tab\"][data-editor-tab]')].map((tab) => tab.dataset.editorTab),",
    "  revision: Number(document.querySelector('#detail-page-editor')?.dataset.projectRevision),",
    "  sections: document.querySelectorAll('[data-editor-section]').length,",
    "  library: Boolean(document.querySelector('#detail-builder-structure')),",
    "  candidate: Boolean(document.querySelector('#detail-builder-candidate')),",
    "  paneTabs: document.querySelectorAll('[data-builder-pane]').length,",
    "  forbiddenActions: [...document.querySelectorAll('[data-action]')].map((node) => node.dataset.action).filter((action) => ['toggle-builder-library', 'duplicate-detail-section', 'toggle-detail-section', 'delete-detail-section', 'regenerate-detail-section'].includes(action)),",
    "}))()"
  ));
  assert.equal(editorContract.shellTitle, "스토어메이커 상세페이지");
  assert.equal(editorContract.kicker, "상세페이지 편집");
  assert.match(editorContract.helper, /사진|글/u);
  assert.doesNotMatch(editorContract.helper, /마우스|올려/u);
  assert.deepEqual(editorContract.tabs, ["edit", "preview"]);
  assert.equal(editorContract.revision, 1);
  assert.ok(editorContract.sections >= 2);
  assert.equal(editorContract.library, false);
  assert.equal(editorContract.candidate, false);
  assert.equal(editorContract.paneTabs, 0);
  assert.deepEqual(editorContract.forbiddenActions, []);

  const persistedSectionId = await evaluate(cdp, "document.querySelector('[data-editor-section]')?.dataset.sectionId ?? ''");
  assert.ok(persistedSectionId);
  const firstSection = sectionSelector(persistedSectionId);
  await setValue(cdp, firstSection + " [data-section-heading]", persistedHeading);
  await setValue(cdp, firstSection + " [data-section-body]", "사무실과 집에서 부담 없이 쓰는 조용한 타건감을 소개합니다.");
  await setValue(cdp, firstSection + " [data-section-bullets]", "조용한 타건감\n집과 사무실 모두 사용");

  await evaluate(cdp, lines(
    "(() => {",
    "  const tab = document.querySelector('[role=\"tab\"][data-editor-tab=\"edit\"]');",
    "  tab?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));",
    "})()"
  ));
  await waitFor(cdp, "document.querySelector('[role=\"tab\"][data-editor-tab=\"preview\"]')?.getAttribute('aria-selected') === 'true'");
  await evaluate(cdp, lines(
    "(() => {",
    "  const tab = document.querySelector('[role=\"tab\"][data-editor-tab=\"preview\"]');",
    "  tab?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));",
    "})()"
  ));
  await waitFor(cdp, "document.querySelector('[role=\"tab\"][data-editor-tab=\"edit\"]')?.getAttribute('aria-selected') === 'true'");

  const originalSectionCount = await evaluate(cdp, "document.querySelectorAll('[data-editor-section]').length");
  await click(cdp, "[data-action='add-detail-section']");
  await waitFor(cdp, "document.querySelectorAll('[data-editor-section]').length === " + (originalSectionCount + 1));
  const addedSectionId = await evaluate(cdp, "[...document.querySelectorAll('[data-editor-section]')].find((section) => section.querySelector('[data-section-heading]')?.value === '새 내용')?.dataset.sectionId ?? ''");
  assert.ok(addedSectionId);
  const addedSection = sectionSelector(addedSectionId);
  await setValue(cdp, addedSection + " [data-section-heading]", "구매 전 확인");
  await setValue(cdp, addedSection + " [data-section-body]", "사진과 설명을 마지막으로 확인해 보세요.");
  await setValue(cdp, addedSection + " [data-section-bullets]", "색상 선택 확인\n배송 전 옵션 확인");

  await click(cdp, addedSection + " [data-action='open-detail-image-picker']");
  await waitFor(cdp, "!document.querySelector('#detail-page-image-picker')?.classList.contains('is-hidden')");
  const pickerName = await evaluate(cdp, lines(
    "(() => {",
    "  const dialog = document.querySelector('#detail-page-image-picker');",
    "  const title = document.querySelector('#detail-page-image-picker-title');",
    "  return { title: title?.textContent ?? '', labelledBy: dialog?.getAttribute('aria-labelledby') };",
    "})()"
  ));
  assert.match(pickerName.title, /다른 생성 이미지|구매 전 확인/u);
  assert.equal(pickerName.labelledBy, "detail-page-image-picker-title");
  assert.ok(await evaluate(cdp, "document.querySelectorAll('#detail-page-image-picker [data-detail-asset]').length >= 1"));
  await click(cdp, "#detail-page-image-picker [data-detail-asset]:first-of-type");
  await waitFor(cdp, "Boolean(document.querySelector(" + JSON.stringify(addedSection + " [data-editor-image-drag]") + "))");

  const imageContract = await evaluate(cdp, lines(
    "(() => {",
    "  const section = document.querySelector(" + JSON.stringify(addedSection) + ");",
    "  const image = section?.querySelector('[data-editor-image-drag]');",
    "  const menu = section?.querySelector('[data-editor-image-menu]');",
    "  return {",
    "    draggable: image?.draggable ?? false,",
    "    menuActions: [...(menu?.querySelectorAll('[data-action]') ?? [])].map((button) => ({ action: button.dataset.action, label: button.textContent.trim(), name: button.getAttribute('aria-label') })),",
    "    hasLegacyActionRow: Boolean(section?.querySelector('.detail-editor-section-actions')),",
    "    keyboardActions: [...(section?.querySelectorAll('[data-editor-order-actions] [data-action]') ?? [])].map((button) => button.dataset.action),",
    "  };",
    "})()"
  ));
  assert.equal(imageContract.draggable, true);
  assert.deepEqual(imageContract.menuActions.map((item) => item.action), ["edit-detail-image", "remove-detail-image", "open-detail-image-picker"]);
  assert.deepEqual(imageContract.menuActions.map((item) => item.label), ["수정", "제거", "다시 만들기"]);
  assert.ok(imageContract.menuActions.every((item) => item.name?.includes("섹션")));
  assert.equal(imageContract.hasLegacyActionRow, false);
  assert.deepEqual(imageContract.keyboardActions, ["move-detail-section-up", "move-detail-section-down"]);

  await cdp.call("Emulation.setEmulatedMedia", {
    features: [{ name: "hover", value: "none" }, { name: "pointer", value: "coarse" }],
  });
  await waitFor(cdp, "getComputedStyle(document.querySelector(" + JSON.stringify(addedSection + " [data-editor-image-menu]") + ")).opacity === '1'");
  await cdp.call("Emulation.setEmulatedMedia", { features: [] });

  await setViewport(cdp, 1280, 900);
  const imageCenter = await evaluate(cdp, lines(
    "(() => {",
    "  const rect = document.querySelector(" + JSON.stringify(addedSection + " [data-editor-image-drag]") + ")?.getBoundingClientRect();",
    "  return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;",
    "})()"
  ));
  assert.ok(imageCenter);
  await cdp.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: imageCenter.x, y: imageCenter.y });
  await waitFor(cdp, "getComputedStyle(document.querySelector(" + JSON.stringify(addedSection + " [data-editor-image-menu]") + ")).opacity === '1'");
  const imageMenu = await screenshot(cdp, evidencePrefix + "-detail-editor-image-menu-1280.png");

  await evaluate(cdp, lines(
    "(() => {",
    "  const source = document.querySelector(" + JSON.stringify(addedSection + " [data-editor-image-drag]") + ");",
    "  const target = document.querySelector(" + JSON.stringify(firstSection) + ");",
    "  if (!source || !target) throw new Error('drag source or target missing');",
    "  const transfer = new DataTransfer();",
    "  source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));",
    "  const rect = target.getBoundingClientRect();",
    "  target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer, clientY: rect.top + 1 }));",
    "  target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientY: rect.top + 1 }));",
    "  source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }));",
    "})()"
  ));
  await waitFor(cdp, "document.querySelector('[data-editor-section]')?.dataset.sectionId === " + JSON.stringify(addedSectionId));
  assert.deepEqual(await evaluate(cdp, "[...document.querySelectorAll('[data-editor-section]')].slice(0, 2).map((section) => section.dataset.sectionId)"), [addedSectionId, persistedSectionId]);
  const imageDrag = await screenshot(cdp, evidencePrefix + "-detail-editor-image-drag-1280.png");

  await click(cdp, addedSection + " [data-action='remove-detail-image']");
  await waitFor(cdp, "!document.querySelector(" + JSON.stringify(addedSection + " [data-editor-image-drag]") + ")");
  assert.equal(await value(cdp, addedSection + " [data-section-heading]"), "구매 전 확인");
  await click(cdp, addedSection + " [data-action='open-detail-image-picker']");
  await click(cdp, "#detail-page-image-picker [data-detail-asset]:first-of-type");
  await waitFor(cdp, "Boolean(document.querySelector(" + JSON.stringify(addedSection + " [data-editor-image-drag]") + "))");

  await click(cdp, "[data-action='save-detail-page']");
  await waitFor(cdp, "document.querySelector('[data-editor-save-status]')?.dataset.editorSaveStatus === 'saved'", generationWaitMs);
  assert.ok(Number(await value(cdp, "#detail-page-project-revision")) >= 2);

  await evaluate(cdp, lines(
    "fetch(document.querySelector('#detail-page-editor').dataset.projectUrl, {",
    "  headers: { 'x-store-maker-token': document.querySelector('meta[name=\"store-maker-token\"]')?.content ?? '' }",
    "}).then((response) => response.json()).then((payload) => fetch(document.querySelector('#detail-page-editor').dataset.projectUrl, {",
    "  method: 'PUT',",
    "  headers: { 'content-type': 'application/json', 'x-store-maker-token': document.querySelector('meta[name=\"store-maker-token\"]')?.content ?? '' },",
    "  body: JSON.stringify({ expectedRevision: payload.project.revision, document: { ...payload.project.document, title: payload.project.document.title + ' 서버 저장' } })",
    "}).then(async (response) => { if (!response.ok) throw new Error('remote conflict setup failed: ' + response.status); return response.json(); }))"
  ));
  await setValue(cdp, firstSection + " [data-section-heading]", "내 로컬 충돌 제목");
  await click(cdp, "[data-action='save-detail-page']");
  await waitFor(cdp, "document.querySelector('[data-editor-save-status]')?.dataset.editorSaveStatus === 'conflict'", generationWaitMs);
  assert.match(await text(cdp, "[data-editor-conflict]"), /최신|충돌/u);
  const conflict = await screenshot(cdp, evidencePrefix + "-detail-editor-conflict-1280.png");
  await click(cdp, "[data-action='overwrite-latest-detail-page']");
  await waitFor(cdp, "document.querySelector('[data-editor-save-status]')?.dataset.editorSaveStatus === 'saved'", generationWaitMs);
  await setValue(cdp, firstSection + " [data-section-heading]", persistedHeading);
  await click(cdp, "[data-action='save-detail-page']");
  await waitFor(cdp, "document.querySelector('[data-editor-save-status]')?.dataset.editorSaveStatus === 'saved'", generationWaitMs);

  const beforeAutosaveRevision = Number(await value(cdp, "#detail-page-project-revision"));
  await setValue(cdp, firstSection + " [data-section-body]", "자동 저장으로 보존되는 조용한 타건감 소개입니다.");
  await waitFor(cdp, "document.querySelector('[data-editor-save-status]')?.dataset.editorSaveStatus === 'saved' && Number(document.querySelector('#detail-page-project-revision')?.value) > " + beforeAutosaveRevision, generationWaitMs);
  await waitFor(cdp, "!document.querySelector('#toast')?.classList.contains('show')", generationWaitMs);

  await evaluate(cdp, lines(
    "(() => {",
    "  const originalFetch = window.fetch.bind(window);",
    "  window.fetch = (input, init = {}) => {",
    "    if (init.method === 'PUT' && String(input).includes('/api/detail-page-projects/')) {",
    "      return new Promise((resolve, reject) => { window.__releaseDetailModeSave = () => { window.fetch = originalFetch; originalFetch(input, init).then(resolve, reject); }; });",
    "    }",
    "    return originalFetch(input, init);",
    "  };",
    "  const body = document.querySelector('[data-editor-section]:first-of-type [data-section-body]');",
    "  body.value = '모드 전환 중에도 보존되는 편집 내용입니다.';",
    "  body.dispatchEvent(new Event('input', { bubbles: true }));",
    "  const ad = document.querySelector('#generation-mode-ad');",
    "  const detail = document.querySelector('#generation-mode-detail');",
    "  ad.checked = true; ad.dispatchEvent(new Event('change', { bubbles: true }));",
    "  detail.checked = true; detail.dispatchEvent(new Event('change', { bubbles: true }));",
    "})()"
  ));
  await waitFor(cdp, "typeof window.__releaseDetailModeSave === 'function'");
  await evaluate(cdp, "window.__releaseDetailModeSave()");
  await waitFor(cdp, "document.querySelector('[data-editor-save-status]')?.dataset.editorSaveStatus === 'saved'", generationWaitMs);
  assert.deepEqual(await evaluate(cdp, "({ detailChecked: document.querySelector('#generation-mode-detail')?.checked, adChecked: document.querySelector('#generation-mode-ad')?.checked, editorVisible: Boolean(document.querySelector('#detail-page-editor')) })"), { detailChecked: true, adChecked: false, editorVisible: true });

  await setViewport(cdp, 1280, 900);
  const desktop = await screenshot(cdp, evidencePrefix + "-detail-editor-1280.png");
  await setViewport(cdp, 768, 900);
  const tablet = await screenshot(cdp, evidencePrefix + "-detail-editor-768.png");
  await setViewport(cdp, 375, 900);
  await waitFor(cdp, "getComputedStyle(document.querySelector(" + JSON.stringify(addedSection + " [data-editor-image-menu]") + ")).opacity === '1'");
  const mobile = await screenshot(cdp, evidencePrefix + "-detail-editor-375.png");
  assert.equal(await evaluate(cdp, "document.documentElement.scrollWidth > window.innerWidth + 1 || document.querySelector('#detail-page-editor')?.scrollWidth > document.querySelector('#detail-page-editor')?.clientWidth + 1"), false);

  await setViewport(cdp, 1280, 900);
  await click(cdp, "[role='tab'][data-editor-tab='preview']");
  await waitFor(cdp, "document.querySelector('[role=\"tab\"][data-editor-tab=\"preview\"]')?.getAttribute('aria-selected') === 'true'");
  await waitFor(cdp, "document.querySelector('#result-preview')?.textContent?.includes(" + JSON.stringify(persistedHeading) + ")");
  const previewCopyImage = await evaluate(cdp, "(() => { const preview = document.querySelector('#result-preview'); return { copyImages: preview?.querySelectorAll('[data-detail-page-copy-image]').length ?? 0, svgImages: preview?.querySelectorAll('[data-detail-page-copy-image] svg[role=\"img\"]').length ?? 0, legacyHtmlCopy: preview?.querySelectorAll('.detail-page-section-copy').length ?? 0 }; })()");
  assert.ok(previewCopyImage.copyImages > 0);
  assert.equal(previewCopyImage.svgImages, previewCopyImage.copyImages);
  assert.equal(previewCopyImage.legacyHtmlCopy, 0);
  assert.equal(await evaluate(cdp, "document.documentElement.scrollWidth <= window.innerWidth + 1"), true);
  const preview = await screenshot(cdp, evidencePrefix + "-detail-preview-1280.png");
  return { persistedHeading, persistedSectionId, screenshots: [desktop, imageMenu, imageDrag, conflict, tablet, mobile, preview] };
}

export async function assertDetailPageEditorRestored(context, evidence) {
  const { cdp, waitFor, value, generationWaitMs } = context;
  await waitFor(cdp, "Boolean(document.querySelector('#detail-page-editor'))", generationWaitMs);
  const restoredHeading = await value(cdp, sectionSelector(evidence.persistedSectionId) + " [data-section-heading]");
  assert.equal(restoredHeading, evidence.persistedHeading);
}
