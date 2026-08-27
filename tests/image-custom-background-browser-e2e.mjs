import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:4317";
const chromePath = await resolveChromePath();
const debugPort = 9522 + Math.floor(Math.random() * 200);
const userDataDir = await mkdtemp(join(tmpdir(), "store-maker-custom-background-"));
const screenshotDir = process.env.CUSTOM_BACKGROUND_SCREENSHOT_DIR;
const viewport = readViewport(process.env.CUSTOM_BACKGROUND_VIEWPORT);
const appendAfterSpace = process.env.CUSTOM_BACKGROUND_APPEND ?? "";
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
  const cdp = await connectCdp(await waitForWebSocketUrl(debugPort));
  await cdp.call("Page.enable");
  await cdp.call("Runtime.enable");
  if (viewport) await cdp.call("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1, mobile: false });
  await cdp.call("Page.navigate", { url: baseUrl });
  await waitFor(cdp, "document.readyState === 'complete'");

  await setValue(cdp, "#image-background", "사용자 지정");
  await waitFor(cdp, "!document.querySelector('#image-custom-background-field')?.classList.contains('is-hidden')");
  await evaluate(cdp, `(() => {
    const input = document.querySelector('#image-custom-background');
    window.__customBackgroundInputTrace = [];
    window.addEventListener('input', () => window.__customBackgroundInputTrace.push(input.value), true);
    input.focus();
    document.documentElement.style.scrollBehavior = 'auto';
    window.scrollTo(0, Math.max(0, input.getBoundingClientRect().top + window.scrollY - window.innerHeight / 2));
  })()`);
  await delay(100);
  await captureScreenshot(cdp, "before-input.png");

  await cdp.call("Input.insertText", { text: "이미지" });
  await cdp.call("Input.insertText", { text: " " });
  if (appendAfterSpace) await cdp.call("Input.insertText", { text: appendAfterSpace });

  const trace = await evaluate(cdp, "window.__customBackgroundInputTrace");
  const settledValue = await value(cdp, "#image-custom-background");
  const expectedValue = `이미지 ${appendAfterSpace}`;
  assert.equal(trace.at(-1), expectedValue, "the browser must receive typed spaces before app state updates");
  assert.equal(settledValue, expectedValue, "custom background must preserve spaces typed between Korean words");
  await captureScreenshot(cdp, "settled-input.png");
  console.log(`custom background space preserved: ${JSON.stringify(settledValue)}`);
} finally {
  await stopChrome(chrome);
  await rm(userDataDir, { recursive: true, force: true });
}

async function resolveChromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  throw new Error("Chrome executable was not found. Set CHROME_PATH to run this browser scenario.");
}

function connectCdp(wsUrl) {
  const socket = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (!payload.id) return;
    const entry = pending.get(payload.id);
    if (!entry) return;
    pending.delete(payload.id);
    payload.error ? entry.reject(new Error(payload.error.message)) : entry.resolve(payload.result);
  });
  return {
    async call(method, params = {}) {
      await new Promise((resolve, reject) => {
        if (socket.readyState === WebSocket.OPEN) return resolve();
        socket.addEventListener("open", resolve, { once: true });
        socket.addEventListener("error", reject, { once: true });
      });
      const id = nextId++;
      const response = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
      socket.send(JSON.stringify({ id, method, params }));
      return response;
    },
  };
}

async function waitForWebSocketUrl(port) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const payload = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
      const page = Array.isArray(payload) ? payload.find((target) => target.type === "page") : undefined;
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await delay(100);
  }
  throw new Error("Chrome DevTools endpoint did not start");
}

async function setValue(cdp, selector, nextValue) {
  await evaluate(cdp, `(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    input.value = ${JSON.stringify(nextValue)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
}

async function value(cdp, selector) {
  return evaluate(cdp, `document.querySelector(${JSON.stringify(selector)})?.value ?? ''`);
}

async function captureScreenshot(cdp, filename) {
  if (!screenshotDir) return;
  const { data } = await cdp.call("Page.captureScreenshot", { format: "png" });
  await writeFile(join(screenshotDir, filename), Buffer.from(data, "base64"));
}

function readViewport(value) {
  const match = /^(?<width>\d{2,4})x(?<height>\d{2,4})$/u.exec(value ?? "");
  return match ? { width: Number(match.groups.width), height: Number(match.groups.height) } : null;
}

async function evaluate(cdp, expression) {
  const result = await cdp.call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return result.result.value;
}

async function waitFor(cdp, expression) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, expression)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

async function stopChrome(childProcess) {
  if (childProcess.exitCode !== null || childProcess.signalCode !== null) return;
  const exited = new Promise((resolve) => childProcess.once("exit", resolve));
  childProcess.kill("SIGTERM");
  await Promise.race([exited, delay(3_000)]);
  if (childProcess.exitCode === null && childProcess.signalCode === null) childProcess.kill("SIGKILL");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
