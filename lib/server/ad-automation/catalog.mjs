import { readObject } from "./utils.mjs";

const DETAIL_GENERATION_MODE = "detail-page";
export const AD_GENERATION_MODE = "ad-set";

export const AD_MOOD_PRESETS = {
  clean: { id: "clean", label: "Clean", description: "정돈된 여백, 선명한 제품 정보, 과장 없는 설득 흐름" },
  bold: { id: "bold", label: "Bold", description: "강한 첫 문장, 높은 대비, 빠른 이해 중심의 구조" },
  editorial: { id: "editorial", label: "Editorial", description: "잡지형 문장 흐름, 소재와 사용 맥락을 함께 설명" },
};

export const COPY_ANGLE_CATALOG = [
  { id: "problem-solution", label: "문제-해결", description: "사용자가 겪는 불편과 해결점을 한 흐름으로 연결", keywords: ["불편", "문제", "소음", "정리", "피로", "걱정", "해결"] },
  { id: "before-after", label: "전후 변화", description: "사용 전후의 차이를 명확히 보여주는 구조", keywords: ["전후", "비교", "개선", "정돈", "변화"] },
  { id: "benefit-stack", label: "혜택 묶음", description: "핵심 혜택을 2-3개 근거와 함께 쌓아 올리는 구조", keywords: ["혜택", "배터리", "소재", "성능", "구성", "각인", "기능"] },
  { id: "social-proof", label: "사용자 반응", description: "후기나 사용자 관찰을 조심스럽게 반영하는 구조", keywords: ["후기", "리뷰", "평점", "사용자", "고객", "반응"] },
  { id: "expert-rationale", label: "전문가 근거", description: "선택 이유를 전문가형 근거와 체크포인트로 설명", keywords: ["전문가", "검증", "인증", "기준", "테스트", "근거"] },
  { id: "comparison", label: "대안 비교", description: "기존 방식과 비교해 이해를 빠르게 만드는 구조", keywords: ["비교", "대체", "기존", "대안", "차이"] },
  { id: "ingredient-material", label: "성분/소재", description: "성분, 소재, 마감처럼 확인 가능한 구성 요소 중심", keywords: ["원목", "성분", "소재", "마감", "촉감", "재질"] },
  { id: "lifestyle-scene", label: "라이프스타일 장면", description: "실제 생활/업무 맥락에서 쓰는 모습을 먼저 보여주는 구조", keywords: ["사용", "장면", "사무실", "재택", "책상", "휴대", "라이프"] },
  { id: "speed-convenience", label: "속도/편의", description: "설치, 시작, 이해가 빠른 경험을 강조", keywords: ["간편", "빠른", "설치", "바로", "쉬움", "편리"] },
  { id: "risk-reversal", label: "위험 완화", description: "보증, 안전, 선택 실패 부담을 낮추는 정보 구조", keywords: ["보증", "안전", "교환", "환불", "정품", "안심"] },
  { id: "offer-value", label: "제안 가치", description: "가격보다 오래 쓰는 가치와 구성 이점을 강조", keywords: ["오래", "가성비", "절약", "내구", "구성", "혜택"] },
  { id: "premium-origin", label: "프리미엄/출처", description: "원산지, 제작 맥락, 완성도 같은 프리미엄 신뢰 단서", keywords: ["프리미엄", "원산지", "제작", "브랜드", "완성도", "디자인"] },
  { id: "how-to-use", label: "사용 방법", description: "설치·사용 순서와 루틴 정착을 안내", keywords: ["방법", "사용법", "매일", "루틴", "반복", "습관"] },
  { id: "seasonal-context", label: "시즌/상황", description: "선물, 새 학기, 업무 환경 전환 같은 시점 맥락", keywords: ["선물", "시즌", "새학기", "입사", "이사", "연말"] },
  { id: "objection-handling", label: "반박 처리", description: "구매 전 망설임과 흔한 질문을 먼저 해소", keywords: ["망설", "걱정", "질문", "비싸", "불안", "괜찮"] },
  { id: "authority-ranking", label: "권위/랭킹", description: "검증된 수상, 랭킹, 인증 근거가 있을 때만 신중하게 사용", keywords: ["랭킹", "1위", "수상", "선정", "공식", "인증"] },
];

export function readGenerationMode(value) {
  return value === AD_GENERATION_MODE ? AD_GENERATION_MODE : DETAIL_GENERATION_MODE;
}

export function isAdGenerationMode(input) {
  return input?.generationMode === AD_GENERATION_MODE;
}

