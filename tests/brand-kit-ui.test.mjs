import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("brand kit UI E2E keeps its default evidence path and accepts an isolated override", async () => {
  const harness = await readFile(new URL("tests/brand-kit-ui-e2e.mjs", root), "utf8");

  assert.match(harness, /process\.env\.STORE_MAKER_EVIDENCE_URL/u);
  assert.match(harness, /new URL\("\.\.\/\.omx\/logs\/", import\.meta\.url\)/u);
});

test("brand kit selector and manager expose the accessible UI contract", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  const css = await readFile(new URL("assets/brand-kits.css", root), "utf8");
  const source = await readFile(new URL("assets/brand-kits.js", root), "utf8");

  assert.match(html, /id="brand-kit-panel"/u);
  assert.match(html, /<select[^>]+id="brand-kit-select"/u);
  assert.match(html, /id="brand-kit-status"[^>]+aria-live="polite"/u);
  assert.match(html, /id="brand-kit-dialog"[^>]+role="dialog"[^>]+aria-modal="true"/u);
  assert.match(html, /id="brand-kit-dialog-body"/u);
  assert.match(html, /id="brand-kit-preview"/u);
  assert.match(html, /id="brand-kit-delete-confirmation"[^>]+aria-labelledby=/u);
  assert.match(html, /for="brand-kit-delete-name-input"/u);
  assert.equal((html.match(/class="brand-kit-hex-label"/gu) ?? []).length, 6);
  assert.equal((html.match(/class="hex-input"[^>]+aria-describedby="brand-kit-help-color-([^ ]+) brand-kit-error-color-\1"/gu) ?? []).length, 6);
  assert.equal((html.match(/class="field-error" id="brand-kit-error-color-[^"]+"/gu) ?? []).length, 6);
  assert.match(html, /id="brand-kit-usage-title">입력한 값은 이렇게 쓰여요</u);
  assert.match(html, /상품 정보와 필수 문구는 바꾸지 않습니다/u);
  assert.match(html, /외부 페이지 내용은 자동으로 읽거나 복사하지 않습니다/u);
  assert.match(html, /상세페이지 본문은 위 말투 규칙을 따릅니다/u);
  assert.match(source, /scrollIntoView\(\{ block: "center", inline: "nearest" \}\)/u);
  assert.match(source, /focus\(\{ preventScroll: true \}\)/u);
  assert.match(css, /\.brand-kit-color-grid \{[^}]+repeat\(2,/u);
  assert.match(css, /\.brand-kit-color-field > label:first-child \{[^}]+var\(--brand-kit-type-meta\)/u);
  assert.match(css, /\.brand-kit-hex-label \{[^}]+var\(--brand-kit-type-meta\)/u);
  assert.match(css, /\.field-error \{[^}]+var\(--brand-kit-type-meta\)/u);
  for (const [control, help] of [
    ["brand-kit-name", "brand-kit-help-name"],
    ["brand-kit-source-url", "brand-kit-help-source-url"],
    ["brand-kit-logo-input", "brand-kit-help-logo"],
    ["brand-kit-display-font", "brand-kit-help-display-font"],
    ["brand-kit-body-font", "brand-kit-help-body-font"],
    ["brand-kit-voice-summary", "brand-kit-help-voice-summary"],
    ["brand-kit-voice-dos", "brand-kit-help-voice-dos"],
    ["brand-kit-voice-donts", "brand-kit-help-voice-donts"],
    ["brand-kit-voice-sample", "brand-kit-help-voice-sample"],
    ["brand-kit-imagery-preset", "brand-kit-help-imagery-preset"],
    ["brand-kit-mood", "brand-kit-help-mood"],
    ["brand-kit-lighting", "brand-kit-help-lighting"],
    ["brand-kit-composition", "brand-kit-help-composition"],
    ["brand-kit-background", "brand-kit-help-background"],
    ["brand-kit-color-treatment", "brand-kit-help-color-treatment"],
    ["brand-kit-avoid", "brand-kit-help-avoid"],
    ["brand-kit-ad-mood", "brand-kit-help-ad-mood"],
    ["brand-kit-image-style", "brand-kit-help-image-style"],
    ["brand-kit-image-background", "brand-kit-help-image-background"],
  ]) {
    assert.match(html, new RegExp(`id="${control}"[^>]+aria-describedby="[^"]*${help}`, "u"));
    assert.match(html, new RegExp(`id="${help}"`, "u"));
  }
  assert.match(html, /id="brand-kit-dialog-description"[^>]*>[\s\S]*class="brand-kit-keep-together"/u);
  assert.match(source, /createBrandKitController/u);
  assert.match(source, /controlChanged\(field, value\)/u);
  assert.match(source, /reduceBrandKitState/u);
  assert.match(source, /logoChange/u);
  assert.match(source, /expectedRegistryRevision/u);
  assert.match(source, /status === 409/u);
  assert.match(source, /phrase\.className\s*=\s*"brand-kit-keep-together"/u);
  assert.match(source, /openDeleteConfirmation/u);
  assert.doesNotMatch(source, /window\.prompt/u);
  assert.match(source, /status === 422/u);
  assert.match(source, /new Set\(\(target\.getAttribute\("aria-describedby"\)/u);
  assert.match(source, /textContent/u);
  assert.match(source, /\.inert/u);
  assert.match(css, /\.brand-kit-dialog-body\s*\{[^}]*overflow:\s*auto/su);
  assert.match(css, /\.brand-kit-dialog\.is-hidden,[\s\S]*\.brand-kit-dialog \.is-hidden\s*\{\s*display:\s*none/u);
  assert.doesNotMatch(css, /\.brand-kit-conflict pre\s*\{[^}]*overflow:\s*(?:auto|scroll)/su);
  assert.match(css, /\.brand-kit-conflict\.is-hidden,[\s\S]*\.brand-kit-delete-confirmation\.is-hidden\s*\{\s*display:\s*none/u);
  assert.match(css, /--brand-kit-overlay-color:/u);
  for (const token of [
    "type-meta", "type-caption", "type-preview-title", "control-min-height",
    "logo-width", "logo-height", "swatch-size", "color-picker-width",
    "color-hex-min-width", "color-picker-min-height", "color-picker-padding",
    "preview-gap", "preview-rule-height", "preview-logo-max-width",
    "preview-logo-max-height", "preview-min-height", "dialog-mobile-radius",
  ]) assert.match(css, new RegExp(`--brand-kit-${token}:`, "u"));
  assert.match(css, /--brand-kit-dialog-inset:\s*var\(--space-5\)/u);
  assert.match(css, /--brand-kit-dialog-mobile-inset:\s*var\(--space-3\)/u);
  assert.match(css, /\.brand-kit-preview\s*\{[^}]*gap:\s*var\(--brand-kit-preview-gap\)/su);
  assert.match(css, /\.brand-kit-preview\s*\{[^}]*min-height:\s*var\(--brand-kit-preview-min-height\)/su);
  assert.match(css, /\.brand-kit-preview h4\s*\{[^}]*font-size:\s*var\(--brand-kit-type-preview-title\)/su);
  assert.doesNotMatch(css, /\.brand-kit-(?:panel-head p|apply small|status|logo-frame|swatch|list-item span|hex-label|conflict pre)[^{]*\{[^}]*font-size:\s*(?:11|12|14)px/su);
  assert.doesNotMatch(css, /\.brand-kit-(?:apply|logo-frame|color-field|preview(?:::before)?|preview img)[^{]*\{[^}]*(?:min-height:\s*46px|(?:width|height|max-width|max-height):\s*(?:8|34|54|76|150|72)px)/su);
  assert.match(css, /#brand-kit-save\s*\{\s*grid-column:\s*1\s*\/\s*-1/u);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/u);
  assert.match(html, /id="brand-kit-preview-body"\s+class="brand-kit-preview-body"/u);
  assert.match(css, /@media\s*\(max-width:\s*768px\)/u);
  assert.doesNotMatch(css, /--(?:bg|fg|accent)\s*:/u);
});
