import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:4317";
const evidenceDir = new URL("../.omx/logs/", import.meta.url);
const evidencePrefix = process.env.STORE_MAKER_EVIDENCE_PREFIX ?? "browser-e2e";
const chromePath = await resolveChromePath();
const debugPort = 9322 + Math.floor(Math.random() * 200);
const userDataDir = join(tmpdir(), `store-maker-chrome-${process.pid}`);
const fixtureDir = join(tmpdir(), `store-maker-fixtures-${process.pid}`);
const tinyPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const imagegenCommand = process.env.STORE_MAKER_IMAGEGEN_COMMAND ?? "./scripts/fake-codex-imagegen.mjs";
const imagegenTimeoutMs = process.env.STORE_MAKER_IMAGEGEN_TIMEOUT_MS ?? "2000";
const generationWaitMs = Number.parseInt(process.env.STORE_MAKER_GENERATION_WAIT_MS ?? "15000", 10);
const realImagegenRun = Boolean(process.env.STORE_MAKER_IMAGEGEN_COMMAND);
let currentViewport = { width: 1280, height: 900 };

await mkdir(evidenceDir, { recursive: true });
await mkdir(fixtureDir, { recursive: true });
await writeFile(join(fixtureDir, "button-photo.png"), Buffer.from(tinyPngBase64, "base64"));
await writeFile(join(fixtureDir, "remove-photo.png"), Buffer.from(tinyPngBase64, "base64"));
await writeFile(join(fixtureDir, "battery-spec.pdf"), "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");
await writeFile(join(fixtureDir, "material-notes.txt"), "배터리 24개월 사용 가능\n저소음 키캡 촬영 컷 필요\n");

