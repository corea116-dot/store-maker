const LAYOUTS = ["text-only", "image-first", "image-last", "split-left", "split-right", "full-bleed"];
const COPY_FIELDS = ["heading", "body", "bullets"];
const IMAGE_FIELDS = ["image"];
const LAYOUT_FIELDS = ["layout"];

const definition = (key, labelKo, options = {}) => Object.freeze({
  key,
  labelKo,
  description: options.description ?? "상품 정보를 명확하게 전달하는 섹션입니다.",
  defaultLayout: options.defaultLayout ?? "text-only",
  allowedLayouts: Object.freeze(options.allowedLayouts ?? LAYOUTS),
  editableFields: Object.freeze(options.editableFields ?? [...COPY_FIELDS, ...IMAGE_FIELDS, ...LAYOUT_FIELDS]),
  evidencePolicy: options.evidencePolicy ?? "not-applicable",
  aliases: Object.freeze(options.aliases ?? []),
});

export const DETAIL_PAGE_SECTION_REGISTRY = Object.freeze([
  definition("hero", "히어로", { defaultLayout: "full-bleed", description: "상품과 핵심 가치를 첫 화면에서 소개합니다." }),
  definition("problem", "문제 제기", { description: "사용자의 불편과 해결 맥락을 설명합니다." }),
  definition("benefits", "핵심 장점", { description: "검증된 상품 장점을 짧고 선명하게 정리합니다.", aliases: ["benefit"] }),
  definition("features", "기능 상세", { defaultLayout: "split-left", description: "상품의 구성과 기능을 설명합니다.", aliases: ["feature"] }),
  definition("usage", "사용 방법", { description: "사용 순서와 활용 상황을 안내합니다." }),
  definition("specifications", "제품 사양", { description: "확인된 사양만 표로 정리하기 위한 섹션입니다.", evidencePolicy: "facts-required", aliases: ["spec"] }),
  definition("reviews", "후기", { description: "검증된 고객 후기만 넣을 수 있습니다.", evidencePolicy: "reviews-required" }),
  definition("faq", "자주 묻는 질문", { description: "구매 전 질문과 답을 정리합니다." }),
  definition("cta", "마지막 제안", { description: "다음 행동을 명확하게 안내합니다." }),
  definition("comparison", "비교", { description: "확인 가능한 기준으로 선택 차이를 비교합니다.", evidencePolicy: "facts-required" }),
  definition("before-after", "전후 비교", { description: "근거가 있는 전후 정보만 보여줍니다.", evidencePolicy: "facts-required" }),
  definition("components", "구성품", { description: "포함 구성과 사용 위치를 정리합니다.", evidencePolicy: "facts-required" }),
  definition("proof", "신뢰 근거", { description: "인증, 시험, 수치처럼 출처가 있는 근거만 표시합니다.", evidencePolicy: "facts-required" }),
  definition("ingredients", "성분·소재", { description: "확인된 성분과 소재만 설명합니다.", evidencePolicy: "facts-required" }),
  definition("warranty", "보증·교환", { description: "확인된 보증 및 교환 조건을 안내합니다.", evidencePolicy: "facts-required" }),
  definition("free-text", "자유 텍스트", { description: "직접 작성하는 설명 섹션입니다.", aliases: ["text"] }),
  definition("free-image", "자유 이미지", { defaultLayout: "full-bleed", description: "직접 선택한 이미지를 중심으로 구성합니다.", aliases: ["image"] }),
  definition("steps", "단계 안내", { description: "구매, 사용, 관리의 단계를 안내합니다." }),
  definition("media", "미디어", { defaultLayout: "full-bleed", description: "향후 GIF·MP4 확장에 연결할 미디어 자리입니다." }),
]);

export const DETAIL_PAGE_SECTION_TYPES = Object.freeze(DETAIL_PAGE_SECTION_REGISTRY.map(({ key }) => key));
export const DETAIL_PAGE_LAYOUTS = Object.freeze([...LAYOUTS]);

const registryByKey = new Map(DETAIL_PAGE_SECTION_REGISTRY.map((entry) => [entry.key, entry]));
const aliases = new Map(DETAIL_PAGE_SECTION_REGISTRY.flatMap((entry) => entry.aliases.map((alias) => [alias, entry.key])));

export function getDetailPageSectionType(value) {
  return registryByKey.get(value);
}

export function normalizeDetailPageSectionKind(value) {
  if (typeof value !== "string") return undefined;
  return registryByKey.has(value) ? value : aliases.get(value);
}

export function createDetailPageStarterSection(typeKey, options = {}) {
  const type = getDetailPageSectionType(normalizeDetailPageSectionKind(typeKey));
  if (!type) throw new Error("Unsupported detail page section type");
  const layout = type.allowedLayouts.includes(options.layout) ? options.layout : type.defaultLayout;
  return {
    id: options.id,
    kind: type.key,
    layout,
    visible: options.visible ?? true,
    heading: options.heading ?? defaultHeading(type, options.productName),
    body: options.body ?? "",
    bullets: Array.isArray(options.bullets) ? [...options.bullets] : [],
    source: options.source ?? "user",
    ...(options.image ? { image: options.image } : {}),
  };
}

export function getCategoryTemplateDraft(category, productName = "상품") {
  const categoryKey = typeof category === "string" ? category.toLowerCase() : "";
  const typeKeys = categoryTemplates[categoryKey] ?? categoryTemplates.default;
  return {
    category: categoryKey || "default",
    sections: typeKeys.map((key, index) => createDetailPageStarterSection(key, {
      id: `template-${index + 1}-${key}`,
      productName,
      source: "generated",
    })),
  };
}

function defaultHeading(type, productName) {
  const name = typeof productName === "string" && productName.trim() ? productName.trim() : "상품";
  if (type.key === "hero") return `${name}을 소개합니다`;
  if (type.key === "cta") return `${name}을 선택해 보세요`;
  return type.labelKo;
}

const categoryTemplates = Object.freeze({
  beauty: ["hero", "problem", "benefits", "ingredients", "usage", "reviews", "faq", "cta"],
  fashion: ["hero", "benefits", "features", "comparison", "usage", "reviews", "faq", "cta"],
  food: ["hero", "benefits", "ingredients", "components", "usage", "faq", "cta"],
  electronics: ["hero", "problem", "features", "specifications", "components", "usage", "warranty", "faq", "cta"],
  default: ["hero", "problem", "benefits", "features", "usage", "specifications", "faq", "cta"],
});
