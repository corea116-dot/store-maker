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
    tabs: [...document.querySelectorAll('#detail-page-editor [role="tab"]')].map((tab) => tab.dataset.editorTab),
    revision: Number(document.querySelector('#detail-page-editor')?.dataset.projectRevision),
    sections: document.querySelectorAll('[data-editor-section]').length
  }))()`);
  assert.match(editorContract.tablist, /편집|미리보기/u);
  assert.deepEqual(editorContract.tabs, ["edit", "preview"]);
  assert.equal(editorContract.revision, 1);
  assert.ok(editorContract.sections >= 2);

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

  const firstSection = "[data-editor-section]:first-of-type";
  await setValue(cdp, `${firstSection} [data-section-heading]`, persistedHeading);
  await setValue(cdp, `${firstSection} [data-section-body]`, "사무실과 집에서 부담 없이 쓰는 조용한 타건감을 소개합니다.");
  await setValue(cdp, `${firstSection} [data-section-layout]`, "split-left");

  const originalSectionCount = editorContract.sections;
  await click(cdp, "[data-action='add-detail-section']");
  await waitFor(cdp, `document.querySelectorAll('[data-editor-section]').length === ${originalSectionCount + 1}`);
  const addedSection = "[data-editor-section][data-section-source='user']";
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
  await evaluate(cdp, "[...document.querySelectorAll('[data-editor-section][data-section-source=\"user\"]')].at(-1)?.querySelector('[data-action=\"delete-detail-section\"]')?.click()");
  await waitFor(cdp, `document.querySelectorAll('[data-editor-section]').length === ${originalSectionCount + 1}`);

  await click(cdp, `${addedSection} [data-action='open-detail-image-picker']`);
  await waitFor(cdp, "!document.querySelector('#detail-page-image-picker')?.classList.contains('is-hidden')");
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

  await setValue(cdp, `${firstSection} [data-section-heading]`, "내 로컬 충돌 제목");
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
  }).then((response) => response.json()))`);
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
  const tablet = await screenshot(cdp, `${evidencePrefix}-detail-editor-768.png`);
  await setViewport(cdp, 375, 900);
  const mobile = await screenshot(cdp, `${evidencePrefix}-detail-editor-375.png`);
  const overflow = await evaluate(cdp, "document.documentElement.scrollWidth > window.innerWidth + 1 || document.querySelector('#detail-page-editor')?.scrollWidth > document.querySelector('#detail-page-editor')?.clientWidth + 1");
  assert.equal(overflow, false);
  await setViewport(cdp, 1280, 900);

  await click(cdp, "[role='tab'][data-editor-tab='preview']");
  await waitFor(cdp, "document.querySelector('[role=\"tab\"][data-editor-tab=\"preview\"]')?.getAttribute('aria-selected') === 'true'");
  await waitFor(cdp, `document.querySelector('#result-preview')?.textContent?.includes(${JSON.stringify(persistedHeading)})`);
  return { persistedHeading, screenshots: [desktop, tablet, mobile] };
}

export async function assertDetailPageEditorRestored(context, evidence) {
  const { cdp, waitFor, value, generationWaitMs } = context;
  await waitFor(cdp, "Boolean(document.querySelector('#detail-page-editor'))", generationWaitMs);
  const restoredHeading = await value(cdp, "[data-editor-section]:first-of-type [data-section-heading]");
  assert.equal(restoredHeading, evidence.persistedHeading);
}