export function readAdAutomationInput(value, context) {
  const input = readObject(value);
  const moodPreset = Object.hasOwn(AD_MOOD_PRESETS, input.moodPreset) ? input.moodPreset : "clean";
  const language = typeof input.language === "string" && input.language.trim() ? input.language.trim() : "ko-KR";
  const availableAngles = COPY_ANGLE_CATALOG.map(publicAngle);
  const scoredAngles = scoreAngles({ ...context, moodPreset });
  const recommendedAngles = scoredAngles.slice(0, 5);
  return {
    moodPreset,
    mood: AD_MOOD_PRESETS[moodPreset],
    language,
    expandAngles: input.expandAngles === true,
    availableAngles,
    recommendedAngles,
    angleSelection: angleSelectionFor(availableAngles, recommendedAngles, scoredAngles),
  };
}

export function publicAngle(angle) {
  const { id, label, description } = angle;
  return { id, label, description };
}

export function angleSelectionFor(availableAngles, recommendedAngles, scoredAngles = recommendedAngles) {
  return {
    catalogVersion: "1",
    availableAngleIds: availableAngles.map((angle) => angle.id),
    recommendedAngleIds: recommendedAngles.map((angle) => angle.id),
    scores: scoredAngles.map((angle) => ({ angleId: angle.id, score: angle.score, reasons: [angle.reason] })),
  };
}

function scoreAngles(context) {
  const text = contextText(context);
  return COPY_ANGLE_CATALOG
    .map((angle, index) => scoreAngle({ angle, index, text, context }))
    .sort((a, b) => b.score - a.score || catalogIndex(a.id) - catalogIndex(b.id));
}

function scoreAngle(scoreInput) {
  const { angle, index, text, context } = scoreInput;
  let score = 42 + Math.max(0, 12 - index);
  const matched = [];
  for (const keyword of angle.keywords) {
    if (text.includes(keyword.toLowerCase())) {
      score += 9;
      matched.push(keyword);
    }
  }
  if (context.moodPreset === "bold" && ["problem-solution", "before-after", "comparison", "speed-convenience", "objection-handling"].includes(angle.id)) score += 5;
  if (context.moodPreset === "editorial" && ["lifestyle-scene", "ingredient-material", "premium-origin", "seasonal-context", "how-to-use"].includes(angle.id)) score += 5;
  if (context.moodPreset === "clean" && ["benefit-stack", "expert-rationale", "risk-reversal", "offer-value", "comparison"].includes(angle.id)) score += 5;
  if (context.markets?.includes("coupang") && angle.id === "speed-convenience") score += 4;
  if (context.markets?.includes("smartstore") && angle.id === "benefit-stack") score += 4;
  const authorityCaution = angle.id === "authority-ranking" && authorityRankingIsCautionOnly(text);
  const authorityPenalty = angle.id === "authority-ranking" && (matched.length === 0 || authorityCaution);
  if (authorityPenalty) score = Math.max(8, score - (authorityCaution ? 58 : 34));
  return {
    ...publicAngle(angle),
    score,
    reason: authorityCaution
      ? "랭킹/인증 표현이 금지 또는 근거 없음 문맥에 있어 Phase 1 기본 추천에서는 낮게 평가했습니다."
      : authorityPenalty
        ? "랭킹/수상/인증 근거가 없어 Phase 1 기본 추천에서는 낮게 평가했습니다."
        : matched.length > 0
          ? `상품 입력에서 ${matched.slice(0, 3).join(", ")} 단서가 확인되었습니다.`
          : "상품/마켓 맥락과 무드 프리셋 기준으로 기본 적합도가 높습니다.",
  };
}

function authorityRankingIsCautionOnly(text) {
  const hasAuthorityTerm = /랭킹|1위|수상|선정|공식|인증/u.test(text);
  if (!hasAuthorityTerm) return false;
  const cautionPattern = /(랭킹|1위|수상|선정|공식|인증).{0,18}(금지|피하|지양|근거 없음|근거가 없|없음|미확인)|(?:금지|피하|지양|근거 없음|근거가 없|없음|미확인).{0,18}(랭킹|1위|수상|선정|공식|인증)/u;
  return cautionPattern.test(text);
}

function contextText(context) {
  return [
    context.product?.name,
    context.product?.description,
    context.product?.requirements,
    ...(context.product?.materials ?? []),
    ...(context.product?.attachments ?? []).flatMap((attachment) => [attachment.name, attachment.textPreview]),
    ...(context.markets ?? []),
  ].filter(Boolean).join(" ").toLowerCase();
}

function catalogIndex(id) {
  return COPY_ANGLE_CATALOG.findIndex((angle) => angle.id === id);
}
