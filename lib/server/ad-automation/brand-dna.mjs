import { shorten } from "./utils.mjs";

export function buildBrandDna(input) {
  const confidence = confidenceFor(input);
  const warnings = [...input.brand.warnings];
  if (!warnings.some((warning) => warning.includes("Phase 1"))) {
    warnings.push("Phase 1 Brand DNA는 외부 페이지를 가져오지 않고 상품 입력, 첨부 요약, 정규화 URL만 사용합니다.");
  }
  const productTruths = productTruthList(input.product);
  return {
    version: "1",
    source: input.brand.source,
    confidence,
    warnings,
    layers: {
      coreIdentity: {
        label: "핵심 정체성",
        summary: `${input.product.name}는 ${shorten(input.product.description, 82)} 맥락의 브랜드 경험으로 정리됩니다.`,
        evidence: ["상품명", "상품 설명", "요구사항"],
        confidence,
      },
      visualSystem: {
        label: "시각 시스템",
        summary: styleSummaryFor(input),
        evidence: input.product.attachments?.length ? ["첨부 이미지/자료 메타데이터", "무드 프리셋"] : ["무드 프리셋", "상품 설명"],
        confidence: Math.max(0.25, confidence - 0.08),
      },
      voiceTone: {
        label: "목소리와 톤",
        summary: voiceToneFor(input),
        evidence: ["요구사항", "목표 마켓", "무드 프리셋"],
        confidence,
      },
      productTruths: {
        label: "상품 사실 기반",
        summary: productTruths.join(" / "),
        evidence: ["상품 설명", "첨부 자료명", "텍스트 요약"],
        confidence: Math.max(0.35, confidence + 0.04),
      },
      customerPromise: {
        label: "고객 약속",
        summary: customerPromiseFor(input),
        evidence: ["추천 앵글", "요구사항"],
        confidence,
      },
      complianceBoundaries: {
        label: "표현 안전 경계",
        summary: "검증되지 않은 임상/효능/순위/보증 표현은 광고 본문에서 제외하고, 사실 확인 전에는 주의 문구로 분리합니다.",
        evidence: ["운영 정책", "요구사항"],
        confidence: 0.72,
      },
    },
  };
}

function confidenceFor(input) {
  let confidence = input.brand.source.brandUrl ? 0.52 : 0.38;
  if (input.product.attachments?.length) confidence += 0.08;
  if (input.product.requirements?.length > 20) confidence += 0.05;
  return Number(Math.min(0.76, confidence).toFixed(2));
}

function productTruthList(product) {
  const facts = [];
  const text = `${product.description} ${product.requirements}`;
  if (/배터리/u.test(text)) facts.push("배터리 지속성");
  if (/소음|저소음/u.test(text)) facts.push("소음 관리");
  if (/원목|소재|마감/u.test(text)) facts.push("소재/마감");
  if (/휴대|접이|가벼/u.test(text)) facts.push("휴대성");
  if (/정리|수납/u.test(text)) facts.push("정리 경험");
  if (product.attachments?.length) facts.push("첨부 자료 기반 시각 단서");
  return facts.length ? facts.slice(0, 4) : [shorten(product.description, 60), "요구사항 기반 차별점"];
}

function styleSummaryFor(input) {
  const mood = input.adAutomation.mood;
  const hasImage = input.product.attachments?.some((attachment) => attachment.kind === "image");
  return hasImage
    ? `${mood.label} 무드로 제품 사진의 실제 형태를 우선 유지하고, 여백과 대비로 광고 정보층을 구성합니다.`
    : `${mood.label} 무드로 과도한 장식보다 상품명, 핵심 이점, CTA의 정보 위계를 먼저 잡습니다.`;
}

function voiceToneFor(input) {
  const toneByMood = {
    bold: "첫 문장은 선명하게, 본문은 사실 근거와 사용 맥락으로 받쳐주는 톤입니다.",
    editorial: "소재와 장면을 설명하는 편집형 문장으로 신뢰를 쌓는 톤입니다.",
    premium: "완성도와 출처 단서를 차분하게 제시해 고급감과 신뢰를 함께 만드는 톤입니다.",
    warm: "일상 장면과 사용 감정을 부드럽게 연결해 부담 없이 이해되는 톤입니다.",
    fresh: "수확감, 산지, 신선도, 보관 포인트를 식탁 장면과 연결해 믿고 고르게 하는 톤입니다.",
    minimal: "불필요한 수식은 덜고 핵심 정보만 또렷하게 남기는 절제된 톤입니다.",
    energetic: "혜택과 행동 유도를 빠르게 읽히게 만드는 활기 있는 톤입니다.",
    technical: "스펙과 검증 포인트를 구조적으로 설명해 선택 기준을 분명히 하는 톤입니다.",
    gift: "선물 맥락과 받는 사람의 사용 장면을 자연스럽게 떠올리게 하는 톤입니다.",
    seasonal: "시즌과 상황 전환에 맞춘 구매 이유를 구체적으로 제안하는 톤입니다.",
  };
  return toneByMood[input.adAutomation.moodPreset] ?? "정돈된 정보 전달과 안전한 표현을 우선하는 차분한 톤입니다.";
}

function customerPromiseFor(input) {
  const firstAngle = input.adAutomation.recommendedAngles[0]?.label ?? "사용 맥락";
  return `${firstAngle} 관점으로 ${input.product.name}의 실제 사용 이유를 빠르게 이해하게 만듭니다.`;
}
