import { clampConfidence, cleanText, readObject } from "./utils.mjs";

export function applyStructuredEngineOutput({ brandDna, adSet }, engineOutput) {
  const structured = parseStructuredEngineOutput(engineOutput);
  if (!structured) return { brandDna, adSet, structuredApplied: false };
  return {
    brandDna: mergeBrandDna(brandDna, structured.brandDna),
    adSet: mergeAdSet(adSet, structured.adSet),
    structuredApplied: true,
  };
}

function parseStructuredEngineOutput(engineOutput) {
  const text = typeof engineOutput === "string" ? engineOutput.trim() : "";
  if (!text) return undefined;
  for (const candidate of jsonCandidates(text)) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // Try the next candidate.
    }
  }
  return undefined;
}

function jsonCandidates(text) {
  const candidates = [text];
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/iu);
  if (fence?.[1]) candidates.push(fence[1].trim());
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(text.slice(firstBrace, lastBrace + 1));
  return [...new Set(candidates)];
}

function mergeBrandDna(fallback, rawBrandDna) {
  const input = readObject(rawBrandDna);
  const layers = readObject(input.layers);
  const mergedLayers = { ...fallback.layers };
  for (const [key, fallbackLayer] of Object.entries(fallback.layers)) {
    mergedLayers[key] = mergeLayer(fallbackLayer, layers[key]);
  }
  return {
    ...fallback,
    confidence: clampConfidence(input.confidence, fallback.confidence),
    warnings: mergeWarnings(fallback.warnings, input.warnings),
    layers: mergedLayers,
  };
}

function mergeLayer(fallbackLayer, rawLayer) {
  const layer = readObject(rawLayer);
  const evidence = Array.isArray(layer.evidence)
    ? layer.evidence.map((item) => cleanText(item, 80)).filter(Boolean).slice(0, 6)
    : fallbackLayer.evidence;
  return {
    ...fallbackLayer,
    label: cleanText(layer.label, 40) ?? fallbackLayer.label,
    summary: cleanText(layer.summary, 360) ?? fallbackLayer.summary,
    evidence: evidence.length ? evidence : fallbackLayer.evidence,
    confidence: clampConfidence(layer.confidence, fallbackLayer.confidence),
  };
}

function mergeAdSet(fallback, rawAdSet) {
  const input = readObject(rawAdSet);
  const rawItems = Array.isArray(input.items) ? input.items : input.ads;
  if (!Array.isArray(rawItems) || rawItems.length === 0) return fallback;
  const ads = fallback.ads.map((base, index) => mergeAd(base, rawItems[index]));
  return {
    ...fallback,
    source: "server-deterministic-phase-1+engine-structured",
    count: ads.length,
    ads,
    items: ads,
  };
}

function mergeAd(base, rawAd) {
  const ad = readObject(rawAd);
  return {
    ...base,
    angleId: cleanText(ad.angleId, 64) ?? base.angleId,
    angleLabel: cleanText(ad.angleLabel, 80) ?? base.angleLabel,
    moodPreset: cleanText(ad.moodPreset, 40) ?? base.moodPreset,
    headline: cleanText(ad.headline, 120) ?? base.headline,
    primaryText: cleanText(ad.primaryText, 360) ?? base.primaryText,
    cta: cleanText(ad.cta, 80) ?? base.cta,
    visualBrief: cleanText(ad.visualBrief, 360) ?? base.visualBrief,
    localizationNotes: cleanText(ad.localizationNotes, 200) ?? base.localizationNotes,
    complianceNote: cleanText(ad.complianceNote, 240) ?? base.complianceNote,
  };
}

function mergeWarnings(fallbackWarnings, rawWarnings) {
  if (!Array.isArray(rawWarnings)) return fallbackWarnings;
  const additional = rawWarnings.map((warning) => cleanText(warning, 180)).filter(Boolean);
  return [...new Set([...fallbackWarnings, ...additional])].slice(0, 8);
}
