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

await mkdir(evidenceDir, { recursive: true });
await mkdir(fixtureDir, { recursive: true });
  await writeFile(join(fixtureDir, "button-photo.png"), Buffer.from(tinyPngBase64, "base64"));
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

  const settingsButtonExists = await evaluate(cdp, "Boolean(document.querySelector('[data-action=\"open-settings\"]'))");
  const enginePanelVisibleOnMain = await evaluate(cdp, "Boolean(document.querySelector('main #engines'))");
  const materialsTextareaExists = await evaluate(cdp, "Boolean(document.querySelector('#materials'))");
  const dropzoneExists = await evaluate(cdp, "Boolean(document.querySelector('#material-dropzone'))");
  const uploadButtonText = await text(cdp, "[data-action='upload-materials']");
  assert.equal(settingsButtonExists, true);
  assert.equal(enginePanelVisibleOnMain, false);
  assert.equal(materialsTextareaExists, false);
  assert.equal(dropzoneExists, true);
  assert.match(uploadButtonText, /파일 업로드/);

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
  await setValue(cdp, "#image-count", "1");
  await setValue(cdp, "#image-ratio", "1:1");
  await setValue(cdp, "#image-style", "제품 단독컷");
  await setValue(cdp, "#image-background", "흰 배경");

  await dispatchDragState(cdp, "#material-dropzone", "dragover");
  const dragStateActive = await evaluate(cdp, "document.querySelector('#material-dropzone')?.classList?.contains('is-dragging')");
  assert.equal(dragStateActive, true);
  await dispatchDragState(cdp, "#material-dropzone", "dragleave");
  const dragStateCleared = await evaluate(cdp, "document.querySelector('#material-dropzone')?.classList?.contains('is-dragging')");
  assert.equal(dragStateCleared, false);

  await dropSyntheticFile(cdp, "#material-dropzone", "drag-shot.png", "image/png", tinyPngBase64);
  await waitFor(cdp, "document.querySelector('#material-list')?.textContent?.includes('drag-shot.png')");
  await setFiles(cdp, "#material-file-input", [
    join(fixtureDir, "button-photo.png"),
    join(fixtureDir, "battery-spec.pdf"),
    join(fixtureDir, "material-notes.txt"),
  ]);
  await waitFor(cdp, "document.querySelector('#material-list')?.children?.length === 4");
  const attachmentListText = await text(cdp, "#material-list");
  assert.match(attachmentListText, /drag-shot\.png/);
  assert.match(attachmentListText, /button-photo\.png/);
  assert.match(attachmentListText, /battery-spec\.pdf/);
  assert.match(attachmentListText, /material-notes\.txt/);
  const imagePreviewCount = await evaluate(cdp, "document.querySelectorAll('#material-list img').length");
  assert.ok(imagePreviewCount >= 1);
  await click(cdp, "[data-remove-material='button-photo.png']");
  await waitFor(cdp, "!document.querySelector('#material-list')?.textContent?.includes('button-photo.png')");

  await click(cdp, "[data-action='generate']");
  await waitFor(cdp, "document.querySelector('#preview-badge')?.textContent?.includes('생성 완료')", generationWaitMs);

  const previewText = await text(cdp, "#result-preview");
  assert.match(previewText, /저소음 한글 키보드/);
  assert.match(previewText, /스마트스토어|smartstore/);
  assert.match(previewText, /Codex adapter/);
  assert.match(previewText, /3\. 이미지 생성\/촬영 프롬프트/);

  await waitFor(cdp, "Boolean(document.querySelector('#result-preview img[src^=\"/outputs/image-runs/\"]'))");
  const generatedImageUrl = await evaluate(cdp, "document.querySelector('#result-preview img[src^=\"/outputs/image-runs/\"]')?.getAttribute('src')");
  const generatedImageFetch = await evaluate(cdp, `fetch(${JSON.stringify(baseUrl)} + ${JSON.stringify(generatedImageUrl)}).then((response) => response.status + ':' + response.headers.get('content-type'))`);
  const downloadName = await evaluate(cdp, "document.querySelector('.generated-image-card a[download]')?.getAttribute('download')");
  assert.match(generatedImageUrl, /^\/outputs\/image-runs\/.+product-main\.png/u);
  assert.equal(generatedImageFetch, "200:image/png");
  assert.equal(downloadName, "product-main.png");

  await click(cdp, "[data-export='json']");
  await waitFor(cdp, "document.querySelector('#export-output')?.value?.includes('저소음 한글 키보드')");
  const exportText = await value(cdp, "#export-output");
  const exportJson = new URL(`${evidencePrefix}-export.json`, evidenceDir);
  await writeFile(exportJson, exportText);
  const exportPayload = JSON.parse(exportText);
  const exportedImageUrls = exportPayload.result?.images?.files?.map((file) => file.url) ?? [];
  assert.match(exportText, /prompt delivered/);
  assert.match(exportText, /drag-shot\.png/);
  assert.match(exportText, /battery-spec\.pdf/);
  assert.match(exportText, /material-notes\.txt/);
  assert.match(exportText, /배터리 24개월 사용 가능/);
  assert.match(exportText, /codex-imagegen/);
  assert.match(exportText, /product-main\.png/);
  assert.match(exportText, /outputs\/image-runs/);
  assert.ok(exportedImageUrls.includes(generatedImageUrl), "JSON export must reference the same image run rendered in preview");
  assert.doesNotMatch(exportText, /button-photo\.png/);
  assert.doesNotMatch(exportText, /data:image/);
  assert.doesNotMatch(exportText, /sk-test-store-maker-secret/);
  if (process.env.STORE_MAKER_EXPECT_FALLBACK_MANIFEST === "1") {
    assert.equal(exportPayload.result?.images?.manifest?.fallback, true);
    assert.ok(exportPayload.logs?.some((log) => log.title === "image output recovered"));
    assert.ok(exportPayload.logs?.some((log) => log.title === "fallback manifest created"));
  }

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
      screenshots: [settingsDialog, desktop, tablet, mobile],
      exportJson: exportJson.pathname,
      observable: "actual Codex CLI ImageGen command completed through browser UI, rendered product-main image, download URL responded, and JSON export included image metadata",
    }, null, 2));
  } else {
    await click(cdp, "[data-action='open-settings']");
    await click(cdp, "[data-provider='codex']");
    await waitFor(cdp, "document.querySelector('#preview-badge')?.textContent?.includes('생성 전')");
    const providerSwitchExport = await value(cdp, "#export-output");
    const providerSwitchExportButtonsDisabled = await evaluate(cdp, "[...document.querySelectorAll('[data-export]')].every((button) => button.disabled)");
    assert.equal(providerSwitchExport, "");
    assert.equal(providerSwitchExportButtonsDisabled, true);

    await click(cdp, "[data-provider='custom']");
    await setValue(cdp, "#command", "definitely-missing-store-maker-cli");
    await setValue(cdp, "#timeout-ms", "");
    await click(cdp, "[data-action='close-settings']");
    await click(cdp, "[data-action='generate']");
    await waitFor(cdp, "document.querySelector('#preview-badge')?.textContent?.includes('생성 실패')", 15000);
    const staleExport = await value(cdp, "#export-output");
    const exportButtonsDisabled = await evaluate(cdp, "[...document.querySelectorAll('[data-export]')].every((button) => button.disabled)");
    assert.equal(staleExport, "");
    assert.equal(exportButtonsDisabled, true);

    await click(cdp, "[data-action='open-settings']");
    await setValue(cdp, "#command", "node scripts/mock-engine.mjs");
    await setValue(cdp, "#prompt-transport", "stdin");
    await click(cdp, "[data-action='close-settings']");
    await click(cdp, "[data-action='generate']");
    await waitFor(cdp, "document.querySelector('#preview-badge')?.textContent?.includes('생성 완료')", 15000);

    const desktop = await screenshot(cdp, `${evidencePrefix}-1280.png`);
    await setViewport(cdp, 768, 900);
    const tablet = await screenshot(cdp, `${evidencePrefix}-768.png`);
    await setViewport(cdp, 375, 900);
    const mobile = await screenshot(cdp, `${evidencePrefix}-375.png`);

    console.log(JSON.stringify({
      ok: true,
      url: baseUrl,
      screenshots: [settingsDialog, desktop, tablet, mobile],
      exportJson: exportJson.pathname,
      observable: "settings dialog opens, Codex local CLI adapter completes, Codex ImageGen output image renders, download URL responds, and JSON export includes image metadata",
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
  await cdp.call("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 640,
  });
}

async function click(cdp, selector) {
  await cdp.call("Runtime.evaluate", {
    expression: `document.querySelector(${JSON.stringify(selector)})?.click()`,
    awaitPromise: true,
  });
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

async function screenshot(cdp, name) {
  const result = await cdp.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
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
