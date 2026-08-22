import assert from "node:assert/strict";

const persistedHeading = "저소음 키보드, 더 조용하게";

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
  const editorContract = await evaluate(cdp, `(() => ({
    tablist: document.querySelector('#detail-page-editor [role="tablist"]')?.getAttribute('aria-label'),
    tabs: [...document.querySelectorAll('#detail-page-editor [role="tab"][data-editor-tab]')].map((tab) => tab.dataset.editorTab),
    revision: Number(document.querySelector('#detail-page-editor')?.dataset.projectRevision),
    sections: document.querySelectorAll('[data-editor-section]').length
  }))()`);
  assert.match(editorContract.tablist, /편집|미리보기/u);
  assert.deepEqual(editorContract.tabs, ["edit", "preview"]);
  assert.equal(editorContract.revision, 1);
  assert.ok(editorContract.sections >= 2);
  const persistedSectionId = await evaluate(cdp, "document.querySelector('[data-editor-section]')?.dataset.sectionId ?? ''");
  assert.ok(persistedSectionId);

  const builderContract = await evaluate(cdp, `(() => ({
    panels: [...document.querySelectorAll('#detail-page-editor [data-builder-pane-panel]')].map((panel) => panel.dataset.builderPanePanel),
    directTypes: [...document.querySelectorAll('[data-builder-type]')].map((button) => button.dataset.builderType),
    hasLibraryTrigger: Boolean(document.querySelector('[data-action="toggle-builder-library"]')),
    dragHandles: [...document.querySelectorAll('[data-editor-drag-handle]')].every((handle) => handle.draggable)
  }))()`);
  assert.deepEqual(builderContract.panels, ["structure", "edit", "candidate"]);
  assert.equal(builderContract.directTypes.length, 19);
  assert.ok(builderContract.directTypes.includes("steps"));
  assert.ok(builderContract.directTypes.includes("media"));
  assert.equal(builderContract.hasLibraryTrigger, true);
  assert.equal(builderContract.dragHandles, true);

  const serverRevision = () => evaluate(cdp, `(async () => {
    const editor = document.querySelector('#detail-page-editor');
    const token = document.querySelector('meta[name="store-maker-token"]')?.content ?? '';
    const response = await fetch(editor.dataset.projectUrl, { headers: { 'x-store-maker-token': token } });
    return (await response.json()).project.revision;
  })()`);
  const revisionBeforeCandidates = await serverRevision();

  await click(cdp, "[data-builder-type='reviews']");
  await waitFor(cdp, "document.querySelector('[data-builder-status]')?.dataset.builderStatus === 'ready'", generationWaitMs);
  const reviewCandidate = await evaluate(cdp, `(() => ({
    applyDisabled: document.querySelector('[data-action="apply-builder-candidate"]')?.disabled,
    warning: document.querySelector('.detail-builder-evidence')?.textContent ?? ''
  }))()`);
  assert.equal(reviewCandidate.applyDisabled, true);
  assert.match(reviewCandidate.warning, /후기|확인/u);
  assert.equal(await serverRevision(), revisionBeforeCandidates);
  assert.equal(await serverRevision(), revisionBeforeCandidates);
  await click(cdp, "[data-action='discard-builder-candidate']");
  await waitFor(cdp, "!document.querySelector('[data-action=\"discard-builder-candidate\"]')");

  await click(cdp, "[data-builder-type='faq']");
  await waitFor(cdp, "document.querySelector('[data-builder-status]')?.dataset.builderStatus === 'ready'", generationWaitMs);
  assert.equal(await serverRevision(), revisionBeforeCandidates);
  await setValue(cdp, "[data-builder-proposal-heading]", "판매자 검토 FAQ");
  const beforeCandidateApply = await evaluate(cdp, "[...document.querySelectorAll('[data-editor-section] [data-section-heading]')].map((input) => input.value)");
  assert.equal(beforeCandidateApply.includes("판매자 검토 FAQ"), false);
  await click(cdp, "[data-action='apply-builder-candidate']");
  await waitFor(cdp, `document.querySelectorAll('[data-editor-section]').length === ${editorContract.sections + 1}`);
  await waitFor(cdp, "document.querySelector('[data-editor-save-status]')?.dataset.editorSaveStatus === 'saved'", generationWaitMs);
  const appliedCandidateHeading = await evaluate(cdp, "[...document.querySelectorAll('[data-editor-section] [data-section-heading]')].map((input) => input.value)");
  assert.ok(appliedCandidateHeading.includes("판매자 검토 FAQ"));

  const actionNames = await evaluate(cdp, `(() => [...document.querySelectorAll('[data-editor-section]')].map((section, index) => ({
    position: index + 1,
    heading: section.querySelector('[data-section-heading]')?.value ?? '',
    actions: [...section.querySelectorAll('[data-action]')].filter((button) => button.dataset.action !== 'close-detail-image-picker').map((button) => ({
      action: button.dataset.action,
      name: button.getAttribute('aria-label')
    }))
  })))()`);
  for (const section of actionNames) {
    for (const action of section.actions) {
      assert.ok(action.name?.includes(`섹션 ${section.position}`), `${action.action} must identify section ${section.position}`);
    }
  }

  await evaluate(cdp, `(() => {
    const tab = document.querySelector('[role="tab"][data-editor-tab="edit"]');
    tab?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  })()`);
  await waitFor(cdp, "document.querySelector('[role=\"tab\"][data-editor-tab=\"preview\"]')?.getAttribute('aria-selected') === 'true'");
  await evaluate(cdp, `(() => {
    const tab = document.querySelector('[role="tab"][data-editor-tab="preview"]');
    tab?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  })()`);
  await waitFor(cdp, "document.querySelector('[role=\"tab\"][data-editor-tab=\"edit\"]')?.getAttribute('aria-selected') === 'true'");

  const firstSection = `[data-editor-section][data-section-id='${persistedSectionId}']`;
  await setValue(cdp, `${firstSection} [data-section-heading]`, persistedHeading);
  await setValue(cdp, `${firstSection} [data-section-body]`, "사무실과 집에서 부담 없이 쓰는 조용한 타건감을 소개합니다.");
  await setValue(cdp, `${firstSection} [data-section-layout]`, "split-left");

  const originalSectionCount = await evaluate(cdp, "document.querySelectorAll('[data-editor-section]').length");
  await click(cdp, "[data-action='add-detail-section']");
  await waitFor(cdp, `document.querySelectorAll('[data-editor-section]').length === ${originalSectionCount + 1}`);
  const addedSectionId = await evaluate(cdp, "[...document.querySelectorAll('[data-editor-section]')].find((section) => section.querySelector('[data-section-heading]')?.value === '새 섹션')?.dataset.sectionId ?? ''");
  assert.ok(addedSectionId);
  const addedSection = `[data-editor-section][data-section-id='${addedSectionId}']`;
  await setValue(cdp, `${addedSection} [data-section-heading]`, "구매 전 확인");
  await setValue(cdp, `${addedSection} [data-section-body]`, "KC 인증번호와 A/S 조건을 마지막으로 확인하세요.");
  await setValue(cdp, `${addedSection} [data-section-bullets]`, "KC 인증번호 ABC-123\n1년 무상 A/S");
  await click(cdp, `${addedSection} [data-action='move-detail-section-up']`);
  await waitFor(cdp, "document.querySelector('[data-editor-announcement]')?.textContent?.includes('이동')");
  await click(cdp, `${addedSection} [data-action='toggle-detail-section']`);
  await waitFor(cdp, `${JSON.stringify(addedSection)} && document.querySelector(${JSON.stringify(addedSection)})?.classList.contains('is-hidden-section')`);
  await click(cdp, `${addedSection} [data-action='toggle-detail-section']`);
  await waitFor(cdp, `!document.querySelector(${JSON.stringify(addedSection)})?.classList.contains('is-hidden-section')`);

  await click(cdp, "[data-action='add-detail-section']");
  await waitFor(cdp, `document.querySelectorAll('[data-editor-section]').length === ${originalSectionCount + 2}`);
  await evaluate(cdp, "[...document.querySelectorAll('[data-editor-section]')].find((section) => section.querySelector('[data-section-heading]')?.value === '새 섹션')?.querySelector('[data-action=\"delete-detail-section\"]')?.click()");
  await waitFor(cdp, `document.querySelectorAll('[data-editor-section]').length === ${originalSectionCount + 1}`);

  await click(cdp, `${addedSection} [data-action='open-detail-image-picker']`);
  await waitFor(cdp, "!document.querySelector('#detail-page-image-picker')?.classList.contains('is-hidden')");
  const pickerName = await evaluate(cdp, `(() => {
    const dialog = document.querySelector('#detail-page-image-picker');
    const title = document.querySelector('#detail-page-image-picker-title');
    return { title: title?.textContent ?? '', labelledBy: dialog?.getAttribute('aria-labelledby'), name: title?.textContent ?? '' };
  })()`);
  assert.match(pickerName.title, /구매 전 확인/u);
  assert.equal(pickerName.labelledBy, "detail-page-image-picker-title");
  assert.match(pickerName.name, /구매 전 확인/u);
  const focusTrap = await evaluate(cdp, `(() => {
    const picker = document.querySelector('#detail-page-image-picker');
    const buttons = [...picker.querySelectorAll('button:not([disabled])')];
    buttons.at(-1).focus();
    buttons.at(-1).dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    const forward = document.activeElement?.dataset.action;
    buttons[0].focus();
    buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    return { forward, backwardIsAsset: document.activeElement?.hasAttribute('data-detail-asset') };
  })()`);
  assert.equal(focusTrap.forward, "close-detail-image-picker");
  assert.equal(focusTrap.backwardIsAsset, true);
  const assetCount = await evaluate(cdp, "document.querySelectorAll('#detail-page-image-picker [data-detail-asset]').length");
  assert.ok(assetCount >= 1);
  await click(cdp, "#detail-page-image-picker [data-detail-asset]:first-of-type");
  await waitFor(cdp, `Boolean(document.querySelector(${JSON.stringify(`${addedSection} [data-section-image]`)}))`);
  await click(cdp, `${addedSection} [data-action='remove-detail-image']`);
  await waitFor(cdp, `!document.querySelector(${JSON.stringify(`${addedSection} [data-section-image]`)})`);
  await click(cdp, `${addedSection} [data-action='open-detail-image-picker']`);
  await click(cdp, "#detail-page-image-picker [data-detail-asset]:first-of-type");
  await waitFor(cdp, `Boolean(document.querySelector(${JSON.stringify(`${addedSection} [data-section-image]`)}))`);

  await click(cdp, "[data-action='save-detail-page']");
  await waitFor(cdp, "document.querySelector('[data-editor-save-status]')?.dataset.editorSaveStatus === 'saved'", generationWaitMs);
  const savedRevision = Number(await value(cdp, "#detail-page-project-revision"));
  assert.ok(savedRevision >= 2);

  await setValue(cdp, "[data-builder-regenerate-instruction]", "짧고 명확하게 구매 결정을 돕는 문장으로 바꿔 주세요.");
  await setValue(cdp, `${firstSection} [data-builder-regenerate-mode]`, "copy");
  await click(cdp, `${firstSection} [data-action='regenerate-detail-section']`);
  await waitFor(cdp, "document.querySelector('[data-builder-status]')?.dataset.builderStatus === 'ready' && Boolean(document.querySelector('[data-builder-patch-heading]'))", generationWaitMs);
  assert.equal(await value(cdp, "[data-builder-patch-heading]"), "AI가 다듬은 핵심 제목");
  const headingBeforePatchApply = await evaluate(cdp, `(async () => {
    const editor = document.querySelector('#detail-page-editor');
    const token = document.querySelector('meta[name="store-maker-token"]')?.content ?? '';
    const response = await fetch(editor.dataset.projectUrl, { headers: { 'x-store-maker-token': token } });
    return (await response.json()).project.document.sections.find((section) => section.id === ${JSON.stringify(persistedSectionId)})?.heading ?? '';
  })()`);
  assert.equal(headingBeforePatchApply, persistedHeading);
  await setValue(cdp, "[data-builder-patch-heading]", "AI 후보를 검토한 제목");
  await click(cdp, "[data-action='apply-builder-candidate']");
  await waitFor(cdp, `document.querySelector(${JSON.stringify(`${firstSection} [data-section-heading]`)})?.value === 'AI 후보를 검토한 제목'`);
  await waitFor(cdp, "document.querySelector('[data-editor-save-status]')?.dataset.editorSaveStatus === 'saved'", generationWaitMs);

  await evaluate(cdp, `fetch(document.querySelector('#detail-page-editor').dataset.projectUrl, {
    headers: { 'x-store-maker-token': document.querySelector('meta[name="store-maker-token"]')?.content ?? '' }
  }).then((response) => response.json()).then((payload) => fetch(document.querySelector('#detail-page-editor').dataset.projectUrl, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'x-store-maker-token': document.querySelector('meta[name="store-maker-token"]')?.content ?? ''
    },
    body: JSON.stringify({
      expectedRevision: payload.project.revision,
      document: { ...payload.project.document, title: payload.project.document.title + ' 서버 저장' }
    })
  }).then(async (response) => {
    if (!response.ok) throw new Error("remote conflict setup failed: " + response.status);
    return response.json();
  }))`);
  await setValue(cdp, `${firstSection} [data-section-heading]`, "내 로컬 충돌 제목");
  await click(cdp, "[data-action='save-detail-page']");
  await waitFor(cdp, "document.querySelector('[data-editor-save-status]')?.dataset.editorSaveStatus === 'conflict'", generationWaitMs);
  const conflictText = await text(cdp, "[data-editor-conflict]");
  assert.match(conflictText, /최신|충돌/u);
  await screenshot(cdp, `${evidencePrefix}-detail-editor-conflict-1280.png`);
  assert.equal(await evaluate(cdp, "Boolean(document.querySelector('[data-action=\"copy-local-detail-page\"]'))"), true);
  assert.equal(await evaluate(cdp, "Boolean(document.querySelector('[data-action=\"overwrite-latest-detail-page\"]'))"), true);
  await click(cdp, "[data-action='overwrite-latest-detail-page']");
  await waitFor(cdp, "document.querySelector('[data-editor-save-status]')?.dataset.editorSaveStatus === 'saved'", generationWaitMs);
  assert.equal(await value(cdp, `${firstSection} [data-section-heading]`), "내 로컬 충돌 제목");
  await setValue(cdp, `${firstSection} [data-section-heading]`, persistedHeading);
  await click(cdp, "[data-action='save-detail-page']");
  await waitFor(cdp, "document.querySelector('[data-editor-save-status]')?.dataset.editorSaveStatus === 'saved'", generationWaitMs);

  const beforeAutosaveRevision = Number(await value(cdp, "#detail-page-project-revision"));
  await setValue(cdp, `${firstSection} [data-section-body]`, "자동 저장으로 보존되는 조용한 타건감 소개입니다.");
  await waitFor(cdp, `document.querySelector('[data-editor-save-status]')?.dataset.editorSaveStatus === 'saved' && Number(document.querySelector('#detail-page-project-revision')?.value) > ${beforeAutosaveRevision}`, generationWaitMs);
  await waitFor(cdp, "!document.querySelector('#toast')?.classList.contains('show')", generationWaitMs);

  await evaluate(cdp, `(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
      if (init.method === 'PUT' && String(input).includes('/api/detail-page-projects/')) {
        return new Promise((resolve, reject) => {
          window.__releaseDetailModeSave = () => {
            window.fetch = originalFetch;
            originalFetch(input, init).then(resolve, reject);
          };
        });
      }
      return originalFetch(input, init);
    };
    const body = document.querySelector('[data-editor-section]:first-of-type [data-section-body]');
    body.value = '모드 전환 중에도 보존되는 편집 내용입니다.';
    body.dispatchEvent(new Event('input', { bubbles: true }));
    const ad = document.querySelector('#generation-mode-ad');
    const detail = document.querySelector('#generation-mode-detail');
    ad.checked = true;
    ad.dispatchEvent(new Event('change', { bubbles: true }));
    detail.checked = true;
    detail.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor(cdp, "typeof window.__releaseDetailModeSave === 'function'");
  await evaluate(cdp, "window.__releaseDetailModeSave()");
  await waitFor(cdp, "document.querySelector('[data-editor-save-status]')?.dataset.editorSaveStatus === 'saved'", generationWaitMs);
  const modeAfterRapidSelection = await evaluate(cdp, `({
    detailChecked: document.querySelector('#generation-mode-detail')?.checked,
    adChecked: document.querySelector('#generation-mode-ad')?.checked,
    editorVisible: Boolean(document.querySelector('#detail-page-editor'))
  })`);
  assert.deepEqual(modeAfterRapidSelection, { detailChecked: true, adChecked: false, editorVisible: true });

  await setViewport(cdp, 1280, 900);
  const desktop = await screenshot(cdp, `${evidencePrefix}-detail-editor-1280.png`);
  await setViewport(cdp, 768, 900);
  await click(cdp, "[data-action='toggle-builder-library']");
  await waitFor(cdp, "Boolean(document.querySelector('.detail-builder-library-backdrop')) && document.querySelector('.detail-builder-workspace')?.classList.contains('is-library-open')");
  const tabletDrawer = await evaluate(cdp, `(() => {
    const library = document.querySelector('.detail-builder-library');
    const backdrop = document.querySelector('.detail-builder-library-backdrop');
    const focusable = [...library.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((node) => node.getClientRects().length > 0);
    const initialFocus = document.activeElement?.dataset.action;
    const first = focusable[0];
    const last = focusable.at(-1);
    const typeLabelLineCounts = [...library.querySelectorAll('.detail-builder-type-grid .btn')].map((button) => {
      const range = document.createRange();
      range.selectNodeContents(button);
      return new Set([...range.getClientRects()].filter((rect) => rect.width > 0).map((rect) => Math.round(rect.top))).size;
    });
    last.focus();
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    const forwardFocus = document.activeElement?.dataset.action;
    first.focus();
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    const backwardFocusIsLast = document.activeElement === last;
    return {
      position: getComputedStyle(library).position,
      width: library.getBoundingClientRect().width,
      backdropVisible: getComputedStyle(backdrop).display !== 'none',
      role: library.getAttribute('role'),
      modal: library.getAttribute('aria-modal'),
      initialFocus,
      forwardFocus,
      backwardFocusIsLast,
      backgroundInert: ['.detail-editor-toolbar', '.detail-editor-status-row', '.detail-builder-pane-tabs', '.detail-builder-document', '.detail-builder-candidate'].every((selector) => document.querySelector(selector)?.inert === true),
      pageScrollLocked: document.documentElement.classList.contains('detail-builder-drawer-open'),
      typeColumnCount: new Set([...library.querySelectorAll('.detail-builder-type-grid .btn')].map((button) => Math.round(button.getBoundingClientRect().left))).size,
      typeLabelsStayOnOneLine: typeLabelLineCounts.every((count) => count === 1),
    };
  })()`);
  assert.equal(tabletDrawer.position, "fixed");
  assert.ok(tabletDrawer.width > 0);
  assert.equal(tabletDrawer.backdropVisible, true);
  assert.equal(tabletDrawer.role, "dialog");
  assert.equal(tabletDrawer.modal, "true");
  assert.equal(tabletDrawer.initialFocus, "close-builder-library");
  assert.equal(tabletDrawer.forwardFocus, "close-builder-library");
  assert.equal(tabletDrawer.backwardFocusIsLast, true);
  assert.equal(tabletDrawer.backgroundInert, true);
  assert.equal(tabletDrawer.pageScrollLocked, true);
  assert.equal(tabletDrawer.typeColumnCount, 1);
  assert.equal(tabletDrawer.typeLabelsStayOnOneLine, true);
  await setViewport(cdp, 1280, 900);
  await evaluate(cdp, "window.dispatchEvent(new Event('resize'))");
  await waitFor(cdp, "getComputedStyle(document.querySelector('.detail-builder-library-close')).display === 'none'");
  const desktopDrawerExit = await evaluate(cdp, "({ focusAction: document.activeElement?.dataset.action, activeInsideLibrary: Boolean(document.activeElement?.closest?.('#detail-builder-structure')) })");
  assert.deepEqual(desktopDrawerExit, { focusAction: "toggle-builder-library", activeInsideLibrary: false });
  await setViewport(cdp, 768, 900);
  await waitFor(cdp, "document.querySelector('.detail-builder-library')?.getAttribute('role') === 'dialog'");
  assert.equal(await evaluate(cdp, "document.activeElement?.dataset.action"), "close-builder-library");
  await setViewport(cdp, 375, 900);
  await evaluate(cdp, "window.dispatchEvent(new Event('resize'))");
  await waitFor(cdp, "getComputedStyle(document.querySelector('.detail-builder-library-close')).display === 'none'");
  const mobileDrawerExit = await evaluate(cdp, "({ focusAction: document.activeElement?.dataset.action, activeInsideLibrary: Boolean(document.activeElement?.closest?.('#detail-builder-structure')) })");
  assert.deepEqual(mobileDrawerExit, { focusAction: "toggle-builder-library", activeInsideLibrary: false });
  await setViewport(cdp, 768, 900);
  await waitFor(cdp, "document.querySelector('.detail-builder-library')?.getAttribute('role') === 'dialog'");
  assert.equal(await evaluate(cdp, "document.activeElement?.dataset.action"), "close-builder-library");
  const tablet = await screenshot(cdp, `${evidencePrefix}-detail-editor-768.png`);
  await click(cdp, ".detail-builder-library-backdrop");
  await waitFor(cdp, "!document.querySelector('.detail-builder-library-backdrop')");
  assert.equal(await evaluate(cdp, "document.activeElement?.dataset.action"), "toggle-builder-library");
  assert.equal(await evaluate(cdp, "document.querySelector('.detail-builder-document')?.inert === false && !document.documentElement.classList.contains('detail-builder-drawer-open')"), true);
  await setViewport(cdp, 375, 900);
  await click(cdp, "[data-builder-pane='edit']");
  await waitFor(cdp, "document.querySelector('.detail-builder-workspace')?.dataset.builderActivePane === 'edit'");
  const mobile = await screenshot(cdp, `${evidencePrefix}-detail-editor-375.png`);
  const overflow = await evaluate(cdp, "document.documentElement.scrollWidth > window.innerWidth + 1 || document.querySelector('#detail-page-editor')?.scrollWidth > document.querySelector('#detail-page-editor')?.clientWidth + 1");
  assert.equal(overflow, false);
  const mobileBodyFontSizes = await evaluate(cdp, `(() => {
    const sizes = {};
    for (const selector of [
      '.detail-editor-toolbar p',
      '.detail-editor-save-status',
      '.detail-editor-visibility',
      '.detail-editor-fields label',
      '.detail-editor-fields input',
      '.detail-editor-empty-image span'
    ]) {
      const element = document.querySelector(selector);
      sizes[selector] = element ? Number.parseFloat(getComputedStyle(element).fontSize) : null;
    }
    const mobileAction = document.querySelector('[data-mobile-label]');
    sizes['[data-mobile-label]::after'] = mobileAction
      ? Number.parseFloat(getComputedStyle(mobileAction, '::after').fontSize)
      : null;
    return sizes;
  })()`);
  for (const [selector, fontSize] of Object.entries(mobileBodyFontSizes)) {
    assert.ok(fontSize >= 14, `${selector} must remain at least 14px on mobile; received ${fontSize}`);
  }
  await setViewport(cdp, 1280, 900);

  await click(cdp, "[role='tab'][data-editor-tab='preview']");
  await waitFor(cdp, "document.querySelector('[role=\"tab\"][data-editor-tab=\"preview\"]')?.getAttribute('aria-selected') === 'true'");
  await waitFor(cdp, `document.querySelector('#result-preview')?.textContent?.includes(${JSON.stringify(persistedHeading)})`);
  const previewCopyImage = await evaluate(cdp, `(() => {
    const preview = document.querySelector('#result-preview');
    return {
      copyImages: preview?.querySelectorAll('[data-detail-page-copy-image]').length ?? 0,
      svgImages: preview?.querySelectorAll('[data-detail-page-copy-image] svg[role="img"]').length ?? 0,
      legacyHtmlCopy: preview?.querySelectorAll('.detail-page-section-copy').length ?? 0,
    };
  })()`);
  assert.ok(previewCopyImage.copyImages > 0);
  assert.equal(previewCopyImage.svgImages, previewCopyImage.copyImages);
  assert.equal(previewCopyImage.legacyHtmlCopy, 0);
  assert.equal(await evaluate(cdp, "document.documentElement.scrollWidth <= window.innerWidth + 1"), true);
  const preview = await screenshot(cdp, `${evidencePrefix}-detail-preview-1280.png`);
  return { persistedHeading, persistedSectionId, screenshots: [desktop, tablet, mobile, preview] };
}

export async function assertDetailPageEditorRestored(context, evidence) {
  const { cdp, waitFor, value, generationWaitMs } = context;
  await waitFor(cdp, "Boolean(document.querySelector('#detail-page-editor'))", generationWaitMs);
  const restoredHeading = await value(cdp, `[data-editor-section][data-section-id='${evidence.persistedSectionId}'] [data-section-heading]`);
  assert.equal(restoredHeading, evidence.persistedHeading);
}
