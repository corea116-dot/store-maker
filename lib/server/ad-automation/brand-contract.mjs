import { BODY_FONT_OPTIONS, DISPLAY_FONT_OPTIONS } from "../../../assets/brand-kit-options.js";
import { escapeHtml } from "./utils.mjs";

export function brandAuditFor(input) {
  if (!input?.brandKitSnapshot || !input?.effectiveBrandStyle) return {};
  return {
    brandKitSnapshot: structuredClone(input.brandKitSnapshot),
    effectiveBrandStyle: structuredClone(input.effectiveBrandStyle),
  };
}

export function brandInputFromSnapshot(snapshot) {
  const source = structuredClone(snapshot.source);
  return {
    url: source.brandUrl,
    source: {
      brandUrl: source.brandUrl,
      urlSafety: source.urlSafety,
      snapshotStatus: "brand-kit",
      brandKitId: snapshot.id,
      brandKitRevision: snapshot.revision,
      generatedAt: snapshot.appliedAt,
      confidence: source.brandUrl ? 0.76 : 0.64,
    },
    warnings: source.brandUrl
      ? ["저장된 브랜드 키트 URL을 참조하며 외부 페이지는 가져오지 않습니다."]
      : ["브랜드 키트에 URL이 없어 저장된 시각 및 말투 규칙을 사용합니다."],
  };
}

export function brandPromptLines(input) {
  const snapshot = input?.brandKitSnapshot;
  const style = input?.effectiveBrandStyle;
  if (!snapshot || !style) return [];
  return [
    "",
    "## 서버 브랜드 계약",
    `- kit: ${snapshot.id}@${snapshot.revision}`,
    `- colors: ${JSON.stringify(style.colors)}`,
    `- typography: ${JSON.stringify(style.typography)}`,
    `- voice: ${JSON.stringify(style.voice)}`,
    `- imagery: ${JSON.stringify(style.imagery)}`,
    `- image: ${JSON.stringify(style.image)}`,
    `- ad: ${JSON.stringify(style.ad)}`,
    "- 상품 사실, 법적 요구사항, 필수 포함 문구가 브랜드 표현보다 우선합니다.",
  ];
}

export function applyBrandOutput(input, output) {
  const snapshot = input?.brandKitSnapshot;
  const style = input?.effectiveBrandStyle;
  if (!snapshot || !style) return { ...output };
  return {
    ...output,
    markdown: `${brandMarkdownMetadata(snapshot)}\n\n${output.markdown}`,
    html: brandHtml(snapshot, style, output.html),
    ...brandAuditFor(input),
  };
}

function brandMarkdownMetadata(snapshot) {
  return [
    "<!-- Store Maker brand metadata -->",
    `브랜드 키트: ${escapeMarkdownText(snapshot.name)} (${snapshot.id}@${snapshot.revision})`,
    `말투: ${escapeMarkdownText(snapshot.voice.summary)}`,
    `이미지 분위기: ${escapeMarkdownText(snapshot.imagery.mood)} / ${escapeMarkdownText(snapshot.imagery.lighting)} / ${escapeMarkdownText(snapshot.imagery.composition)}`,
  ].join("\n");
}

function escapeMarkdownText(value) {
  return String(value).replace(/[!-/:-@[-`{-~]/gu, "\\$&");
}

function brandHtml(snapshot, style, html) {
  const display = DISPLAY_FONT_OPTIONS.find((option) => option.id === style.typography.displayFontId);
  const body = BODY_FONT_OPTIONS.find((option) => option.id === style.typography.bodyFontId);
  const tokens = [
    ["primary", style.colors.primary], ["secondary", style.colors.secondary],
    ["accent", style.colors.accent], ["background", style.colors.background],
    ["surface", style.colors.surface], ["text", style.colors.text],
    ["on-primary", style.colors.onPrimary],
  ].map(([name, value]) => `--brand-${name}:${value}`).join(";");
  const className = `brand-output brand-display-${snapshot.typography.displayFontId} brand-body-${snapshot.typography.bodyFontId}`;
  const logo = snapshot.logo
    ? `<img class="brand-output-logo" src="${escapeAttribute(snapshot.logo.url)}" alt="${escapeAttribute(`${snapshot.name} 로고`)}" />`
    : "";
  return [
    "<style data-store-maker-brand-output>",
    `.brand-output{background:var(--brand-background);color:var(--brand-text);font-family:${body.stack};font-weight:${body.weight}}`,
    `.brand-output h1,.brand-output h2,.brand-output h3{font-family:${display.stack};font-weight:${display.weight}}`,
    ".brand-output-logo{display:block;max-width:180px;max-height:80px;object-fit:contain}",
    "</style>",
    `<section class="${className}" style="${tokens}">`,
    `<header class="brand-output-identity">${logo}<span>${escapeHtml(snapshot.name)}</span></header>`,
    html,
    "</section>",
  ].join("");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}
