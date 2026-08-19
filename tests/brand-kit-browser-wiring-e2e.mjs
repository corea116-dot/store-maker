import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createServer } from "../server.mjs";

// allow: SIZE_OK — this real-browser seller journey is one serialized CDP state sequence.
const evidence = process.env.STORE_MAKER_EVIDENCE_URL
  ? new URL(process.env.STORE_MAKER_EVIDENCE_URL)
  : new URL("../.omo/evidence/task-9-brand-kit-template-auto-apply/", import.meta.url);
const temp = await mkdtemp(join(tmpdir(), "store-maker-brand-wiring-"));
const chromeRoot = join(temp, "chrome");
const chromePath = await findChrome();
const debugPort = 9800 + Math.floor(Math.random() * 150);
const app = createServer({
  brandKitRegistryFile: join(temp, "registry.json"),
  brandAssetsDir: join(temp, "assets"),
  generationJobStateFile: join(temp, "jobs.json"),
  outputsDir: join(temp, "outputs"),
});
await mkdir(evidence, { recursive: true });
await listen(app);
const base = `http://127.0.0.1:${app.address().port}`;
const chrome = spawn(chromePath, [
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${chromeRoot}`,
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "about:blank",
], { stdio: "ignore" });

try {
  const cdp = await connect(await websocketUrl(debugPort));
  const pageErrors = [];
  cdp.on("Runtime.exceptionThrown", (event) => pageErrors.push(event.exceptionDetails?.exception?.description ?? event.exceptionDetails?.text ?? "runtime exception"));
  cdp.on("Runtime.consoleAPICalled", (event) => { if (event.type === "error") pageErrors.push(event.args?.map((item) => item.value ?? item.description).join(" ") ?? "console error"); });
  await cdp.call("Page.enable");
  await cdp.call("Runtime.enable");
  await cdp.call("Network.enable");
  await cdp.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.call("Page.navigate", { url: base });
  await wait(cdp, "document.readyState === 'complete' && window.storeMakerBrandKits?.getState().phase === 'ready'");
  await evaluate(cdp, `(() => {
    window.__brandKitRequests=[];
    window.__brandKitImageEdits=[];
    const original=window.fetch.bind(window);
    window.fetch=(input,options={}) => {
      const url=typeof input==='string' ? input : input.url;
      if (url==='/api/generate-jobs' && options.method==='POST') window.__brandKitRequests.push(JSON.parse(options.body));
      if (url==='/api/images/edit' && options.method==='POST') {
        window.__brandKitImageEdits.push(JSON.parse(options.body));
        return Promise.resolve(new Response(JSON.stringify({ok:true,logs:[],image:{url:'/outputs/generated-images/edited.png',filename:'edited.png',relativePath:'outputs/generated-images/edited.png',mimeType:'image/png'}}),{status:200,headers:{'content-type':'application/json'}}));
      }
      return original(input,options);
    };
  })()`);

  await set(cdp, "#product-name", "상품 A");
  await set(cdp, "#product-description", "상품 설명 보존");
  await set(cdp, "#product-requirements", "필수 요구사항 보존");
  await set(cdp, "#brand-url", "https://legacy.example/products");
  await set(cdp, "#command", "node scripts/mock-engine.mjs");
  await set(cdp, "#prompt-transport", "stdin");
  await evaluate(cdp, "document.querySelector(\"[data-image-provider='none']\").click()");

  const created = await evaluate(cdp, `(async () => {
    const token=document.querySelector("meta[name='store-maker-token']").content;
    const response=await fetch('/api/brand-kits',{method:'POST',headers:{'content-type':'application/json','x-store-maker-token':token},body:JSON.stringify({
      expectedRegistryRevision:0,setAsDefault:true,logoDataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
      kit:{schemaVersion:1,name:'기본 브랜드',sourceUrl:'https://brand.example/official',
        colors:{primary:'#111111',secondary:'#E8E8E8',accent:'#C24A2E',background:'#FFFFFF',surface:'#F5F5F5',text:'#111111'},
        typography:{displayFontId:'modern-sans-bold',bodyFontId:'readable-sans'},
        voice:{summary:'간결한 말투',dos:['근거 제시'],donts:['과장'],sample:'정확하게 안내합니다.'},
        imagery:{presetId:'custom',mood:'차분함',lighting:'부드러운 빛',composition:'제품 중심',background:'밝은 원목',colorTreatment:'중립',avoid:['네온']},
        defaults:{adMoodPreset:'premium',imageStyle:'라이프스타일컷',imageBackground:'사용자 지정'}}
    })});
    return {status:response.status,body:await response.json()};
  })()`);
  assert.equal(created.status, 201);
  await evaluate(cdp, "window.storeMakerBrandKits.reload()");
  await wait(cdp, "window.storeMakerBrandKits.getState().defaultId && document.querySelector('#image-style').value === '라이프스타일컷'");

  assert.deepEqual(await evaluate(cdp, `(() => ({
    selected:window.storeMakerBrandKits.getState().selection,
    source:document.querySelector('#brand-url').value,
    sourceReadOnly:document.querySelector('#brand-url').readOnly,
    mood:document.querySelector('#ad-mood-preset').value,
    style:document.querySelector('#image-style').value,
    background:document.querySelector('#image-background').value,
    custom:document.querySelector('#image-custom-background').value,
    product:[document.querySelector('#product-name').value,document.querySelector('#product-description').value,document.querySelector('#product-requirements').value],
  }))()`), {
    selected: { id: created.body.kit.id, enabled: true, overrides: {} },
    source: "https://brand.example/official",
    sourceReadOnly: true,
    mood: "premium",
    style: "라이프스타일컷",
    background: "사용자 지정",
    custom: "밝은 원목",
    product: ["상품 A", "상품 설명 보존", "필수 요구사항 보존"],
  });

  await set(cdp, "#image-style", "소셜 광고컷");
  await wait(cdp, "window.storeMakerBrandKits.getState().selection.overrides.imageStyle === '소셜 광고컷'");
  const beforeAccepted = await draft(cdp);
  await evaluate(cdp, "document.querySelector(\"[data-action='generate']\").click()");
  await wait(cdp, "window.__brandKitRequests?.length === 1 && window.storeMakerBrandKits.getState().selection.overrides.imageStyle === undefined");
  const firstRequest = await evaluate(cdp, "window.__brandKitRequests[0]");
  assert.deepEqual(firstRequest.brandKitSelection, { enabled: true, id: created.body.kit.id, expectedRevision: 1, overrides: { imageStyle: "소셜 광고컷" } });
  assert.equal(Object.hasOwn(firstRequest, "brandKitSnapshot"), false);
  assert.equal(Object.hasOwn(firstRequest, "effectiveBrandStyle"), false);
  assert.equal(JSON.stringify(firstRequest).includes("/Users/"), false);
  assert.equal(firstRequest.brand, undefined);
  assert.equal(firstRequest.adAutomation, undefined);
  assert.equal(beforeAccepted.style, "소셜 광고컷");
  assert.equal((await draft(cdp)).style, "라이프스타일컷");

  const secondKit = {
    schemaVersion: 1, name: "다음 기본 브랜드", sourceUrl: "https://next.example/brand",
    colors: { primary: "#202020", secondary: "#EFEFEF", accent: "#A04A32", background: "#FFFFFF", surface: "#F7F7F7", text: "#101010" },
    typography: { displayFontId: "editorial-serif-bold", bodyFontId: "readable-serif" },
    voice: { summary: "따뜻한 말투", dos: ["구체적으로"], donts: ["단정"], sample: "차분하게 소개합니다." },
    imagery: { presetId: "custom", mood: "따뜻함", lighting: "오전 자연광", composition: "넓은 여백", background: "크림 배경", colorTreatment: "웜톤", avoid: ["강한 대비"] },
    defaults: { adMoodPreset: "warm", imageStyle: "제품 단독컷", imageBackground: "흰 배경" },
  };
  const second = await evaluate(cdp, `(async () => {
    const token=document.querySelector("meta[name='store-maker-token']").content;
    const headers={'content-type':'application/json','x-store-maker-token':token};
    const registry=await fetch('/api/brand-kits',{headers}).then(r=>r.json());
    const created=await fetch('/api/brand-kits',{method:'POST',headers,body:JSON.stringify({expectedRegistryRevision:registry.registryRevision,setAsDefault:false,kit:${JSON.stringify(secondKit)}})}).then(async r=>({status:r.status,body:await r.json()}));
    const selected=await fetch('/api/brand-kits/'+created.body.kit.id+'/default',{method:'POST',headers,body:JSON.stringify({expectedRegistryRevision:created.body.registryRevision})}).then(async r=>({status:r.status,body:await r.json()}));
    return {created,selected};
  })()`);
  assert.equal(second.created.status, 201);
  assert.equal(second.selected.status, 200);
  await set(cdp, "#image-style", "상세페이지 배너");
  await evaluate(cdp, "document.querySelector(\"[data-action='generate']\").click()");
  await wait(cdp, `window.__brandKitRequests?.length === 2 && window.storeMakerBrandKits.getState().selection.id === ${JSON.stringify(second.created.body.kit.id)}`);
  assert.deepEqual(await evaluate(cdp, "window.__brandKitRequests[1].brandKitSelection"), { enabled: true, id: created.body.kit.id, expectedRevision: 1, overrides: { imageStyle: "상세페이지 배너" } });
  assert.deepEqual(await evaluate(cdp, `({source:document.querySelector('#brand-url').value,mood:document.querySelector('#ad-mood-preset').value,style:document.querySelector('#image-style').value})`), { source: "https://next.example/brand", mood: "warm", style: "제품 단독컷" });

  await evaluate(cdp, "document.querySelector(\"input[name='generation-mode'][value='ad-set']\").click()");
  await wait(cdp, "!document.querySelector('#ad-options-panel').classList.contains('is-hidden')");
  await evaluate(cdp, "document.querySelector('#brand-url').value='https://attacker.example/tampered'");
  await evaluate(cdp, "document.querySelector(\"[data-action='generate']\").click()");
  await wait(cdp, "window.__brandKitRequests?.length === 3");
  const brandedAd = await evaluate(cdp, "window.__brandKitRequests[2]");
  assert.equal(brandedAd.brand, undefined);
  assert.equal(brandedAd.adAutomation.moodPreset, "warm");
  assert.equal(brandedAd.brandKitSelection.id, second.created.body.kit.id);
  await new Promise((resolve) => setTimeout(resolve, 300));

  await evaluate(cdp, "document.querySelector('#brand-kit-enabled').click()");
  await wait(cdp, "!window.storeMakerBrandKits.getState().selection.enabled && !document.querySelector('#brand-url').readOnly");
  assert.equal(await evaluate(cdp, "document.querySelector('#brand-url').value"), "https://legacy.example/products");
  await evaluate(cdp, "document.querySelector(\"[data-action='generate']\").click()");
  await wait(cdp, "window.__brandKitRequests?.length === 4");
  const unbrandedAd = await evaluate(cdp, "window.__brandKitRequests[3]");
  assert.deepEqual(unbrandedAd.brandKitSelection, { enabled: false });
  assert.deepEqual(unbrandedAd.brand, { url: "https://legacy.example/products" });

  await new Promise((resolve) => setTimeout(resolve, 300));
  await wait(cdp, "window.storeMakerBrandKits.getState().selection.enabled");
  await set(cdp, "#image-style", "사용 장면");
  const staleDraft = await draft(cdp);
  const externalUpdate = await evaluate(cdp, `(async () => { const s=window.storeMakerBrandKits.getState(); const k=s.kits.find(x=>x.id===s.selection.id); const token=document.querySelector("meta[name='store-maker-token']").content; const response=await fetch('/api/brand-kits/'+k.id,{method:'PUT',headers:{'content-type':'application/json','x-store-maker-token':token},body:JSON.stringify({expectedRevision:k.revision,kit:{schemaVersion:1,name:k.name+' 수정',sourceUrl:k.sourceUrl,colors:k.colors,typography:k.typography,voice:k.voice,imagery:k.imagery,defaults:k.defaults},logoChange:{action:'keep'}})}); return {status:response.status,body:await response.json()}; })()`);
  assert.equal(externalUpdate.status, 200, JSON.stringify(externalUpdate.body));
  await evaluate(cdp, "document.querySelector(\"[data-action='generate']\").click()");
  await wait(cdp, "window.__brandKitRequests?.length === 5");
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(await draft(cdp), staleDraft);
  await evaluate(cdp, "window.storeMakerBrandKits.reload()");
  await wait(cdp, "window.storeMakerBrandKits.getState().kits.find(k=>k.id===window.storeMakerBrandKits.getState().selection.id).revision === 2");
  await evaluate(cdp, "document.querySelector(\"[data-action='generate']\").click()");
  await wait(cdp, "window.__brandKitRequests?.length === 6 && Object.keys(window.storeMakerBrandKits.getState().selection.overrides).length === 0");

  const token = await evaluate(cdp, "document.querySelector(\"meta[name='store-maker-token']\").content");
  const originalJob = await waitForJob(base, token, (job) => job.status === "completed" && job.result?.brandKitSnapshot?.id === created.body.kit.id);
  assert.equal(originalJob.result.brandKitSnapshot.revision, 1);
  assert.equal(originalJob.result.brandKitSnapshot.logo.url.startsWith("/outputs/brand-assets/"), true);
  assert.equal(originalJob.result.brandKitSnapshot.revision, 1);
  assert.deepEqual(originalJob.result.exports.json.brandKitSnapshot, originalJob.result.brandKitSnapshot);
  await evaluate(cdp, "document.querySelector(\"[data-action='refresh-jobs']\").click()");
  await wait(cdp, `document.querySelector('[data-job-id=${JSON.stringify(originalJob.id)}]') !== null`);
  await evaluate(cdp, `document.querySelector('[data-job-id=${JSON.stringify(originalJob.id)}]').click()`);
  await wait(cdp, "document.querySelector('#preview-badge').textContent === '생성 완료'");

  await evaluate(cdp, `(async () => { const token=document.querySelector("meta[name='store-maker-token']").content; const headers={'content-type':'application/json','x-store-maker-token':token}; const r=await fetch('/api/brand-kits',{headers}).then(x=>x.json()); const k=r.kits.find(x=>x.id===${JSON.stringify(created.body.kit.id)}); await fetch('/api/brand-kits/'+k.id+'/delete',{method:'POST',headers,body:JSON.stringify({expectedRevision:k.revision,expectedRegistryRevision:r.registryRevision})}); })()`);
  const reopened = await fetch(`${base}/api/generate-jobs/${originalJob.id}`, { headers: { "x-store-maker-token": token } }).then((response) => response.json());
  assert.equal(reopened.job.result.brandKitSnapshot.revision, 1);
  assert.equal(reopened.job.result.brandKitSnapshot.logo.url, originalJob.result.brandKitSnapshot.logo.url);

  const beforeRegenerate = await evaluate(cdp, "window.__brandKitRequests.length");
  await evaluate(cdp, `(() => { const button=document.createElement('button'); button.type='button'; button.dataset.action='regenerate-images'; document.body.append(button); button.click(); button.remove(); })()`);
  await wait(cdp, `window.__brandKitRequests.length === ${beforeRegenerate + 1}`);
  const regenerate = await evaluate(cdp, `window.__brandKitRequests[${beforeRegenerate}]`);
  assert.deepEqual(regenerate.brandKitSelection, { enabled: true, id: second.created.body.kit.id, expectedRevision: 2, overrides: {} });
  await new Promise((resolve) => setTimeout(resolve, 300));
  await evaluate(cdp, `(() => { const button=document.createElement('button'); button.type='button'; button.dataset.action='open-generated-image'; button.dataset.imageUrl='/outputs/generated-images/source.png'; button.dataset.imageFilename='source.png'; button.dataset.imageType='image/png'; document.body.append(button); button.click(); button.remove(); document.querySelector('#image-edit-instruction').value='배경을 더 밝게'; document.querySelector("[data-action='edit-generated-image']").click(); })()`);
  await wait(cdp, "window.__brandKitImageEdits.length === 1");
  const imageEdit = await evaluate(cdp, "window.__brandKitImageEdits[0]");
  assert.deepEqual(imageEdit.brandKitSelection, { enabled: true, id: second.created.body.kit.id, expectedRevision: 2, overrides: {} });
  assert.equal(Object.hasOwn(imageEdit, "brandKitSnapshot"), false);
  await evaluate(cdp, "document.querySelector(\"[data-action='close-image-viewer']\").click()");
  await wait(cdp, "document.querySelector('#image-viewer-dialog').classList.contains('is-hidden')");
  await new Promise((resolve) => setTimeout(resolve, 1900));

  for (const [width, name] of [[1280, "brand-kit-task9-1280.png"], [768, "brand-kit-task9-768.png"], [375, "brand-kit-task9-375.png"]]) {
    await cdp.call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await evaluate(cdp, "document.querySelector('#brand-kit-panel').scrollIntoView({block:'start'})");
    const shot = await cdp.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(new URL(name, evidence), Buffer.from(shot.data, "base64"));
    assert.equal(await evaluate(cdp, "document.documentElement.scrollWidth <= innerWidth"), true);
  }

  await set(cdp, "#image-style", "프리미엄 클로즈업");
  const networkDraft = await draft(cdp);
  const beforeNetwork = await evaluate(cdp, "window.__brandKitRequests.length");
  await close(app);
  await evaluate(cdp, "document.querySelector(\"[data-action='generate']\").click()");
  await wait(cdp, `window.__brandKitRequests.length === ${beforeNetwork + 1}`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(await draft(cdp), networkDraft);
  await evaluate(cdp, "window.storeMakerBrandKits.reload()");
  await wait(cdp, "window.storeMakerBrandKits.getState().phase === 'error'");
  assert.equal(await evaluate(cdp, "[...document.querySelectorAll(\"[data-action='generate']\")].every(button=>button.disabled)"), true);
  const blockedCount = await evaluate(cdp, "window.__brandKitRequests.length");
  await evaluate(cdp, "document.querySelector(\"[data-action='generate']\").click()");
  assert.equal(await evaluate(cdp, "window.__brandKitRequests.length"), blockedCount);
  const persisted = await evaluate(cdp, "JSON.stringify(localStorage)");
  assert.doesNotMatch(persisted, /brandKit|next\.example|따뜻한 말투|프리미엄 클로즈업/u);

  assert.deepEqual(pageErrors, []);
  await writeFile(new URL("focused-e2e.json", evidence), JSON.stringify({
    ok: true,
    scenario: "registry readiness, current-default reset, one-shot overrides, authoritative source, legacy unbranded source, stale/network preservation, fresh regenerate and image edit, immutable historical snapshot",
    requests: { firstRequest, brandedAd, unbrandedAd, regenerate, imageEdit },
    historicalSnapshot: {
      jobId: originalJob.id,
      revision: reopened.job.result.brandKitSnapshot.revision,
      logoUrl: reopened.job.result.brandKitSnapshot.logo.url,
      exportMatches: true,
    },
    viewports: [[1280, 900], [768, 900], [375, 900]],
    privateFieldsAbsent: true,
    productFieldsPreserved: true,
    pageErrors,
  }, null, 2));
} finally {
  chrome.kill("SIGTERM");
  if (chrome.exitCode === null) await Promise.race([new Promise((resolve) => chrome.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 1000))]);
  await close(app);
  await new Promise((resolve) => setTimeout(resolve, 200));
  await rm(temp, { recursive: true, force: true });
}

async function draft(cdp) {
  return evaluate(cdp, `({
    source:document.querySelector('#brand-url').value,
    mood:document.querySelector('#ad-mood-preset').value,
    style:document.querySelector('#image-style').value,
    background:document.querySelector('#image-background').value,
    custom:document.querySelector('#image-custom-background').value,
    state:window.storeMakerBrandKits.getState().selection,
  })`);
}

async function set(cdp, selector, value) {
  await evaluate(cdp, `(() => { const node=document.querySelector(${JSON.stringify(selector)}); node.value=${JSON.stringify(value)}; node.dispatchEvent(new Event('input',{bubbles:true})); node.dispatchEvent(new Event('change',{bubbles:true})); })()`);
}

async function listen(server, port = 0) { await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); }); }
async function close(server) { if (!server.listening) return; await new Promise((resolve) => server.close(resolve)); }
async function waitForJob(baseUrl, token, predicate) { let observed = []; for (let i = 0; i < 200; i += 1) { const headers = { "x-store-maker-token": token }; const payload = await fetch(`${baseUrl}/api/generate-jobs`, { headers }).then((response) => response.json()); observed = []; for (const summary of payload.jobs ?? []) { const job = await fetch(`${baseUrl}/api/generate-jobs/${summary.id}`, { headers }).then((response) => response.json()).then((value) => value.job); observed.push({ id: job.id, status: job.status, brand: job.result?.brandKitSnapshot?.id, error: job.result?.error?.code }); if (predicate(job)) return job; } await new Promise((resolve) => setTimeout(resolve, 100)); } throw new Error(`Timed out waiting for terminal brand-kit job: ${JSON.stringify(observed)}`); }
async function findChrome() { for (const path of [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"].filter(Boolean)) { try { await access(path, constants.X_OK); return path; } catch {} } throw new Error("Chrome not found"); }
async function websocketUrl(port) { for (let i = 0; i < 100; i += 1) { try { const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json()); const page = list.find((item) => item.type === "page"); if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl; } catch {} await new Promise((resolve) => setTimeout(resolve, 100)); } throw new Error("Chrome CDP unavailable"); }
async function connect(url) { const socket = new WebSocket(url); await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); }); let id = 0; const pending = new Map(); const listeners = new Map(); socket.addEventListener("message", (event) => { const message = JSON.parse(event.data); if (message.id) { const waiter = pending.get(message.id); pending.delete(message.id); if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result); return; } for (const listener of listeners.get(message.method) ?? []) listener(message.params); }); return { call(method, params = {}) { id += 1; return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); }); }, on(method, listener) { listeners.set(method, [...(listeners.get(method) ?? []), listener]); } }; }
async function evaluate(cdp, expression) { const result = await cdp.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result.value; }
async function wait(cdp, expression) { for (let i = 0; i < 160; i += 1) { if (await evaluate(cdp, `Boolean(${expression})`)) return; await new Promise((resolve) => setTimeout(resolve, 100)); } throw new Error(`Timed out: ${expression}`); }
