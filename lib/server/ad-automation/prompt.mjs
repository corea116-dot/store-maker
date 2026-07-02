export function composeAdSetPrompt(input) {
  const brandUrl = input.brand.source.brandUrl ?? "제공되지 않음";
  const safety = input.brand.source.urlSafety;
  const recommendedAngles = input.adAutomation.recommendedAngles;
  return [
    "당신은 Store Maker의 한국 이커머스 광고 세트 기획 에이전트입니다.",
    "아래 실제 상품 입력과 서버가 정규화한 브랜드 참조를 바탕으로 독립적인 광고 세트를 작성하세요.",
    "타사의 유료 템플릿, 문구, 레이아웃을 복제하지 말고 Store Maker용 구조와 문장으로 재설계하세요.",
    "파일을 수정하거나 로컬 명령을 실행하지 말고 최종 답변만 Markdown 또는 JSON으로 출력하세요.",
    "",
    "## 생성 모드",
    "- generationMode: ad-set",
    "- task: ad-set",
    "- 목표 산출물: Brand DNA 요약, 추천 카피 앵글, 기본 추천 광고안 5개",
    "",
    "## 상품 입력",
    `- 상품명: ${input.product.name}`,
    `- 상품 설명: ${input.product.description}`,
    `- 요구사항: ${input.product.requirements}`,
    `- 목표 마켓: ${input.markets.join(", ")}`,
    materialPromptLines(input.product),
    "",
    "## 브랜드 참조",
    `- 정규화된 브랜드 URL: ${brandUrl}`,
    `- URL 안전 상태: ${safety.status} (${safety.reason})`,
    "- Phase 1에서는 외부 페이지를 가져오지 않고, URL 문자열과 상품/첨부 자료만 참고합니다.",
    "",
    "## 16개 카피 앵글 카탈로그",
    ...input.adAutomation.availableAngles.map((angle, index) => `${index + 1}. ${angle.id} | ${angle.label}: ${angle.description}`),
    "",
    "## 서버 추천 앵글 5개",
    ...recommendedAngles.map((angle, index) => `${index + 1}. ${angle.id} | ${angle.label} | score=${angle.score} | ${angle.reason}`),
    "",
    "## 무드 프리셋",
    `- ${input.adAutomation.mood.id}: ${input.adAutomation.mood.description}`,
    "",
    "## 출력 형식",
    "- 가능하면 JSON 객체로 brandDna.layers와 adSet.items를 반환하세요. Markdown만 반환해도 Store Maker가 fallback 광고안을 유지합니다.",
    "- Brand DNA는 coreIdentity, visualSystem, voiceTone, productTruths, customerPromise, complianceBoundaries 6개 layer로 작성하세요.",
    "- 광고안은 반드시 5개만 작성하고, 각 광고안은 angleId, headline, primaryText, cta, visualBrief, complianceNote를 포함하세요.",
    "- 검증되지 않은 임상, 효능, 순위, 보증 표현은 사용하지 말고 필요한 경우 주의 문구로 분리하세요.",
  ].join("\n");
}

function materialPromptLines(product) {
  const parts = [];
  if (product.materials?.length) parts.push(`- 이미지/자료 메모: ${product.materials.join(", ")}`);
  if (product.attachments?.length) {
    for (const attachment of product.attachments) {
      parts.push(`- 첨부 파일: ${attachment.name} | ${attachment.type} | ${attachment.size} bytes | ${attachment.kind}${attachment.textPreview ? ` | ${attachment.textPreview}` : ""}`);
    }
  }
  return parts.length ? parts.join("\n") : "- 이미지/자료: 제공 없음";
}
