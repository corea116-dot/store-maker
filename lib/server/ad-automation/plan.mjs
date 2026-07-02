import { AD_GENERATION_MODE, angleSelectionFor } from "./catalog.mjs";
import { buildBrandDna } from "./brand-dna.mjs";
import { adMarketCopy, buildAdSet } from "./copywriting.mjs";
import { applyStructuredEngineOutput } from "./engine-output.mjs";
import { buildAdHtml, buildAdMarkdown } from "./render.mjs";
import { firstUsefulLine } from "./utils.mjs";

export function createAdAutomationPlan(input, engineOutput = "") {
  const fallbackBrandDna = buildBrandDna(input);
  const adAutomation = buildAdAutomationMeta(input);
  const fallbackAdSet = buildAdSet(input, fallbackBrandDna, adAutomation);
  const merged = applyStructuredEngineOutput({ brandDna: fallbackBrandDna, adSet: fallbackAdSet }, engineOutput);
  return {
    brandDna: merged.brandDna,
    adAutomation: {
      ...adAutomation,
      source: merged.structuredApplied ? "server-deterministic-phase-1+engine-structured" : adAutomation.source,
    },
    adSet: merged.adSet,
    engineNote: engineNoteFor(engineOutput, merged.structuredApplied),
    structuredApplied: merged.structuredApplied,
  };
}

export function buildAdAutomationResult(input, engineOutput, prompt) {
  const { brandDna, adAutomation, adSet, engineNote } = createAdAutomationPlan(input, engineOutput);
  const renderInput = { input, brandDna, adAutomation, adSet, engineNote };
  const markdown = buildAdMarkdown(renderInput);
  const html = buildAdHtml(renderInput);
  return {
    generationMode: AD_GENERATION_MODE,
    title: `${input.product.name} 광고 세트`,
    summary: `${input.product.name}의 Brand DNA와 추천 광고안 5개입니다.`,
    markdown,
    html,
    promptPreview: prompt.slice(0, 2000),
    brand: { url: input.brand.url, source: input.brand.source, warnings: input.brand.warnings },
    brandDna,
    adAutomation,
    adSet,
    markets: input.markets.map((market) => adMarketCopy(market, input.product.name, adSet)),
    generatedAt: new Date().toISOString(),
    engineId: input.engine.engineId,
  };
}

function buildAdAutomationMeta(input) {
  const availableAngles = input.adAutomation.availableAngles;
  const recommendedAngles = input.adAutomation.recommendedAngles;
  return {
    moodPreset: input.adAutomation.moodPreset,
    mood: input.adAutomation.mood,
    language: input.adAutomation.language,
    expandAngles: input.adAutomation.expandAngles,
    availableAngles,
    recommendedAngles,
    angleSelection: input.adAutomation.angleSelection ?? angleSelectionFor(availableAngles, recommendedAngles),
    source: "server-deterministic-phase-1",
  };
}

function engineNoteFor(engineOutput, structuredApplied) {
  if (structuredApplied) return "엔진이 반환한 구조화 JSON 일부를 Brand DNA와 광고안에 반영했습니다.";
  return firstUsefulLine(engineOutput);
}
