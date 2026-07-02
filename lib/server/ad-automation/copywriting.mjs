import { shorten } from "./utils.mjs";

export function buildAdSet(input, brandDna, adAutomation) {
  const ads = adAutomation.recommendedAngles.map((angle, index) => makeAd({ input, adAutomation, angle, index }));
  return {
    version: "1",
    count: ads.length,
    source: "server-deterministic-phase-1",
    brandDnaVersion: brandDna.version,
    ads,
    items: ads,
  };
}

export function adMarketCopy(market, productName, adSet) {
  const labels = { smartstore: "스마트스토어", coupang: "쿠팡", eleven: "11번가" };
  const ads = adSet.items ?? adSet.ads ?? [];
  return {
    market,
    label: labels[market] ?? market,
    title: `${labels[market] ?? market}용 ${productName} 광고 세트`,
    body: ads.map((ad) => `${ad.id} ${ad.headline}`).join("\n"),
  };
}

function makeAd(adInput) {
  const { input, adAutomation, angle, index } = adInput;
  return {
    id: `ad-${String(index + 1).padStart(2, "0")}`,
    angleId: angle.id,
    angleLabel: angle.label,
    moodPreset: adAutomation.moodPreset,
    headline: headlineFor(input.product, angle),
    primaryText: primaryTextFor(input, angle),
    cta: ctaFor(angle),
    visualBrief: visualBriefFor(input, angle, adAutomation.mood),
    targetMarkets: input.markets,
    localizationNotes: localizationNotesFor(input.markets),
    complianceNote: "원자료로 확인되지 않은 효능, 임상, 순위, 최상급 보장은 사용하지 않습니다.",
  };
}

function headlineFor(product, angle) {
  const productName = product.name;
  const map = {
    "problem-solution": `${productName}, 불편을 해결하는 선택`,
    "before-after": `${productName} 사용 전후가 보이는 순간`,
    "benefit-stack": `${productName}의 혜택을 한눈에`,
    "social-proof": `사용 맥락으로 설득하는 ${productName}`,
    "expert-rationale": `${productName}, 선택 기준부터 확인하세요`,
    comparison: `기존 방식과 다른 ${productName}의 차이`,
    "ingredient-material": `소재와 구성으로 설명되는 ${productName}`,
    "lifestyle-scene": `오늘의 사용 장면에 맞춘 ${productName}`,
    "speed-convenience": `바로 이해되는 ${productName}`,
    "risk-reversal": `안심하고 확인하는 ${productName}`,
    "offer-value": `오래 쓰는 기준으로 고른 ${productName}`,
    "premium-origin": `${productName}의 완성도를 보여주는 이유`,
    "how-to-use": `매일 쓰기 좋은 ${productName}`,
    "seasonal-context": `필요한 순간에 맞는 ${productName}`,
    "objection-handling": `${productName}, 망설임을 줄이는 정보`,
    "authority-ranking": `검증된 근거로 확인하는 ${productName}`,
  };
  return map[angle.id] ?? `${productName} 추천 광고안`;
}

function primaryTextFor(input, angle) {
  const promise = shorten(input.product.description, 72);
  if (angle.id === "benefit-stack") return `${promise}. 확인 가능한 특징과 사용 조건을 먼저 보여주고, 과장 표현 없이 구매 판단을 돕습니다.`;
  if (angle.id === "before-after") return `${promise}. 사용 전후의 차이를 이미지와 짧은 문장으로 분리해 첫 화면에서 바로 이해되게 합니다.`;
  if (angle.id === "lifestyle-scene") return `${promise}. 실제 사용 장면과 필요한 순간을 연결해 사용자가 자기 상황에 대입하게 만듭니다.`;
  if (angle.id === "comparison") return `${promise}. 기존 선택지와 다른 점을 안전한 비교 문장으로 정리합니다.`;
  if (angle.id === "speed-convenience") return `${promise}. 선택한 마켓의 검색/옵션/혜택 정보 순서에 맞춰 핵심을 재배치합니다.`;
  return `${promise}. ${angle.label} 관점으로 핵심 이점과 행동 유도를 한 카드 안에 정리합니다.`;
}

function ctaFor(angle) {
  if (angle.id === "benefit-stack") return "혜택 확인하기";
  if (angle.id === "ingredient-material") return "소재 확인하기";
  if (angle.id === "comparison") return "차이 확인하기";
  return "상세 보기";
}

function visualBriefFor(input, angle, mood) {
  const source = input.product.attachments?.some((attachment) => attachment.kind === "image") ? "첨부 제품 사진" : "제품 정보";
  return `${mood.label} 무드. ${source}을 기준으로 ${angle.label} 메시지가 먼저 읽히는 카드형 광고 시안.`;
}

function localizationNotesFor(markets) {
  const labels = {
    smartstore: "스마트스토어는 검색 키워드와 신뢰 정보 우선",
    coupang: "쿠팡은 빠른 이해와 옵션 정보 우선",
    eleven: "11번가는 혜택과 가격 비교 맥락 우선",
  };
  return markets.map((market) => labels[market] ?? `${market} 문체에 맞춤`).join(" / ");
}
