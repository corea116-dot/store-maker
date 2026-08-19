import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createServer } from "../server.mjs";

const evidence = process.env.STORE_MAKER_EVIDENCE_URL
  ? new URL(process.env.STORE_MAKER_EVIDENCE_URL)
  : new URL("../.omx/logs/", import.meta.url);
const temp = await mkdtemp(join(tmpdir(), "store-maker-brand-ui-"));
const chromeRoot = join(temp, "chrome");
const logoPath = join(temp, "logo.png");
const chromePath = await findChrome();
const debugPort = 9500 + Math.floor(Math.random() * 300);
const app = createServer({ brandKitRegistryFile: join(temp, "registry.json"), brandAssetsDir: join(temp, "assets"), generationJobStateFile: join(temp, "jobs.json") });
await mkdir(evidence, { recursive: true });
await writeFile(logoPath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64"));
await listen(app);
const { port } = app.address();
const base = `http://127.0.0.1:${port}`;
const chrome = spawn(chromePath, [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${chromeRoot}`, "--headless=new", "--disable-gpu", "--no-first-run", "about:blank"], { stdio: "ignore" });

try {
  const cdp = await connect(await websocketUrl(debugPort));
  const pageErrors = [];
  const expectedResourceFailures = [];
  cdp.on("Runtime.exceptionThrown", (event) => pageErrors.push(event.exceptionDetails?.text ?? "runtime exception"));
  cdp.on("Log.entryAdded", (event) => { if (event.entry?.level === "error") expectedResourceFailures.push(event.entry.text); });
  cdp.on("Runtime.consoleAPICalled", (event) => { if (event.type === "error") pageErrors.push(event.args?.map((item) => item.value ?? item.description).join(" ") ?? "console error"); });
  await cdp.call("Page.enable"); await cdp.call("Runtime.enable"); await cdp.call("DOM.enable"); await cdp.call("Log.enable"); await cdp.call("Accessibility.enable"); await cdp.call("Performance.enable");
  await viewport(cdp, 1280, 900); await cdp.call("Page.navigate", { url: base });
  await wait(cdp, "document.readyState === 'complete' && document.querySelector('#brand-kit-panel')?.dataset.phase === 'ready'");
  await evaluate(cdp, `(() => { document.querySelector('#product-name').value='보존 상품'; document.querySelector('#product-description').value='수정 금지'; document.querySelector('#brand-kit-create').click(); })()`);
  await wait(cdp, "!document.querySelector('#brand-kit-dialog').classList.contains('is-hidden')");
  assert.deepEqual(await evaluate(cdp, `(() => { const helps=[...document.querySelectorAll('#brand-kit-editor .brand-kit-field-help[id]')]; const controls=[...document.querySelectorAll('#brand-kit-editor [aria-describedby*="brand-kit-help-"]')]; const valid=controls.every((control)=>control.getAttribute('aria-describedby').split(/\\s+/).filter((id)=>id.startsWith('brand-kit-help-')).every((id)=>document.getElementById(id)?.textContent.trim())); return {overview:document.querySelector('#brand-kit-usage-title').textContent==='입력한 값은 이렇게 쓰여요',helpCount:helps.length,helpedControls:controls.length,valid,background:document.querySelector('#brand-kit-help-color-background').textContent.includes('전체 바탕'),surface:document.querySelector('#brand-kit-help-color-surface').textContent.includes('카드, 섹션')}; })()`), { overview: true, helpCount: 25, helpedControls: 32, valid: true, background: true, surface: true });
  await set(cdp, "#brand-kit-name", "창이 브랜드"); await set(cdp, "#brand-kit-source-url", "https://example.com/brand");
  await set(cdp, "#brand-kit-voice-summary", "간결하고 정확하게 말합니다."); await set(cdp, "#brand-kit-voice-dos", "근거 제시"); await set(cdp, "#brand-kit-voice-donts", "과장"); await set(cdp, "#brand-kit-voice-sample", "매일 쓰는 도구입니다.");
  await set(cdp, "#brand-kit-mood", "차분한 분위기"); await set(cdp, "#brand-kit-lighting", "부드러운 빛"); await set(cdp, "#brand-kit-composition", "제품 중심"); await set(cdp, "#brand-kit-background", "밝은 배경"); await set(cdp, "#brand-kit-color-treatment", "중립 색감"); await set(cdp, "#brand-kit-avoid", "과한 네온");
  await files(cdp, "#brand-kit-logo-input", [logoPath]);
  await evaluate(cdp, "document.querySelector('#brand-kit-editor').requestSubmit()");
  await wait(cdp, "window.storeMakerBrandKits.getState().kits.length === 1 && window.storeMakerBrandKits.getState().defaultId");
  assert.equal(await evaluate(cdp, "document.querySelector('#brand-kit-preview-logo').getAttribute('src')?.startsWith('/outputs/brand-assets/')"), true);
  assert.equal(await evaluate(cdp, "document.querySelector('#brand-kit-preview-heading').textContent"), "창이 브랜드");
  const previewTypography = await evaluate(cdp, `(() => { const preview=document.querySelector('#brand-kit-preview'); const body=document.querySelector('#brand-kit-preview-body'); const probe=document.createElement('span'); probe.style.fontFamily='var(--brand-body-font)'; preview.append(probe); const result={classApplied:body.classList.contains('brand-kit-preview-body'),bodyFont:getComputedStyle(body).fontFamily,expectedFont:getComputedStyle(probe).fontFamily}; probe.remove(); return result; })()`);
  assert.equal(previewTypography.classApplied, true, JSON.stringify(previewTypography));
  assert.equal(previewTypography.bodyFont, previewTypography.expectedFont, JSON.stringify(previewTypography));
  await screenshot(cdp, "brand-kit-task8-1280.png", 1280, 900);
  await screenshot(cdp, "brand-kit-task8-default-1280.png", 1280, 900);
  await viewport(cdp, 375, 900); await screenshot(cdp, "brand-kit-task8-default-375.png", 375, 900); await assertCjkLayout(cdp);
  await viewport(cdp, 1280, 900); await evaluate(cdp, "document.querySelector('#brand-kit-close').click()"); await wait(cdp, "document.querySelector('#brand-kit-dialog').classList.contains('is-hidden')");
  await showPanel(cdp); await screenshot(cdp, "brand-kit-task8-selector-ready-default-1280.png", 1280, 900);
  await viewport(cdp, 375, 900); await showPanel(cdp); await screenshot(cdp, "brand-kit-task8-selector-ready-default-375.png", 375, 900);
  await viewport(cdp, 1280, 900); await evaluate(cdp, "document.querySelector('#brand-kit-enabled').click()"); await wait(cdp, "!window.storeMakerBrandKits.getState().selection.enabled"); await showPanel(cdp); await screenshot(cdp, "brand-kit-task8-selector-disabled-1280.png", 1280, 900);
  await evaluate(cdp, "document.querySelector('#brand-kit-enabled').click(); window.storeMakerBrandKits.controlChanged('imageStyle','소셜 광고컷')"); await wait(cdp, "!document.querySelector('#brand-kit-override').classList.contains('is-hidden')"); await showPanel(cdp); await screenshot(cdp, "brand-kit-task8-selector-dirty-1280.png", 1280, 900);
  await evaluate(cdp, "document.querySelector('#brand-kit-reset-overrides').click(); scrollTo(0,0); document.querySelector('#brand-kit-manage').click()"); await wait(cdp, "!document.querySelector('#brand-kit-dialog').classList.contains('is-hidden')");
  await cdp.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  assert.equal(await evaluate(cdp, "getComputedStyle(document.querySelector('#brand-kit-dialog')).animationName"), "none");
  await viewport(cdp, 375, 900); await screenshot(cdp, "brand-kit-task8-reduced-motion-375.png", 375, 900);
  await viewport(cdp, 1280, 900); await screenshot(cdp, "brand-kit-task8-reduced-motion-1280.png", 1280, 900);
  await cdp.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
  await new Promise((resolve) => setTimeout(resolve, 200));
  await evaluate(cdp, "document.querySelector('#brand-kit-dialog').focus()"); await pressTab(cdp);
  assert.deepEqual(await evaluate(cdp, `(() => { const control=document.querySelector('#brand-kit-close'); return {active:document.activeElement===control,visible:control.matches(':focus-visible'),ring:getComputedStyle(control).boxShadow!=='none'}; })()`), { active: true, visible: true, ring: true });
  await screenshot(cdp, "brand-kit-task8-focus-1280.png", 1280, 900);
  await viewport(cdp, 375, 900); await evaluate(cdp, "document.scrollingElement.scrollTop=0; document.body.scrollTop=0; document.querySelector('#brand-kit-dialog-body').scrollTop=0; document.querySelector('#brand-kit-close').focus()"); await new Promise((resolve) => setTimeout(resolve, 200)); await screenshot(cdp, "brand-kit-task8-focus-375.png", 375, 900);
  assert.equal(await evaluate(cdp, "document.querySelector('.brand-kit-dialog-actions').getBoundingClientRect().width === document.querySelector('.brand-kit-dialog-foot').clientWidth - 32"), true);
  await viewport(cdp, 1280, 900);

  await captureScrolledDialog(cdp, "brand-kit-task8-scrolled-1280.png", 1280, 900);
  await viewport(cdp, 768, 900); await captureScrolledDialog(cdp, "brand-kit-task8-scrolled-768.png", 768, 900); await assertTabletFooter(cdp);
  await viewport(cdp, 375, 900); await captureScrolledDialog(cdp, "brand-kit-task8-scrolled-375.png", 375, 900);
  await viewport(cdp, 1280, 900); await evaluate(cdp, "document.querySelector('#brand-kit-dialog-body').scrollTop=0");

  await set(cdp, "#brand-kit-name", "창이 브랜드 수정"); await evaluate(cdp, "document.querySelector('#brand-kit-editor').requestSubmit()");
  await wait(cdp, "window.storeMakerBrandKits.getState().kits[0].revision === 2");
  await evaluate(cdp, "document.querySelector('#brand-kit-duplicate').click()"); await wait(cdp, "window.storeMakerBrandKits.getState().kits.length === 2");
  await evaluate(cdp, "document.querySelector('#brand-kit-set-default').click()"); await wait(cdp, "window.storeMakerBrandKits.getState().defaultId === window.storeMakerBrandKits.getState().dialog.draft.id");

  await set(cdp, "#brand-kit-name", ""); await evaluate(cdp, "document.querySelector('#brand-kit-editor').requestSubmit()");
  await wait(cdp, "document.querySelector('#brand-kit-name').getAttribute('aria-invalid') === 'true'");
  assert.equal(await evaluate(cdp, "document.activeElement === document.querySelector('#brand-kit-name')"), true);
  await showAtDialogBodyTop(cdp, "#brand-kit-name"); await screenshot(cdp, "brand-kit-task8-validation-1280.png", 1280, 900);
  await viewport(cdp, 375, 900); await showAtDialogBodyTop(cdp, "#brand-kit-name"); await screenshot(cdp, "brand-kit-task8-validation-375.png", 375, 900);
  await viewport(cdp, 1280, 900);
  await set(cdp, "#brand-kit-name", "창이 브랜드 수정 복사본"); await set(cdp, "[name='colors.primary.hex']", "#GGGGGG"); await evaluate(cdp, "document.querySelector('#brand-kit-editor').requestSubmit()");
  await wait(cdp, "document.querySelector('[name=\"colors.primary.hex\"]').getAttribute('aria-invalid') === 'true'");
  assert.deepEqual(await evaluate(cdp, `(() => { const input=document.querySelector('[name="colors.primary.hex"]'); const descriptions=input.getAttribute('aria-describedby').split(/\\s+/); return {focused:document.activeElement===input,help:descriptions.includes('brand-kit-help-color-primary'),error:descriptions.includes('brand-kit-error-color-primary'),message:document.querySelector('#brand-kit-error-color-primary').textContent.includes('#RRGGBB')}; })()`), { focused: true, help: true, error: true, message: true });
  await assertColorErrorContextVisible(cdp); await screenshot(cdp, "brand-kit-task8-validation-colors-1280.png", 1280, 900);
  await viewport(cdp, 375, 900); await evaluate(cdp, "document.querySelector('#brand-kit-editor').requestSubmit()"); await wait(cdp, "document.querySelector('[name=\"colors.primary.hex\"]').getAttribute('aria-invalid') === 'true'"); await assertColorErrorContextVisible(cdp); await screenshot(cdp, "brand-kit-task8-validation-colors-375.png", 375, 900);
  await viewport(cdp, 1280, 900); await set(cdp, "[name='colors.primary.hex']", "#111111");
  await set(cdp, "#brand-kit-name", "충돌 보존 초안");
  const secondTabPage = await newPage(debugPort, base);
  const secondTab = secondTabPage.cdp;
  await secondTab.call("Runtime.enable");
  await wait(secondTab, "document.readyState === 'complete' && window.storeMakerBrandKits?.getState().phase === 'ready'");
  const secondTabUpdate = await evaluate(secondTab, `(async () => { const s=window.storeMakerBrandKits.getState(); const k=s.kits.find(x=>x.name.includes('복사본')); const h={'content-type':'application/json','x-store-maker-token':document.querySelector('meta[name="store-maker-token"]').content}; const response=await fetch('/api/brand-kits/'+k.id,{method:'PUT',headers:h,body:JSON.stringify({expectedRevision:k.revision,kit:{schemaVersion:1,name:'서버 변경본',sourceUrl:k.sourceUrl,colors:k.colors,typography:k.typography,voice:k.voice,imagery:k.imagery,defaults:k.defaults},logoChange:{action:'keep'}})}); return response.status; })()`);
  assert.equal(secondTabUpdate, 200);
  secondTab.close();
  await closePage(debugPort, secondTabPage.targetId);
  await evaluate(cdp, "document.querySelector('#brand-kit-editor').requestSubmit()"); await wait(cdp, "!document.querySelector('#brand-kit-conflict').classList.contains('is-hidden')");
  assert.equal(await evaluate(cdp, "document.querySelector('#brand-kit-name').value"), "충돌 보존 초안");
  assert.match(await evaluate(cdp, "document.querySelector('#brand-kit-current-copy').textContent"), /서버 변경본/u);
  assert.doesNotMatch(await evaluate(cdp, "getComputedStyle(document.querySelector('#brand-kit-current-copy')).overflowY"), /auto|scroll/u);
  await showAtDialogBodyTop(cdp, "#brand-kit-conflict"); await screenshot(cdp, "brand-kit-task8-conflict-1280.png", 1280, 900);
  await viewport(cdp, 375, 900); await showAtDialogBodyTop(cdp, "#brand-kit-conflict"); await assertCjkLayout(cdp); await screenshot(cdp, "brand-kit-task8-conflict-375.png", 375, 900);
  await viewport(cdp, 1280, 900);

  const focus = await evaluate(cdp, `(() => { window.confirm=()=>true; const d=document.querySelector('#brand-kit-dialog'); const before=document.body.classList.contains('brand-kit-dialog-open') && [...document.body.children].filter(n=>n!==d&&n.id!=='brand-kit-dialog-overlay').every(n=>n.inert); document.querySelector('#brand-kit-close').click(); return before; })()`);
  assert.equal(focus, true);
  await wait(cdp, "document.querySelector('#brand-kit-dialog').classList.contains('is-hidden')");
  assert.equal(await evaluate(cdp, "document.activeElement === document.querySelector('#brand-kit-manage')"), true);
  assert.deepEqual(await evaluate(cdp, `({summary:!document.querySelector('#brand-kit-summary').classList.contains('is-hidden'),swatches:document.querySelectorAll('#brand-kit-summary-swatches .brand-kit-swatch').length,logo:document.querySelector('#brand-kit-summary-logo').getAttribute('src')?.startsWith('/outputs/brand-assets/'),alternate:document.querySelector('#brand-kit-default-badge').classList.contains('is-hidden')})`), { summary: true, swatches: 6, logo: true, alternate: true });
  assert.deepEqual(await evaluate(cdp, "({name:document.querySelector('#product-name').value,description:document.querySelector('#product-description').value,locked:!document.body.classList.contains('brand-kit-dialog-open')})"), { name: "보존 상품", description: "수정 금지", locked: true });

  await cdp.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await viewport(cdp, 768, 900); await evaluate(cdp, "document.querySelector('#brand-kit-manage').click()"); await wait(cdp, "!document.querySelector('#brand-kit-dialog').classList.contains('is-hidden')"); await settledScreenshot(cdp, "brand-kit-task8-768.png", 768, 900); await assertLayout(cdp);
  await viewport(cdp, 375, 900); await settledScreenshot(cdp, "brand-kit-task8-375.png", 375, 900); await assertLayout(cdp);
  await cdp.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
  const oneScrollOwner = await evaluate(cdp, `(() => { const d=document.querySelector('#brand-kit-dialog'); const b=document.querySelector('#brand-kit-dialog-body'); return {body:getComputedStyle(b).overflowY, dialog:getComputedStyle(d).overflowY, footer:document.querySelector('#brand-kit-save').getBoundingClientRect().bottom<=innerHeight}; })()`);
  assert.match(oneScrollOwner.body, /auto|scroll/u); assert.doesNotMatch(oneScrollOwner.dialog, /auto|scroll/u); assert.equal(oneScrollOwner.footer, true);
  assert.deepEqual(await evaluate(cdp, `(() => { const close=document.querySelector('#brand-kit-close'); const save=document.querySelector('#brand-kit-save'); save.focus(); save.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true})); const forward=document.activeElement===close; close.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true})); return {forward,backward:document.activeElement===save}; })()`), { forward: true, backward: true });
  await set(cdp, "#brand-kit-name", "저장하지 않은 이름");
  assert.equal(await evaluate(cdp, `(() => { window.confirm=()=>false; document.querySelector('#brand-kit-dialog').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); return !document.querySelector('#brand-kit-dialog').classList.contains('is-hidden'); })()`), true);
  await evaluate(cdp, "window.confirm=()=>true; document.querySelector('#brand-kit-dialog').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
  await wait(cdp, "document.querySelector('#brand-kit-dialog').classList.contains('is-hidden')");

  await close(app); await evaluate(cdp, "window.storeMakerBrandKits.reload()"); await wait(cdp, "document.querySelector('#brand-kit-panel').dataset.phase === 'error'");
  assert.equal(await evaluate(cdp, "document.querySelector('#brand-kit-select').disabled && !document.querySelector('#brand-kit-retry').classList.contains('is-hidden')"), true);
  assert.equal(await evaluate(cdp, "window.storeMakerBrandKits.getBlocker()"), "brand-kit-load-failed");
  await viewport(cdp, 1280, 900); await showPanel(cdp); await screenshot(cdp, "brand-kit-task8-selector-load-error-1280.png", 1280, 900);
  await viewport(cdp, 375, 900); await showPanel(cdp); await screenshot(cdp, "brand-kit-task8-selector-load-error-375.png", 375, 900);
  await listen(app, port); await evaluate(cdp, "document.querySelector('#brand-kit-retry').click()"); await wait(cdp, "document.querySelector('#brand-kit-panel').dataset.phase === 'ready'");
  await evaluate(cdp, "scrollTo(0,0); document.querySelector('#brand-kit-manage').click()"); await wait(cdp, "!document.querySelector('#brand-kit-dialog').classList.contains('is-hidden')");
  await new Promise((resolve) => setTimeout(resolve, 200));
  await evaluate(cdp, "document.querySelector('#brand-kit-delete').click()"); await wait(cdp, "!document.querySelector('#brand-kit-delete-confirmation').classList.contains('is-hidden')");
  await showAtDialogBodyTop(cdp, "#brand-kit-delete-confirmation"); await screenshot(cdp, "brand-kit-task8-delete-confirm-375.png", 375, 900); await viewport(cdp, 1280, 900); await showAtDialogBodyTop(cdp, "#brand-kit-delete-confirmation"); await screenshot(cdp, "brand-kit-task8-delete-confirm-1280.png", 1280, 900); await viewport(cdp, 375, 900);
  await set(cdp, "#brand-kit-delete-name-input", "틀린 이름"); await evaluate(cdp, "document.querySelector('#brand-kit-delete-confirm').click()"); await wait(cdp, "document.querySelector('#brand-kit-dialog-status').textContent.includes('일치하지 않아')");
  assert.equal(await evaluate(cdp, "window.storeMakerBrandKits.getState().kits.length"), 2);
  await set(cdp, "#brand-kit-delete-name-input", await evaluate(cdp, "window.storeMakerBrandKits.getState().dialog.draft.name")); await evaluate(cdp, "document.querySelector('#brand-kit-delete-confirm').click()"); await wait(cdp, "window.storeMakerBrandKits.getState().kits.length === 1");
  const accessibility = await cdp.call("Accessibility.getFullAXTree");
  const interactiveRoles = new Set(["button", "checkbox", "combobox", "dialog", "link", "textbox"]);
  const unnamedInteractive = accessibility.nodes.filter((node) => !node.ignored && interactiveRoles.has(node.role?.value) && !node.name?.value).map((node) => ({ role: node.role.value, backendDOMNodeId: node.backendDOMNodeId }));
  assert.deepEqual(unnamedInteractive, []);
  const performanceResult = await cdp.call("Performance.getMetrics");
  const performance = Object.fromEntries(performanceResult.metrics.filter((metric) => ["TaskDuration", "JSHeapUsedSize", "Nodes", "LayoutCount", "RecalcStyleCount"].includes(metric.name)).map((metric) => [metric.name, metric.value]));
  assert.equal(Object.values(performance).every(Number.isFinite), true);
  assert.deepEqual(pageErrors, []);
  for (const expected of ["404", "422", "409", "ERR_CONNECTION_REFUSED"]) assert.equal(expectedResourceFailures.some((message) => message.includes(expected)), true, `expected browser resource failure ${expected}`);
  assert.equal(expectedResourceFailures.every((message) => ["404", "422", "409", "ERR_CONNECTION_REFUSED"].some((expected) => message.includes(expected))), true);
  const screenshots = ["default-1280", "default-375", "validation-1280", "validation-375", "validation-colors-1280", "validation-colors-375", "conflict-1280", "conflict-375", "delete-confirm-1280", "delete-confirm-375", "focus-1280", "focus-375", "reduced-motion-1280", "reduced-motion-375", "scrolled-1280", "scrolled-768", "scrolled-375", "selector-ready-default-1280", "selector-ready-default-375", "selector-disabled-1280", "selector-dirty-1280", "selector-load-error-1280", "selector-load-error-375"];
  await writeFile(new URL("brand-kit-task8-receipt.json", evidence), JSON.stringify({ ok: true, viewports: [[1280,900],[768,900],[375,900]], screenshots, fieldGuidance: { visibleHelpItems: 25, describedControls: 32, colorHelpAndErrorsCoexist: true }, settledDefaultCaptures: { files: ["brand-kit-task8-768.png", "brand-kit-task8-375.png"], reducedMotion: true, animationName: "none", dialogOpacity: 1, overlayOpacity: 1, fontsReady: true, stableAnimationFrames: 2 }, previewTypography: { bodyClassApplied: true, bodyFontMatchesBrandToken: true }, cjkWrap: "semantic phrases remain whole at 375px", crud: ["create", "edit", "duplicate", "default", "wrong delete name rejected", "delete exact name"], failures: ["name 422", "color 422 targets hex input with help retained", "genuine second-tab 409 preserves first-tab draft", "GET retry blocker"], keyboard: ["Tab forward trap", "Shift+Tab backward trap", "Escape discard cancellation", "Escape close", "focus restore"], selectorStates: ["ready default", "dirty override", "disabled application", "load error"], productPreserved: true, oneScrollOwner: true, pageErrors: [], expectedResourceFailures, accessibility: { tool: "Chrome CDP Accessibility.getFullAXTree", nodes: accessibility.nodes.length, unnamedInteractive }, performance: { tool: "Chrome CDP Performance.getMetrics", metrics: performance }, toolLimitation: "Lighthouse CLI is not installed; existing no-dependency Chrome CDP accessibility and performance domains were used." }, null, 2));
  console.log("brand-kit-ui-e2e: PASS create/edit/duplicate/default/delete, GET retry, 422, 409, keyboard, 1280/768/375");
  cdp.close();
} finally {
  if (app.listening) await close(app).catch(() => {});
  await terminateChrome(chrome, chromeRoot);
  await rm(temp, { recursive: true, force: true });
}

async function assertLayout(cdp) { const measure = await evaluate(cdp, "({doc:document.documentElement.scrollWidth<=document.documentElement.clientWidth,dialog:document.querySelector('#brand-kit-dialog').scrollWidth<=document.querySelector('#brand-kit-dialog').clientWidth})"); assert.deepEqual(measure, { doc: true, dialog: true }); }
async function assertCjkLayout(cdp) { const measure = await evaluate(cdp, `(() => { const spans=[...document.querySelectorAll('.brand-kit-keep-together')].filter((item)=>item.offsetParent!==null); const footer=document.querySelector('.brand-kit-dialog-foot'); return {whole:spans.every((item)=>item.getClientRects().length===1), overflow:spans.every((item)=>item.getBoundingClientRect().right<=innerWidth-12), footer:footer.scrollWidth<=footer.clientWidth,footerClient:footer.clientWidth,footerScroll:footer.scrollWidth,actionsClient:document.querySelector('.brand-kit-dialog-actions').clientWidth,actionsScroll:document.querySelector('.brand-kit-dialog-actions').scrollWidth}; })()`); assert.equal(measure.whole, true, JSON.stringify(measure)); assert.equal(measure.overflow, true, JSON.stringify(measure)); assert.equal(measure.footer, true, JSON.stringify(measure)); }
async function assertTabletFooter(cdp) { const measure = await evaluate(cdp, `(() => { const actions=document.querySelector('.brand-kit-dialog-actions').getBoundingClientRect(); const save=document.querySelector('#brand-kit-save').getBoundingClientRect(); const duplicate=document.querySelector('#brand-kit-duplicate').getBoundingClientRect(); const footer=document.querySelector('.brand-kit-dialog-foot').getBoundingClientRect(); return {prominent:save.width>=actions.width-2 && save.top<duplicate.top,reachable:footer.bottom<=innerHeight,overflow:document.querySelector('.brand-kit-dialog-foot').scrollWidth<=document.querySelector('.brand-kit-dialog-foot').clientWidth,stacked:!getComputedStyle(document.querySelector('#brand-kit-dialog-body')).gridTemplateColumns.includes(' ')}; })()`); assert.deepEqual(measure, { prominent: true, reachable: true, overflow: true, stacked: true }); }
async function assertColorErrorContextVisible(cdp) { const measure = await evaluate(cdp, `(() => { const input=document.querySelector('[name="colors.primary.hex"]'); const field=input.closest('.brand-kit-color-field'); const body=document.querySelector('#brand-kit-dialog-body').getBoundingClientRect(); const footer=document.querySelector('.brand-kit-dialog-foot').getBoundingClientRect(); const described=(input.getAttribute('aria-describedby')||'').split(/\\s+/).map((id)=>document.getElementById(id)).filter(Boolean); const help=described.find((item)=>item.classList.contains('brand-kit-field-help')); const error=described.find((item)=>item.classList.contains('field-error')); const label=field.querySelector('label[for="brand-kit-color-primary"]'); const bottom=Math.min(body.bottom,footer.top); const visible=(item)=>{const rect=item.getBoundingClientRect();return rect.top>=body.top-1&&rect.bottom<=bottom+1;}; return {focused:document.activeElement===input,label:visible(label),input:visible(input),help:visible(help),error:visible(error),message:Boolean(error?.textContent.trim())}; })()`); assert.deepEqual(measure, { focused: true, label: true, input: true, help: true, error: true, message: true }); }
async function captureScrolledDialog(cdp, name, width, height) { const measure = await evaluate(cdp, `(() => { const body=document.querySelector('#brand-kit-dialog-body'); body.scrollTop=body.scrollHeight; const footer=document.querySelector('.brand-kit-dialog-foot').getBoundingClientRect(); const rect=body.getBoundingClientRect(); const preview=document.querySelector('#brand-kit-preview').getBoundingClientRect(); const defaults=[...document.querySelectorAll('.brand-kit-fieldset')].at(-1).getBoundingClientRect(); return {atBottom:Math.ceil(body.scrollTop+body.clientHeight)>=body.scrollHeight-1,separate:rect.bottom<=footer.top+1,footer:footer.bottom<=innerHeight,previewVisible:preview.bottom>rect.top&&preview.top<rect.bottom,defaultsVisible:defaults.bottom>rect.top&&defaults.top<rect.bottom}; })()`); assert.equal(measure.atBottom, true, JSON.stringify(measure)); assert.equal(measure.separate, true, JSON.stringify(measure)); assert.equal(measure.footer, true, JSON.stringify(measure)); assert.equal(measure.previewVisible, true, JSON.stringify(measure)); if (width>1000) assert.equal(measure.defaultsVisible, true, JSON.stringify(measure)); await screenshot(cdp, name, width, height); }
async function screenshot(cdp, name, width, height) { const shot = await cdp.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); await writeFile(new URL(name, evidence), Buffer.from(shot.data, "base64")); const size = await evaluate(cdp, "({width:innerWidth,height:innerHeight})"); assert.deepEqual(size, { width, height }); }
async function settledScreenshot(cdp, name, width, height) { await evaluate(cdp, `(async () => { await document.fonts.ready; await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))); })()`); assert.deepEqual(await evaluate(cdp, `(() => { const dialog=document.querySelector('#brand-kit-dialog'); const overlay=document.querySelector('#brand-kit-dialog-overlay'); return {animation:getComputedStyle(dialog).animationName,dialogOpacity:getComputedStyle(dialog).opacity,overlayOpacity:getComputedStyle(overlay).opacity}; })()`), { animation: "none", dialogOpacity: "1", overlayOpacity: "1" }); await screenshot(cdp, name, width, height); }
async function showPanel(cdp) { const top = await evaluate(cdp, `(() => { document.documentElement.style.scrollBehavior='auto'; const panel=document.querySelector('#brand-kit-panel'); scrollTo(0, scrollY + panel.getBoundingClientRect().top - 24); return panel.getBoundingClientRect().top; })()`); assert.equal(Math.round(top), 24); }
async function showAtDialogBodyTop(cdp, selector) { await evaluate(cdp, `(() => { const body=document.querySelector('#brand-kit-dialog-body'); const target=document.querySelector(${JSON.stringify(selector)}); body.scrollTop += target.getBoundingClientRect().top - body.getBoundingClientRect().top - 12; scrollTo(0,0); })()`); }
async function set(cdp, selector, value) { await evaluate(cdp, `(() => { const e=document.querySelector(${JSON.stringify(selector)}); e.value=${JSON.stringify(value)}; e.dispatchEvent(new Event('input',{bubbles:true})); })()`); }
async function files(cdp, selector, paths) { const doc=await cdp.call("DOM.getDocument"); const node=await cdp.call("DOM.querySelector",{nodeId:doc.root.nodeId,selector}); await cdp.call("DOM.setFileInputFiles",{nodeId:node.nodeId,files:paths}); await evaluate(cdp, `document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new Event('change',{bubbles:true}))`); }
async function pressTab(cdp, shift = false) { const modifiers = shift ? 8 : 0; await cdp.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, modifiers }); await cdp.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, modifiers }); }
async function viewport(cdp,width,height) { await cdp.call("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:1,mobile:false}); }
async function evaluate(cdp, expression) { const out=await cdp.call("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true}); if(out.exceptionDetails) throw new Error(out.exceptionDetails.text); return out.result.value; }
async function wait(cdp, expression, timeout=10000) { const end=Date.now()+timeout; while(Date.now()<end){ if(await evaluate(cdp,expression)) return; await new Promise(r=>setTimeout(r,100)); } throw new Error(`timeout: ${expression}`); }
async function listen(server, port=0) { await new Promise((resolve,reject)=>server.listen(port,"127.0.0.1",resolve).once("error",reject)); }
async function close(server) { await new Promise((resolve,reject)=>server.close((error)=>error?reject(error):resolve())); }
async function websocketUrl(port) { for(let i=0;i<100;i+=1){ try { const list=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json()); const page=list.find((item)=>item.type==="page"); if(page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl; } catch {} await new Promise(r=>setTimeout(r,100)); } throw new Error("Chrome CDP unavailable"); }
async function newPage(port, url) { const page=await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`,{method:"PUT"}).then((response)=>response.json()); if(!page.id||!page.webSocketDebuggerUrl) throw new Error("Chrome second tab unavailable"); return { targetId:page.id, cdp:await connect(page.webSocketDebuggerUrl) }; }
async function closePage(port, targetId) { const response=await fetch(`http://127.0.0.1:${port}/json/close/${encodeURIComponent(targetId)}`,{method:"PUT"}); if(!response.ok) throw new Error("Chrome second tab cleanup failed"); }
async function terminateChrome(child, profileRoot) { child.kill("SIGTERM"); if (child.exitCode === null) await Promise.race([new Promise((resolve) => child.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 500))]); await signalMatchingProfile(profileRoot, "TERM"); await new Promise((resolve) => setTimeout(resolve, 100)); await signalMatchingProfile(profileRoot, "KILL"); }
async function signalMatchingProfile(profileRoot, signal) { await new Promise((resolve) => { const killer = spawn("/usr/bin/pkill", [`-${signal}`, "-f", profileRoot], { stdio: "ignore" }); killer.once("error", resolve); killer.once("exit", resolve); }); }
function connect(url) { const socket=new WebSocket(url); let id=1; const pending=new Map(); const listeners=new Map(); socket.addEventListener("message",({data})=>{const msg=JSON.parse(data); if(!msg.id){for(const listener of listeners.get(msg.method)??[])listener(msg.params??{});return;} const p=pending.get(msg.id); pending.delete(msg.id); msg.error?p.reject(new Error(msg.error.message)):p.resolve(msg.result??{});}); return new Promise((resolve,reject)=>{socket.addEventListener("open",()=>resolve({call(method,params={}){const next=id++; socket.send(JSON.stringify({id:next,method,params})); return new Promise((a,b)=>pending.set(next,{resolve:a,reject:b}));},on(method,listener){const current=listeners.get(method)??[];current.push(listener);listeners.set(method,current);},close(){socket.close();}})); socket.addEventListener("error",reject);}); }
async function findChrome(){ for(const path of [process.env.CHROME_PATH,"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome","/Applications/Chromium.app/Contents/MacOS/Chromium"].filter(Boolean)){try{await access(path,constants.X_OK);return path;}catch{}}throw new Error("Chrome not found");}