const chrome = spawn(chromePath, [
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${userDataDir}`,
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "about:blank",
], { stdio: "ignore" });

try {
  const wsUrl = await waitForWebSocketUrl(debugPort);
  const cdp = await connectCdp(wsUrl);
  await cdp.call("Page.enable");
  await cdp.call("Runtime.enable");
  await setViewport(cdp, 1280, 900);
  await cdp.call("Page.navigate", { url: baseUrl });
  await waitFor(cdp, "document.readyState === 'complete'");
  await evaluate(cdp, "window.sessionStorage.setItem('store-maker.ephemeralJobs', '1')");

  const settingsButtonExists = await evaluate(cdp, "Boolean(document.querySelector('[data-action=\"open-settings\"]'))");
  const enginePanelVisibleOnMain = await evaluate(cdp, "Boolean(document.querySelector('main #engines'))");
  const materialsTextareaExists = await evaluate(cdp, "Boolean(document.querySelector('#materials'))");
  const productDropzoneExists = await evaluate(cdp, "Boolean(document.querySelector('#product-image-dropzone'))");
  const referenceDropzoneExists = await evaluate(cdp, "Boolean(document.querySelector('#reference-image-dropzone'))");
  const supportingDropzoneExists = await evaluate(cdp, "Boolean(document.querySelector('#supporting-material-dropzone'))");
  const moodModeExists = await evaluate(cdp, "Boolean(document.querySelector('#image-mood-mode'))");
  const sameMoodInputExists = await evaluate(cdp, "Boolean(document.querySelector('#image-same-mood-count'))");
  const variedMoodInputExists = await evaluate(cdp, "Boolean(document.querySelector('#image-varied-mood-count'))");
  const productUploadButtonText = await text(cdp, "[data-action='upload-product-images']");
  const referenceUploadButtonText = await text(cdp, "[data-action='upload-reference-images']");
  const uploadGuidanceLayout = await evaluate(cdp, `(() => {
    const readRole = (panelSelector, dropzoneSelector) => {
      const panel = document.querySelector(panelSelector);
      const instruction = panel?.querySelector('.dropzone-instruction');
      const dropzone = document.querySelector(dropzoneSelector);
      const format = panel?.querySelector('.dropzone-format');
      const instructionRect = instruction?.getBoundingClientRect();
      const dropzoneRect = dropzone?.getBoundingClientRect();
      const formatRect = format?.getBoundingClientRect();
      const uploadText = dropzone?.querySelector('.dropzone-upload-action')?.textContent?.trim() ?? '';
      const isInside = (childRect, parentRect) => Boolean(childRect && parentRect
        && childRect.top >= parentRect.top - 1
        && childRect.bottom <= parentRect.bottom + 1
        && childRect.left >= parentRect.left - 1
        && childRect.right <= parentRect.right + 1);
      return {
        instructionText: instruction?.textContent?.trim() ?? '',
        dropzoneText: dropzone?.textContent?.trim() ?? '',
        uploadText,
        formatText: format?.textContent?.trim() ?? '',
        dropzoneHeight: dropzoneRect?.height ?? 0,
        instructionInside: isInside(instructionRect, dropzoneRect),
        formatInside: isInside(formatRect, dropzoneRect)
      };
    };
    return {
      product: readRole('[aria-labelledby="product-image-title"]', '#product-image-dropzone'),
      reference: readRole('[aria-labelledby="reference-image-title"]', '#reference-image-dropzone')
    };
  })()`);
  const defaultImageStatusText = await text(cdp, "#image-generation-main-status");
  const defaultHistoryPageSize = await value(cdp, "#job-history-page-size");
  const defaultLogPageSize = await value(cdp, "#log-page-size");
  const historySearchExists = await evaluate(cdp, "Boolean(document.querySelector('#job-history-search'))");
  const historyPageNavExists = await evaluate(cdp, "Boolean(document.querySelector('#job-history-pages'))");
  const historyPanelMarkerRemoved = await evaluate(cdp, "getComputedStyle(document.querySelector('.job-history-panel'), '::after').content === 'none'");
  const adMoodOptionValues = await evaluate(cdp, "[...document.querySelectorAll('#ad-mood-preset option')].map((option) => option.value)");
  const initialProductFields = await evaluate(cdp, `(() => ({
    nameValue: document.querySelector('#product-name')?.value ?? '',
    namePlaceholder: document.querySelector('#product-name')?.getAttribute('placeholder') ?? '',
    descriptionValue: document.querySelector('#product-description')?.value ?? '',
    descriptionPlaceholder: document.querySelector('#product-description')?.getAttribute('placeholder') ?? '',
    requirementsValue: document.querySelector('#product-requirements')?.value ?? '',
    requirementsPlaceholder: document.querySelector('#product-requirements')?.getAttribute('placeholder') ?? '',
    markets: [...document.querySelectorAll('input[name="market"]')].map((input) => input.value)
  }))()`);
  const headerIntroText = await text(cdp, ".page-header p");
  const adOptionsIntroText = await text(cdp, "#ad-options-panel .section-head p");
  const logsStartBelowPreview = await evaluate(cdp, "document.querySelector('#logs')?.getBoundingClientRect().top >= document.querySelector('#preview')?.getBoundingClientRect().bottom - 1");
  const exportPanelHiddenByDefault = await evaluate(cdp, "document.querySelector('#export-panel')?.classList?.contains('is-hidden')");
  const exportPanelToggleDisabledByDefault = await evaluate(cdp, "document.querySelector('[data-action=\"toggle-export-panel\"]')?.disabled");
  assert.equal(settingsButtonExists, true);
  assert.equal(enginePanelVisibleOnMain, false);
  assert.equal(materialsTextareaExists, false);
  assert.equal(productDropzoneExists, true);
  assert.equal(referenceDropzoneExists, true);
  assert.equal(supportingDropzoneExists, true);
  assert.equal(moodModeExists, true);
  assert.equal(sameMoodInputExists, true);
  assert.equal(variedMoodInputExists, true);
  assert.match(productUploadButtonText, /상품 이미지 업로드/);
  assert.match(referenceUploadButtonText, /레퍼런스 업로드/);
  assert.match(uploadGuidanceLayout.product.instructionText, /상품 이미지를 여기에 드래그앤드랍/u);
  assert.match(uploadGuidanceLayout.product.dropzoneText, /상품 이미지 업로드/u);
  assert.equal(uploadGuidanceLayout.product.uploadText, "상품 이미지 업로드");
  assert.match(uploadGuidanceLayout.product.formatText, /png, jpeg/u);
  assert.equal(uploadGuidanceLayout.product.instructionInside, true);
  assert.equal(uploadGuidanceLayout.product.formatInside, true);
  assert.match(uploadGuidanceLayout.reference.instructionText, /참고 이미지를 드래그앤드랍/u);
  assert.match(uploadGuidanceLayout.reference.dropzoneText, /레퍼런스 업로드/u);
  assert.equal(uploadGuidanceLayout.reference.uploadText, "레퍼런스 업로드");
  assert.match(uploadGuidanceLayout.reference.formatText, /png, jpeg/u);
  assert.equal(uploadGuidanceLayout.reference.instructionInside, true);
  assert.equal(uploadGuidanceLayout.reference.formatInside, true);
  assert.ok(Math.abs(uploadGuidanceLayout.product.dropzoneHeight - uploadGuidanceLayout.reference.dropzoneHeight) <= 1);
  assert.match(defaultImageStatusText, /켜짐/u);
  assert.equal(defaultHistoryPageSize, "5");
  assert.equal(defaultLogPageSize, "10");
  assert.equal(historySearchExists, true);
  assert.equal(historyPageNavExists, true);
  assert.equal(historyPanelMarkerRemoved, true);
  assert.deepEqual(adMoodOptionValues, ["clean", "bold", "editorial", "premium", "warm", "fresh", "minimal", "energetic", "technical", "gift", "seasonal"]);
  assert.equal(initialProductFields.nameValue, "");
  assert.equal(initialProductFields.descriptionValue, "");
  assert.equal(initialProductFields.requirementsValue, "");
  assert.match(initialProductFields.namePlaceholder, /^예:/u);
  assert.match(initialProductFields.descriptionPlaceholder, /^예:/u);
  assert.match(initialProductFields.requirementsPlaceholder, /^예:/u);
  assert.deepEqual(initialProductFields.markets, ["smartstore", "coupang"]);
  assert.match(headerIntroText, /편하게 넣어주세요/u);
  assert.match(headerIntroText, /상세페이지 초안과 광고 문구/u);
  assert.match(adOptionsIntroText, /브랜드 분위기/u);
  assert.doesNotMatch(adOptionsIntroText, /query|fragment|Phase/u);
  assert.equal(logsStartBelowPreview, true);
  assert.equal(exportPanelHiddenByDefault, true);
  assert.equal(exportPanelToggleDisabledByDefault, true);

  await evaluate(cdp, `localStorage.setItem('store-maker.settings.v2', JSON.stringify({
    provider: 'custom',
    mode: 'local-cli',
    imageGeneration: {
      provider: 'none',
      command: 'codex exec --skip-git-repo-check --ephemeral --sandbox workspace-write',
      model: 'CLI config',
      extraArgs: '',
      timeoutMs: '300000'
    }
  }))`);
  await cdp.call("Page.reload", { ignoreCache: true });
  await waitFor(cdp, "document.readyState === 'complete'");
  const migratedImageStatusText = await text(cdp, "#image-generation-main-status");
  assert.match(migratedImageStatusText, /켜짐/u);

  await click(cdp, "[data-action='open-settings']");
  await waitFor(cdp, "!document.querySelector('#settings-dialog')?.classList?.contains('is-hidden')");
  const dialogRole = await evaluate(cdp, "document.querySelector('#settings-dialog')?.getAttribute('role')");
  const ariaModal = await evaluate(cdp, "document.querySelector('#settings-dialog')?.getAttribute('aria-modal')");
  assert.equal(dialogRole, "dialog");
  assert.equal(ariaModal, "true");
  const settingsDialog = await screenshot(cdp, `${evidencePrefix}-settings-1280.png`);

  await click(cdp, "[data-provider='byok']");
  await setValue(cdp, "#command", "http://127.0.0.1:9999/generate");
  await setValue(cdp, "#api-key", "sk-test-store-maker-secret");
  await click(cdp, "[data-action='save-settings']");
  const storageWithSecret = await evaluate(cdp, "JSON.stringify(localStorage)");
  assert.doesNotMatch(storageWithSecret, /sk-test-store-maker-secret|apiKey|store-maker-token/i);

  await cdp.call("Page.reload", { ignoreCache: true });
  await waitFor(cdp, "document.readyState === 'complete'");
  await click(cdp, "[data-action='open-settings']");
  await waitFor(cdp, "!document.querySelector('#settings-dialog')?.classList?.contains('is-hidden')");
  const persistedByok = await evaluate(cdp, "document.querySelector('[data-provider=\"byok\"]')?.classList?.contains('active')");
  const apiKeyAfterReload = await value(cdp, "#api-key");
  assert.equal(persistedByok, true);
  assert.equal(apiKeyAfterReload, "");

  await click(cdp, "[data-action='preflight']");
  await waitFor(cdp, "document.querySelector('#status-badge')?.textContent?.includes('실패')");
  const byokStatus = await text(cdp, "#status-body");
  assert.match(byokStatus, /token|required/i);

  await click(cdp, "[data-settings-tab='routing']");
  await waitFor(cdp, "!document.querySelector('[data-settings-pane=\"routing\"]')?.classList?.contains('is-hidden')");
  for (const route of ["#route-category", "#route-copy", "#route-image", "#route-market"]) await setValue(cdp, route, "codex");
  await click(cdp, "[data-settings-tab='engine']");
  await click(cdp, "[data-provider='codex']");
  await setValue(cdp, "#command", "./scripts/fake-codex.mjs");
  await setValue(cdp, "#model", "CLI config");
  await setValue(cdp, "#extra-args", "");
  await setValue(cdp, "#timeout-ms", "1000");
  await click(cdp, "[data-image-provider='codex-imagegen']");
  await setValue(cdp, "#image-command", imagegenCommand);
  await setValue(cdp, "#image-model", "CLI config");
  await setValue(cdp, "#image-extra-args", "");
  await setValue(cdp, "#image-timeout-ms", imagegenTimeoutMs);
  await click(cdp, "[data-action='preflight']");
  await waitFor(cdp, "document.querySelector('#status-badge')?.textContent?.includes('통과')");
  const localStatus = await text(cdp, "#status-body");
  assert.doesNotMatch(localStatus, /Missing or invalid local API token|BYOK API token/i);
  await click(cdp, "[data-action='close-settings']");
  await fillProductExample(cdp);
  const typedProductFields = await evaluate(cdp, `(() => ({
    name: document.querySelector('#product-name')?.value ?? '',
    description: document.querySelector('#product-description')?.value ?? '',
    requirements: document.querySelector('#product-requirements')?.value ?? ''
  }))()`);
  assert.equal(typedProductFields.name, "저소음 한글 키보드");
  assert.match(typedProductFields.description, /낮은 키압/u);
  assert.match(typedProductFields.requirements, /금지어/u);
  await setValue(cdp, "#product-required-inclusions", "KC 인증번호 ABC-123과 1년 무상 A/S 문구는 반드시 포함");
  await setValue(cdp, "#image-mood-mode", "consistent");
  await setValue(cdp, "#image-same-mood-count", "4");
  await setValue(cdp, "#image-varied-mood-count", "0");
  await setValue(cdp, "#image-count", "4");
  await setValue(cdp, "#image-ratio", "1:1");
  await setValue(cdp, "#image-style", "제품 단독컷");
  await setValue(cdp, "#image-background", "흰 배경");

  await dispatchDragState(cdp, "#product-image-dropzone", "dragover");
  const dragStateActive = await evaluate(cdp, "document.querySelector('#product-image-dropzone')?.classList?.contains('is-dragging')");
  assert.equal(dragStateActive, true);
  await dispatchDragState(cdp, "#product-image-dropzone", "dragleave");
  const dragStateCleared = await evaluate(cdp, "document.querySelector('#product-image-dropzone')?.classList?.contains('is-dragging')");
  assert.equal(dragStateCleared, false);

  await dropSyntheticFile(cdp, "#product-image-dropzone", "drag-shot.png", "image/png", tinyPngBase64);
  await waitFor(cdp, "document.querySelector('#product-image-list')?.textContent?.includes('drag-shot.png')");
  await setFiles(cdp, "#reference-image-input", [
    join(fixtureDir, "button-photo.png"),
    join(fixtureDir, "remove-photo.png"),
  ]);
  await setFiles(cdp, "#supporting-material-input", [
    join(fixtureDir, "battery-spec.pdf"),
    join(fixtureDir, "material-notes.txt"),
  ]);
  await waitFor(cdp, "document.querySelector('#product-image-list')?.children?.length === 1");
  await waitFor(cdp, "document.querySelector('#reference-image-list')?.children?.length === 2");
  await waitFor(cdp, "document.querySelector('#supporting-material-list')?.children?.length === 2");
  const attachmentListText = await text(cdp, ".material-field");
  assert.match(attachmentListText, /drag-shot\.png/);
  assert.match(attachmentListText, /button-photo\.png/);
  assert.match(attachmentListText, /remove-photo\.png/);
  assert.match(attachmentListText, /battery-spec\.pdf/);
  assert.match(attachmentListText, /material-notes\.txt/);
  assert.match(attachmentListText, /상품 이미지/);
  assert.match(attachmentListText, /디자인 레퍼런스/);
  const imagePreviewCount = await evaluate(cdp, "document.querySelectorAll('#product-image-list img, #reference-image-list img').length");
  assert.ok(imagePreviewCount >= 2);
  await evaluate(cdp, "[...document.querySelectorAll('#reference-image-list .material-item')].find((item) => item.textContent.includes('remove-photo.png'))?.querySelector('[data-remove-attachment]')?.click()");
  await waitFor(cdp, "!document.querySelector('#reference-image-list')?.textContent?.includes('remove-photo.png')");
  await waitFor(cdp, "document.querySelector('#reference-image-list')?.children?.length === 1");

  await click(cdp, "[data-action='generate']");
  await waitFor(cdp, "document.querySelector('#preview-badge')?.textContent?.includes('생성 완료')", generationWaitMs);
  await waitFor(cdp, "document.querySelector('#job-status-pill')?.textContent?.includes('완료')", generationWaitMs);
  const firstJobIdText = await text(cdp, "#job-active-id");
  const firstJobCancelDisabled = await evaluate(cdp, "document.querySelector('[data-action=\"cancel-generation\"]')?.disabled");
  const firstJobHistoryText = await text(cdp, "#job-history-list");
  assert.match(firstJobIdText, /작업 ID [0-9a-f]{8}/u);
  assert.equal(firstJobCancelDisabled, true);
  assert.match(firstJobHistoryText, /저소음 한글 키보드/u);
  assert.match(firstJobHistoryText, /완료/u);

  await setValue(cdp, "#job-history-page-size", "3");
  await waitFor(cdp, "document.querySelectorAll('#job-history-list .job-history-item').length <= 3");
  const limitedHistorySize = await value(cdp, "#job-history-page-size");
  const limitedHistorySummary = await text(cdp, "#job-history-summary");
  assert.equal(limitedHistorySize, "3");
  assert.match(limitedHistorySummary, /1페이지\/1페이지|최근|0개/u);

  await setValue(cdp, "#job-history-search", "저소음");
  await waitFor(cdp, "document.querySelector('#job-history-list')?.textContent?.includes('저소음')");
  const filteredHistoryItems = await evaluate(cdp, "[...document.querySelectorAll('#job-history-list .job-history-item')].every((item) => item.textContent.includes('저소음'))");
  assert.equal(filteredHistoryItems, true);
  await setValue(cdp, "#job-history-search", "검색결과없는단어");
  await waitFor(cdp, "document.querySelector('#job-history-list')?.textContent?.includes('검색 결과가 없습니다.')");
  const emptyHistorySummary = await text(cdp, "#job-history-summary");
  assert.match(emptyHistorySummary, /검색 0\/0개/u);
  await setValue(cdp, "#job-history-search", "");
  await waitFor(cdp, "document.querySelector('#job-history-list')?.textContent?.includes('저소음 한글 키보드')");

  await setValue(cdp, "#log-page-size", "5");
  await waitFor(cdp, "document.querySelector('#log-page-size')?.value === '5'");
  await waitFor(cdp, "document.querySelectorAll('#log-list .log-entry').length === 0");
  const inlineLogSummaryText = await text(cdp, "#log-list");
  const limitedLogSummary = await text(cdp, "#logs .log-page-summary");
  assert.match(inlineLogSummaryText, /실행 로그 버튼/u);
  assert.match(limitedLogSummary, /최근|0 logs/u);

  await click(cdp, "[data-action='open-log-dialog']");
  await waitFor(cdp, "!document.querySelector('#log-dialog')?.classList?.contains('is-hidden')");
  const logDialogRole = await evaluate(cdp, "document.querySelector('#log-dialog')?.getAttribute('role')");
  const logDialogText = await text(cdp, "#log-dialog");
  const inlineLogCount = await evaluate(cdp, "document.querySelectorAll('#log-list .log-entry')?.length");
  const dialogLogCount = await evaluate(cdp, "document.querySelectorAll('#log-dialog-list .log-entry')?.length");
  const dialogLogPageSize = await value(cdp, "#log-dialog-page-size");
  assert.equal(logDialogRole, "dialog");
  assert.equal(inlineLogCount, 0);
  assert.ok(dialogLogCount > 0);
  assert.equal(dialogLogPageSize, "5");
  assert.ok(dialogLogCount <= 5);
  assert.match(logDialogText, /실행 로그/);
  assert.match(logDialogText, /prompt|preview|image/u);
  await setValue(cdp, "#log-dialog-page-size", "20");
  await waitFor(cdp, "document.querySelector('#log-page-size')?.value === '20' && document.querySelector('#log-dialog-page-size')?.value === '20'");
  await waitFor(cdp, "document.querySelectorAll('#log-dialog-list .log-entry').length <= 20");
  const expandedDialogLogCount = await evaluate(cdp, "document.querySelectorAll('#log-dialog-list .log-entry')?.length");
  const expandedInlineLogCount = await evaluate(cdp, "document.querySelectorAll('#log-list .log-entry')?.length");
  assert.equal(expandedInlineLogCount, 0);
  assert.ok(expandedDialogLogCount > 0);
  const logDialog = await screenshot(cdp, `${evidencePrefix}-log-dialog-1280.png`);
  await setViewport(cdp, 768, 900);
  const logDialogTablet = await screenshot(cdp, `${evidencePrefix}-log-dialog-768.png`);
  await setViewport(cdp, 375, 900);
  const logDialogMobile = await screenshot(cdp, `${evidencePrefix}-log-dialog-375.png`);
  const logDialogOverflow = await evaluate(cdp, "document.documentElement.scrollWidth > window.innerWidth + 1 || document.querySelector('#log-dialog')?.scrollWidth > document.querySelector('#log-dialog')?.clientWidth + 1");
  assert.equal(logDialogOverflow, false);
  await setViewport(cdp, 1280, 900);
  await click(cdp, "#log-dialog [data-action='close-log-dialog']");
  await waitFor(cdp, "document.querySelector('#log-dialog')?.classList?.contains('is-hidden')");

  const previewText = await text(cdp, "#result-preview");
  assert.match(previewText, /저소음 한글 키보드/);
  assert.match(previewText, /스마트스토어|smartstore/);
  assert.match(previewText, /Codex adapter/);
  assert.match(previewText, /3\. 이미지 생성\/촬영 프롬프트/);

  await waitFor(cdp, "Boolean(document.querySelector('#result-preview img[src^=\"/outputs/image-runs/\"]'))");
  await waitFor(cdp, "document.querySelectorAll('.generated-image-card').length === 4");
  const generatedImageUrl = await evaluate(cdp, "document.querySelector('#result-preview img[src^=\"/outputs/image-runs/\"]')?.getAttribute('src')");
  const generatedImageFetch = await evaluate(cdp, `fetch(${JSON.stringify(baseUrl)} + ${JSON.stringify(generatedImageUrl)}).then((response) => response.status + ':' + response.headers.get('content-type'))`);
  const downloadLinkCount = await evaluate(cdp, "document.querySelectorAll('.generated-image-card a[download]').length");
  const generatedImageOriginalLink = await evaluate(cdp, "document.querySelector('.generated-image-card a[target=\"_blank\"]')?.textContent?.trim()");
  const generatedImageCardCount = await evaluate(cdp, "document.querySelectorAll('.generated-image-card').length");
  const generatedImageCountText = await text(cdp, ".generated-image-count");
  const placeholderBadgeCount = await evaluate(cdp, "document.querySelectorAll('.generated-image-badge').length");
  const imageWarningText = await text(cdp, ".generated-image-warning-panel");
  assert.match(generatedImageUrl, /^\/outputs\/image-runs\/.+product-main\.png/u);
  assert.equal(generatedImageFetch, "200:image/png");
  assert.equal(downloadLinkCount, 0);
  assert.equal(generatedImageOriginalLink, "원본 열기");
  assert.equal(generatedImageCardCount, 4);
  assert.match(generatedImageCountText, /요청 4개\s*\/\s*생성 4개/u);
  assert.equal(placeholderBadgeCount, 4);
  assert.match(imageWarningText, /실제 상품 사진이 아닌 테스트용 플레이스홀더/u);

  await openExportPanel(cdp);
  await click(cdp, "[data-export='json']");
  await waitFor(cdp, "document.querySelector('#export-output')?.value?.includes('저소음 한글 키보드')");
  const exportText = await value(cdp, "#export-output");
  const exportJson = new URL(`${evidencePrefix}-export.json`, evidenceDir);
  await writeFile(exportJson, exportText);
  const exportPayload = JSON.parse(exportText);
  const exportedImageUrls = exportPayload.result?.images?.files?.map((file) => file.url) ?? [];
  assert.equal(exportPayload.requestedImageCount, 4);
  assert.equal(exportPayload.generatedImageCount, 4);
  assert.equal(exportPayload.imageGeneration?.moodMode, "consistent");
  assert.equal(exportPayload.imageGeneration?.sameMoodCount, 4);
  assert.equal(exportPayload.imageGeneration?.variedMoodCount, 0);
  assert.equal(exportPayload.images?.length, 4);
  assert.match(exportText, /prompt delivered/);
  assert.match(exportText, /drag-shot\.png/);
  assert.match(exportText, /\"role\": \"product-image\"/);
  assert.match(exportText, /button-photo\.png/);
  assert.match(exportText, /\"role\": \"design-reference\"/);
  assert.match(exportText, /battery-spec\.pdf/);
  assert.match(exportText, /material-notes\.txt/);
  assert.match(exportText, /배터리 24개월 사용 가능/);
  assert.match(exportText, /KC 인증번호 ABC-123과 1년 무상 A\/S 문구는 반드시 포함/);
  assert.equal(exportPayload.product?.requiredInclusions, "KC 인증번호 ABC-123과 1년 무상 A/S 문구는 반드시 포함");
  assert.match(exportText, /codex-imagegen/);
  assert.match(exportText, /product-main\.png/);
  assert.match(exportText, /outputs\/image-runs/);
  assert.ok(exportedImageUrls.includes(generatedImageUrl), "JSON export must reference the same image run rendered in preview");
  assert.doesNotMatch(exportText, /remove-photo\.png/);
  assert.doesNotMatch(exportText, /data:image/);
  assert.doesNotMatch(exportText, /sk-test-store-maker-secret/);
  if (process.env.STORE_MAKER_EXPECT_FALLBACK_MANIFEST === "1") {
    assert.equal(exportPayload.result?.images?.manifest?.fallback, true);
    assert.ok(exportPayload.logs?.some((log) => log.title === "image output recovered"));
    assert.ok(exportPayload.logs?.some((log) => log.title === "fallback manifest created"));
  }

  await click(cdp, ".generated-image-card [data-action='open-generated-image']");
  await waitFor(cdp, "!document.querySelector('#image-viewer-dialog')?.classList?.contains('is-hidden')");
  const viewerImageUrl = await evaluate(cdp, "document.querySelector('#image-viewer-img')?.getAttribute('src')");
  const viewerOriginalHref = await evaluate(cdp, "document.querySelector('#image-viewer-open-original')?.getAttribute('href')");
  const viewerDownloadCount = await evaluate(cdp, "document.querySelectorAll('#image-viewer-dialog a[download]').length");
  assert.equal(viewerImageUrl, generatedImageUrl);
  assert.equal(viewerOriginalHref, generatedImageUrl);
  assert.equal(viewerDownloadCount, 0);
  const imageEditInitialState = await evaluate(cdp, `(() => ({
    state: document.querySelector('#image-edit-state-card')?.dataset.state,
    pill: document.querySelector('#image-edit-state-pill')?.textContent?.trim(),
    status: document.querySelector('#image-edit-status')?.textContent?.trim(),
    detail: document.querySelector('#image-edit-state-detail')?.textContent?.trim()
  }))()`);
  assert.equal(imageEditInitialState.state, "idle");
  assert.equal(imageEditInitialState.pill, "대기");
  assert.match(imageEditInitialState.status, /수정 요청/u);
  assert.match(imageEditInitialState.detail, /수정 준비/u);
  const imageViewer = await screenshot(cdp, `${evidencePrefix}-image-viewer-1280.png`);
  await setViewport(cdp, 768, 900);
  const imageViewerTablet = await screenshot(cdp, `${evidencePrefix}-image-viewer-768.png`);
  await setViewport(cdp, 375, 900);
  const imageViewerMobile = await screenshot(cdp, `${evidencePrefix}-image-viewer-375.png`);
  const imageViewerOverflow = await evaluate(cdp, "document.documentElement.scrollWidth > window.innerWidth + 1 || document.querySelector('#image-viewer-dialog')?.scrollWidth > document.querySelector('#image-viewer-dialog')?.clientWidth + 1");
  assert.equal(imageViewerOverflow, false);
  await setViewport(cdp, 1280, 900);
  await setValue(cdp, "#image-edit-instruction", "키캡 각인을 더 선명하게 보여주고 흰 배경은 유지");
  await click(cdp, "[data-action='edit-generated-image']");
  await waitFor(cdp, "['running', 'done'].includes(document.querySelector('#image-edit-state-card')?.dataset.state)", 1000);
  const imageEditActiveState = await evaluate(cdp, `(() => ({
    state: document.querySelector('#image-edit-state-card')?.dataset.state,
    pill: document.querySelector('#image-edit-state-pill')?.textContent?.trim(),
    button: document.querySelector('[data-action="edit-generated-image"]')?.textContent?.trim()
  }))()`);
  assert.ok(["running", "done"].includes(imageEditActiveState.state));
  assert.ok(["생성 중", "완료"].includes(imageEditActiveState.pill));
  assert.ok(["생성 중", "수정본 생성"].includes(imageEditActiveState.button));
  await waitFor(cdp, "document.querySelector('#image-edit-status')?.textContent?.includes('수정본을 생성')", generationWaitMs);
  await waitFor(cdp, "document.querySelectorAll('.generated-image-card-edited').length >= 1", generationWaitMs);
  const imageEditDoneState = await evaluate(cdp, `(() => ({
    state: document.querySelector('#image-edit-state-card')?.dataset.state,
    pill: document.querySelector('#image-edit-state-pill')?.textContent?.trim(),
    detail: document.querySelector('#image-edit-state-detail')?.textContent?.trim()
  }))()`);
  assert.equal(imageEditDoneState.state, "done");
  assert.equal(imageEditDoneState.pill, "완료");
  assert.match(imageEditDoneState.detail, /갤러리/u);
  const imageViewerEdited = await screenshot(cdp, `${evidencePrefix}-image-viewer-edited-1280.png`);
  const editedImageUrl = await evaluate(cdp, "document.querySelector('.generated-image-card-edited img')?.getAttribute('src')");
  assert.match(editedImageUrl, /^\/outputs\/image-runs\/.+product-main\.png/u);
  await click(cdp, "[data-export='json']");
  await waitFor(cdp, "document.querySelector('#export-output')?.value?.includes('\"editedImages\"')");
  const editExportText = await value(cdp, "#export-output");
  const imageEditExportJson = new URL(`${evidencePrefix}-image-edit-export.json`, evidenceDir);
  await writeFile(imageEditExportJson, editExportText);
  const imageEditExportPayload = JSON.parse(editExportText);
  assert.equal(imageEditExportPayload.editedImages?.length, 1);
  assert.equal(imageEditExportPayload.editedImages[0].url, editedImageUrl);
  await click(cdp, "[data-action='close-image-viewer']");
  await waitFor(cdp, "document.querySelector('#image-viewer-dialog')?.classList?.contains('is-hidden')");

  await cdp.call("Page.reload", { ignoreCache: true });
  await waitFor(cdp, "document.readyState === 'complete'");
  const restoredHistoryPageSize = await value(cdp, "#job-history-page-size");
  const restoredLogPageSize = await value(cdp, "#log-page-size");
  assert.equal(restoredHistoryPageSize, "3");
  assert.equal(restoredLogPageSize, "20");
  await waitFor(cdp, "document.querySelector('#job-history-list')?.textContent?.includes('저소음 한글 키보드')", generationWaitMs);
  const restoredVisibleHistoryCount = await evaluate(cdp, "document.querySelectorAll('#job-history-list .job-history-item').length");
  assert.ok(restoredVisibleHistoryCount <= 3);
  await click(cdp, "#job-history-list .job-history-item");
  await waitFor(cdp, "document.querySelector('#preview-badge')?.textContent?.includes('생성 완료')", generationWaitMs);
  await waitFor(cdp, "document.querySelectorAll('.generated-image-card').length === 4");
  const restoredJobStatus = await text(cdp, "#job-status-pill");
  const restoredCancelDisabled = await evaluate(cdp, "document.querySelector('[data-action=\"cancel-generation\"]')?.disabled");
  assert.match(restoredJobStatus, /완료/u);
  assert.equal(restoredCancelDisabled, true);

  await fillProductExample(cdp);
  await setValue(cdp, "#image-count", "10");
  await setValue(cdp, "#image-mood-mode", "varied");
  await setValue(cdp, "#image-same-mood-count", "0");
  await setValue(cdp, "#image-varied-mood-count", "10");
  await setValue(cdp, "#image-style", "자동 다양화");
  await click(cdp, "[data-action='generate']");
  await waitFor(cdp, "document.querySelector('#preview-badge')?.textContent?.includes('생성 완료')", generationWaitMs);
  await waitFor(cdp, "document.querySelectorAll('.generated-image-card').length === 10");
  await waitFor(cdp, "document.querySelector('#job-history-list')?.textContent?.includes('이미지 10개')", generationWaitMs);
  const tenCountText = await text(cdp, ".generated-image-count");
  const tenCardStyles = await evaluate(cdp, "[...document.querySelectorAll('.generated-image-card .generated-image-style')].map((node) => node.textContent.trim())");
  const tenCardBriefs = await evaluate(cdp, "[...document.querySelectorAll('.generated-image-card figcaption small')].map((node) => node.textContent.trim())");
  const jobHistoryCount = await evaluate(cdp, "document.querySelectorAll('#job-history-list .job-history-item').length");
  assert.match(tenCountText, /요청 10개\s*\/\s*생성 10개/u);
  assert.ok(jobHistoryCount >= 2);
  assert.equal(tenCardStyles.length, 10);
  assert.equal(tenCardBriefs.length, 10);
  assert.equal(await evaluate(cdp, "document.querySelectorAll('.generated-image-badge').length"), 10);
  assert.ok(new Set(tenCardStyles).size >= 8, "10-card preview should show varied styles");
  await openExportPanel(cdp);
  await click(cdp, "[data-export='json']");
  await waitFor(cdp, "document.querySelector('#export-output')?.value?.includes('\"requestedImageCount\": 10')");
  const tenExportText = await value(cdp, "#export-output");
  const tenExportJson = new URL(`${evidencePrefix}-export-10.json`, evidenceDir);
  await writeFile(tenExportJson, tenExportText);
  const tenExportPayload = JSON.parse(tenExportText);
  assert.equal(tenExportPayload.requestedImageCount, 10);
  assert.equal(tenExportPayload.generatedImageCount, 10);
  assert.equal(tenExportPayload.imageGeneration?.moodMode, "varied");
  assert.equal(tenExportPayload.imageGeneration?.sameMoodCount, 0);
  assert.equal(tenExportPayload.imageGeneration?.variedMoodCount, 10);
  assert.equal(tenExportPayload.images?.length, 10);
  assert.equal(tenExportPayload.imageBriefs?.length, 10);
  assert.equal(tenExportPayload.result?.images?.files?.length, 10);
  assert.ok(new Set(tenExportPayload.imageBriefs.map((brief) => brief.style)).size >= 8);
  assert.ok(new Set(tenExportPayload.imageBriefs.map((brief) => brief.purpose)).size >= 8);
  assert.ok(tenExportPayload.images.every((image, index) => image.style === tenExportPayload.imageBriefs[index].style));
  assert.ok(tenExportPayload.images.every((image) => image.brief?.visualPrompt && image.brief?.purpose));
  const tenGallery = await screenshot(cdp, `${evidencePrefix}-imagegen-10-1280.png`);

  await click(cdp, "#generation-mode-ad");
  await waitFor(cdp, "!document.querySelector('#ad-options-panel')?.classList?.contains('is-hidden')");
  const adControlHeights = await evaluate(cdp, `(() => {
    const brand = document.querySelector('#brand-url')?.getBoundingClientRect();
    const mood = document.querySelector('#ad-mood-preset')?.getBoundingClientRect();
    return { brand: brand?.height ?? 0, mood: mood?.height ?? 0 };
  })()`);
  assert.ok(Math.abs(adControlHeights.brand - adControlHeights.mood) <= 1);
  await setValue(cdp, "#brand-url", "https://brand.example/keyboard?draft=one&noise=two#hero");
  await setValue(cdp, "#ad-mood-preset", "bold");
  await click(cdp, "[data-action='generate']");
  await waitFor(cdp, "document.querySelector('#preview-badge')?.textContent?.includes('생성 완료')", generationWaitMs);

  const adPreviewText = await text(cdp, "#result-preview");
  assert.match(adPreviewText, /Brand DNA|브랜드 DNA/u);
  assert.match(adPreviewText, /추천 앵글/u);
  assert.match(adPreviewText, /광고 결과 갤러리/u);
  const adCardCount = await evaluate(cdp, "document.querySelectorAll('.ad-card').length");
  assert.equal(adCardCount, 5);

  await openExportPanel(cdp);
  await click(cdp, "[data-export='json']");
  await waitFor(cdp, "document.querySelector('#export-output')?.value?.includes('\"adSet\"')");
  const adExportText = await value(cdp, "#export-output");
  const adExportJson = new URL(`${evidencePrefix}-ad-export.json`, evidenceDir);
  await writeFile(adExportJson, adExportText);
  const adExportPayload = JSON.parse(adExportText);
  assert.equal(adExportPayload.generationMode, "ad-set");
  assert.equal(adExportPayload.brandDna?.source?.brandUrl, "https://brand.example/keyboard");
  assert.equal(adExportPayload.adAutomation?.recommendedAngles?.length, 5);
  assert.equal(adExportPayload.adAutomation?.availableAngles?.length, 16);
  assert.equal(adExportPayload.adSet?.ads?.length, 5);
  assert.doesNotMatch(adExportText, /draft=one|noise=two|#hero|data:image/u);

  if (realImagegenRun) {
    const desktop = await screenshot(cdp, `${evidencePrefix}-real-imagegen-1280.png`);
    await setViewport(cdp, 768, 900);
    const tablet = await screenshot(cdp, `${evidencePrefix}-real-imagegen-768.png`);
    await setViewport(cdp, 375, 900);
    const mobile = await screenshot(cdp, `${evidencePrefix}-real-imagegen-375.png`);
    console.log(JSON.stringify({
      ok: true,
      url: baseUrl,
      generatedImageUrl,
      exportedImageUrls,
      fallbackManifest: exportPayload.result?.images?.manifest?.fallback === true,
      screenshots: [settingsDialog, imageViewer, imageViewerTablet, imageViewerMobile, imageViewerEdited, desktop, tablet, mobile],
      logDialog,
      logDialogTablet,
      logDialogMobile,
      exportJson: exportJson.pathname,
      imageEditExportJson: imageEditExportJson.pathname,
      tenExportJson: tenExportJson.pathname,
      adExportJson: adExportJson.pathname,
      tenGallery,
      observable: "actual Codex CLI ImageGen command completed through browser UI, rendered 4-image and 10-image style-diverse galleries, ad-set mode produced Brand DNA, 5 ad cards, recommended angles, and JSON export included image/ad payloads",
    }, null, 2));
  } else {
    await click(cdp, "[data-action='open-settings']");
    await click(cdp, "[data-provider='codex']");
    await waitFor(cdp, "document.querySelector('#preview-badge')?.textContent?.includes('생성 전')");
    const providerSwitchExport = await value(cdp, "#export-output");
    const providerSwitchExportButtonsDisabled = await evaluate(cdp, "[...document.querySelectorAll('[data-export]')].every((button) => button.disabled)");
    const providerSwitchExportToggleDisabled = await evaluate(cdp, "document.querySelector('[data-action=\"toggle-export-panel\"]')?.disabled");
    const providerSwitchExportPanelHidden = await evaluate(cdp, "document.querySelector('#export-panel')?.classList?.contains('is-hidden')");
    assert.equal(providerSwitchExport, "");
    assert.equal(providerSwitchExportButtonsDisabled, true);
    assert.equal(providerSwitchExportToggleDisabled, true);
    assert.equal(providerSwitchExportPanelHidden, true);

    await click(cdp, "[data-provider='custom']");
    await setValue(cdp, "#command", "definitely-missing-store-maker-cli");
    await setValue(cdp, "#timeout-ms", "");
    await click(cdp, "[data-action='close-settings']");
    await click(cdp, "[data-action='generate']");
    await waitFor(cdp, "document.querySelector('#preview-badge')?.textContent?.includes('생성 실패')", 15000);
    const staleExport = await value(cdp, "#export-output");
    const exportButtonsDisabled = await evaluate(cdp, "[...document.querySelectorAll('[data-export]')].every((button) => button.disabled)");
    const exportToggleDisabled = await evaluate(cdp, "document.querySelector('[data-action=\"toggle-export-panel\"]')?.disabled");
    const exportPanelHidden = await evaluate(cdp, "document.querySelector('#export-panel')?.classList?.contains('is-hidden')");
    assert.equal(staleExport, "");
    assert.equal(exportButtonsDisabled, true);
    assert.equal(exportToggleDisabled, true);
    assert.equal(exportPanelHidden, true);

    await click(cdp, "[data-action='open-settings']");
    await setValue(cdp, "#command", "node scripts/mock-engine.mjs");
    await setValue(cdp, "#prompt-transport", "stdin");
    await click(cdp, "[data-action='close-settings']");
    await click(cdp, "[data-action='generate']");
    await waitFor(cdp, "document.querySelector('#preview-badge')?.textContent?.includes('생성 완료')", 15000);

    await seedGenerationHistory(cdp, 7);
    await setValue(cdp, "#job-history-search", "");
    await setValue(cdp, "#job-history-page-size", "3");
    await waitFor(cdp, "document.querySelectorAll('#job-history-pages [data-job-history-page]').length >= 2", generationWaitMs);
    const paginationStats = await evaluate(cdp, `fetch('/api/generate-jobs', {
      headers: {
        'x-store-maker-token': document.querySelector('meta[name="store-maker-token"]')?.content ?? '',
        'x-store-maker-ephemeral-job': '1'
      }
    }).then((response) => response.json()).then((payload) => {
      const buttonLabels = [...document.querySelectorAll('#job-history-pages [data-job-history-page]')].map((button) => button.textContent.trim());
      return { jobCount: payload.jobs.length, buttonLabels };
    })`);
    assert.equal(paginationStats.buttonLabels.length, Math.ceil(paginationStats.jobCount / 3));
    assert.deepEqual(paginationStats.buttonLabels, Array.from({ length: paginationStats.buttonLabels.length }, (_, index) => `${index + 1}페이지`));
    const createdSortStats = await evaluate(cdp, `fetch('/api/generate-jobs', {
      headers: {
        'x-store-maker-token': document.querySelector('meta[name="store-maker-token"]')?.content ?? '',
        'x-store-maker-ephemeral-job': '1'
      }
    }).then((response) => response.json()).then((payload) => {
      const timestamp = (value) => {
        const parsed = Date.parse(value ?? '');
        return Number.isFinite(parsed) ? parsed : 0;
      };
      const expectedFirstIds = [...payload.jobs]
        .sort((left, right) => timestamp(right.createdAt) - timestamp(left.createdAt)
          || timestamp(right.startedAt) - timestamp(left.startedAt)
          || timestamp(right.finishedAt) - timestamp(left.finishedAt)
          || timestamp(right.updatedAt) - timestamp(left.updatedAt)
          || String(right.id).localeCompare(String(left.id)))
        .slice(0, 3)
        .map((job) => job.id);
      const visibleIds = [...document.querySelectorAll('#job-history-list [data-job-id]')].map((item) => item.dataset.jobId);
      return { expectedFirstIds, visibleIds };
    })`);
    assert.deepEqual(createdSortStats.visibleIds, createdSortStats.expectedFirstIds);
    await click(cdp, "#job-history-pages [data-job-history-page='2']");
    await waitFor(cdp, "document.querySelector('#job-history-pages .job-history-page-btn.active')?.textContent?.trim() === '2페이지'");
    const pageTwoSummary = await text(cdp, "#job-history-summary");
    assert.match(pageTwoSummary, /2페이지\//u);
    assert.ok(paginationStats.buttonLabels.length >= 3);
    await click(cdp, "#job-history-pages [data-job-history-page='3']");
    await waitFor(cdp, "document.querySelector('#job-history-pages .job-history-page-btn.active')?.textContent?.trim() === '3페이지'");
    const firstPageThreeJobId = await evaluate(cdp, "document.querySelector('#job-history-list [data-delete-job-id]')?.dataset.deleteJobId");
    assert.match(firstPageThreeJobId, /^[0-9a-f-]+$/u);
    await click(cdp, "#job-history-pages [data-job-history-page='2']");
    await waitFor(cdp, "document.querySelector('#job-history-pages .job-history-page-btn.active')?.textContent?.trim() === '2페이지'");
    const deleteJobId = await evaluate(cdp, "document.querySelector('#job-history-list [data-delete-job-id]')?.dataset.deleteJobId");
    assert.match(deleteJobId, /^[0-9a-f-]+$/u);
    await evaluate(cdp, "document.querySelector('#job-history-list [data-delete-job-id]')?.click()");
    await waitForJobRemoved(cdp, deleteJobId);
    const deletedStillVisible = await evaluate(cdp, `Boolean(document.querySelector(${JSON.stringify(`[data-delete-job-id="${deleteJobId}"]`)}))`);
    assert.equal(deletedStillVisible, false);
    await waitFor(cdp, "document.querySelectorAll('#job-history-list .job-history-item').length === 3");
    const pageTwoIdsAfterDelete = await evaluate(cdp, "[...document.querySelectorAll('#job-history-list [data-delete-job-id]')].map((button) => button.dataset.deleteJobId)");
    assert.equal(pageTwoIdsAfterDelete.includes(deleteJobId), false);
    assert.equal(pageTwoIdsAfterDelete.includes(firstPageThreeJobId), true);

    const desktop = await screenshot(cdp, `${evidencePrefix}-1280.png`);
    await setViewport(cdp, 768, 900);
    const tablet = await screenshot(cdp, `${evidencePrefix}-768.png`);
    await setViewport(cdp, 375, 900);
    const mobile = await screenshot(cdp, `${evidencePrefix}-375.png`);

    console.log(JSON.stringify({
      ok: true,
      url: baseUrl,
      screenshots: [settingsDialog, imageViewer, imageViewerTablet, imageViewerMobile, imageViewerEdited, desktop, tablet, mobile],
      logDialog,
      logDialogTablet,
      logDialogMobile,
      exportJson: exportJson.pathname,
      imageEditExportJson: imageEditExportJson.pathname,
      tenExportJson: tenExportJson.pathname,
      adExportJson: adExportJson.pathname,
      tenGallery,
      observable: "settings dialog opens, Codex local CLI adapter completes, Codex ImageGen renders 4-image and 10-image style-diverse galleries, ad-set mode produces Brand DNA, 5 ad cards, recommended angles, and JSON export includes image/ad payloads",
    }, null, 2));
  }
  await cdp.close();
} finally {
  await stopChrome(chrome);
  await rm(userDataDir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
  await rm(fixtureDir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}

async function waitForWebSocketUrl(port) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`);
      const payload = await response.json();
      const page = Array.isArray(payload) ? payload.find((target) => target.type === "page") : undefined;
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch (error) {
      await delay(150);
    }
  }
  throw new Error("Chrome DevTools endpoint did not become ready");
}

async function resolveChromePath() {
  for (const candidate of chromeCandidates()) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
    }
  }
  throw new Error("Chrome executable not found. Set CHROME_PATH or install Google Chrome/Chromium.");
}

function chromeCandidates() {
  const explicit = process.env.CHROME_PATH ? [process.env.CHROME_PATH] : [];
  const common = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  const pathCommands = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]
    .flatMap((command) => (process.env.PATH ?? "").split(":").filter(Boolean).map((dir) => join(dir, command)));
  return [...explicit, ...common, ...pathCommands];
}

function connectCdp(wsUrl) {
  const socket = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (!payload.id) return;
    const callbacks = pending.get(payload.id);
    if (!callbacks) return;
    pending.delete(payload.id);
    if (payload.error) callbacks.reject(new Error(payload.error.message));
    else callbacks.resolve(payload.result ?? {});
  });
  return new Promise((resolveConnect, rejectConnect) => {
    socket.addEventListener("open", () => {
      resolveConnect({
        call(method, params = {}) {
          const id = nextId++;
          socket.send(JSON.stringify({ id, method, params }));
          return new Promise((resolveCall, rejectCall) => pending.set(id, { resolve: resolveCall, reject: rejectCall }));
        },
        close() {
          socket.close();
        },
      });
    });
    socket.addEventListener("error", () => rejectConnect(new Error("Unable to connect to Chrome DevTools")));
  });
}

async function setViewport(cdp, width, height) {
  currentViewport = { width, height };
  await cdp.call("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
}

async function click(cdp, selector) {
  await cdp.call("Runtime.evaluate", {
    expression: `document.querySelector(${JSON.stringify(selector)})?.click()`,
    awaitPromise: true,
  });
}

async function openExportPanel(cdp) {
  await click(cdp, "[data-action='toggle-export-panel']");
  await waitFor(cdp, "!document.querySelector('#export-panel')?.classList?.contains('is-hidden')");
}

async function setValue(cdp, selector, newValue) {
  await cdp.call("Runtime.evaluate", {
    expression: `{
      const input = document.querySelector(${JSON.stringify(selector)});
      input.value = ${JSON.stringify(newValue)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }`,
    awaitPromise: true,
  });
}

async function setFiles(cdp, selector, files) {
  const documentNode = await cdp.call("DOM.getDocument");
  const inputNode = await cdp.call("DOM.querySelector", {
    nodeId: documentNode.root.nodeId,
    selector,
  });
  assert.notEqual(inputNode.nodeId, 0, `${selector} must exist`);
  await cdp.call("DOM.setFileInputFiles", { nodeId: inputNode.nodeId, files });
  await cdp.call("Runtime.evaluate", {
    expression: `{
      const input = document.querySelector(${JSON.stringify(selector)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }`,
    awaitPromise: true,
  });
}

async function dropSyntheticFile(cdp, selector, name, type, base64) {
  await cdp.call("Runtime.evaluate", {
    expression: `{
      const target = document.querySelector(${JSON.stringify(selector)});
      const bytes = Uint8Array.from(atob(${JSON.stringify(base64)}), (char) => char.charCodeAt(0));
      const file = new File([bytes], ${JSON.stringify(name)}, { type: ${JSON.stringify(type)} });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      target.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer }));
      target.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer }));
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer }));
    }`,
    awaitPromise: true,
  });
}

async function dispatchDragState(cdp, selector, eventName) {
  await cdp.call("Runtime.evaluate", {
    expression: `{
      const target = document.querySelector(${JSON.stringify(selector)});
      const dataTransfer = new DataTransfer();
      target.dispatchEvent(new DragEvent(${JSON.stringify(eventName)}, { bubbles: true, dataTransfer }));
    }`,
    awaitPromise: true,
  });
}

async function evaluate(cdp, expression) {
  const result = await cdp.call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return result.result.value;
}

async function text(cdp, selector) {
  const result = await cdp.call("Runtime.evaluate", {
    expression: `document.querySelector(${JSON.stringify(selector)})?.innerText ?? ""`,
    returnByValue: true,
  });
  return result.result.value;
}

async function value(cdp, selector) {
  const result = await cdp.call("Runtime.evaluate", {
    expression: `document.querySelector(${JSON.stringify(selector)})?.value ?? ""`,
    returnByValue: true,
  });
  return result.result.value;
}

async function waitFor(cdp, expression, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await cdp.call("Runtime.evaluate", { expression, returnByValue: true });
    if (result.result.value === true) return;
    await delay(150);
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

async function fillProductExample(cdp) {
  await setValue(cdp, "#product-name", "저소음 한글 키보드");
  await setValue(cdp, "#product-description", "사무실과 재택근무용, 낮은 키압, 오래 쓰는 배터리, 한글 각인 키캡");
  await setValue(cdp, "#product-requirements", "스마트스토어와 쿠팡 문체를 분리하고 금지어는 의료 효과, 과장된 1위 표현입니다.");
}

async function seedGenerationHistory(cdp, minimumJobs) {
  const result = await evaluate(cdp, `(async () => {
    const token = document.querySelector('meta[name="store-maker-token"]')?.content ?? '';
    const headers = { 'content-type': 'application/json', 'x-store-maker-token': token, 'x-store-maker-ephemeral-job': '1' };
    const listJobs = async () => fetch('/api/generate-jobs', { headers }).then((response) => response.json());
    let payload = await listJobs();
    const needed = Math.max(0, ${minimumJobs} - (payload.jobs?.length ?? 0));
    for (let index = 0; index < needed; index += 1) {
      await fetch('/api/generate-jobs', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          engine: {
            mode: 'local-cli',
            engineId: 'custom',
            command: 'node scripts/mock-engine.mjs',
            model: 'mock',
            promptTransport: 'stdin'
          },
          imageGeneration: { provider: 'none', imageCount: 0 },
          product: {
            name: '페이지 검증 상품 ' + String(index + 1).padStart(2, '0'),
            description: '작업 히스토리 페이지네이션 검증용 상품',
            requirements: '삭제 후 뒤 페이지 항목이 앞으로 채워져야 합니다.'
          },
          markets: ['smartstore']
        })
      });
    }
    const terminalStatuses = new Set(['completed', 'failed', 'cancelled']);
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      payload = await listJobs();
      const jobs = payload.jobs ?? [];
      if (jobs.length >= ${minimumJobs} && jobs.every((job) => terminalStatuses.has(job.status))) break;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    document.querySelector('[data-action="refresh-jobs"]')?.click();
    return {
      jobCount: payload.jobs?.length ?? 0,
      terminal: (payload.jobs ?? []).every((job) => terminalStatuses.has(job.status))
    };
  })()`);
  assert.ok(result.jobCount >= minimumJobs);
  assert.equal(result.terminal, true);
  await waitFor(cdp, "document.querySelectorAll('#job-history-list .job-history-item').length > 0");
}

async function waitForJobRemoved(cdp, jobId, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const exists = await evaluate(cdp, `fetch('/api/generate-jobs', {
      headers: {
        'x-store-maker-token': document.querySelector('meta[name="store-maker-token"]')?.content ?? '',
        'x-store-maker-ephemeral-job': '1'
      }
    }).then((response) => response.json()).then((payload) => payload.jobs.some((job) => job.id === ${JSON.stringify(jobId)}))`);
    if (exists === false) return;
    await delay(150);
  }
  throw new Error(`Timed out waiting for deleted job ${jobId} to leave history`);
}

async function screenshot(cdp, name) {
  const fullHeight = await evaluate(cdp, "Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0, window.innerHeight)");
  const result = await cdp.call("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: currentViewport.width, height: Math.ceil(fullHeight), scale: 1 },
  });
  const path = new URL(name, evidenceDir);
  await writeFile(path, Buffer.from(result.data, "base64"));
  return path.pathname;
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function stopChrome(childProcess) {
  if (childProcess.exitCode !== null || childProcess.signalCode !== null) return;

  const exited = new Promise((resolveExit) => {
    childProcess.once("exit", resolveExit);
  });

  childProcess.kill("SIGTERM");

  await Promise.race([
    exited,
    delay(3000).then(() => {
      if (childProcess.exitCode === null && childProcess.signalCode === null) {
        childProcess.kill("SIGKILL");
      }
      return Promise.race([exited, delay(2000)]);
    }),
  ]);
}
