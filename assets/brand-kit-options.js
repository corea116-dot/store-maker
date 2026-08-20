import { imageStyleOptions } from "./image-options.js";
import { adMoodPresets } from "./settings-state.js";

export const DISPLAY_FONT_OPTIONS = Object.freeze([
  Object.freeze({ id: "modern-sans-bold", stack: 'Pretendard, "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', weight: 700 }),
  Object.freeze({ id: "editorial-serif-bold", stack: '"Noto Serif KR", "Nanum Myeongjo", Georgia, serif', weight: 700 }),
  Object.freeze({ id: "rounded-sans-bold", stack: '"Arial Rounded MT Bold", Pretendard, "Noto Sans KR", sans-serif', weight: 700 }),
]);

export const BODY_FONT_OPTIONS = Object.freeze([
  Object.freeze({ id: "readable-sans", stack: 'Pretendard, "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', weight: 400 }),
  Object.freeze({ id: "readable-serif", stack: '"Noto Serif KR", "Nanum Myeongjo", Georgia, serif', weight: 400 }),
  Object.freeze({ id: "system-sans", stack: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans KR", sans-serif', weight: 400 }),
]);

export const IMAGERY_PRESETS = Object.freeze({
  custom: null,
  "clean-studio": Object.freeze({ mood: "정돈되고 선명한 스튜디오", lighting: "균일한 확산광", composition: "제품 중심 넓은 여백", background: "흰색 또는 연회색", colorTreatment: "중립 저채도" }),
  "warm-lifestyle": Object.freeze({ mood: "차분하고 따뜻한 생활 공간", lighting: "부드러운 오전 자연광", composition: "사용 장면과 자연스러운 여백", background: "밝은 원목과 크림 톤", colorTreatment: "저채도 웜톤" }),
  "premium-editorial": Object.freeze({ mood: "절제된 고급 편집 화보", lighting: "방향성 있는 소프트 라이트", composition: "비대칭 편집 구도", background: "짙은 중립 배경", colorTreatment: "깊은 저채도" }),
  "bold-commerce": Object.freeze({ mood: "선명하고 활기찬 커머스", lighting: "또렷한 하이라이트", composition: "모바일 중심 강한 구도", background: "대비 배경", colorTreatment: "선명한 포인트 컬러" }),
});

export const AD_MOOD_PRESET_IDS = Object.freeze([...adMoodPresets]);
export const IMAGE_STYLE_OPTIONS = Object.freeze([...imageStyleOptions]);
export const IMAGE_BACKGROUND_OPTIONS = Object.freeze(["흰 배경", "사무실", "책상 위", "스튜디오", "사용자 지정"]);
export const CANONICAL_OVERRIDE_FIELDS = Object.freeze(["adMoodPreset", "imageStyle", "imageBackground", "imageCustomBackground"]);
export const BRAND_STYLE_PRECEDENCE = Object.freeze(["product-and-legal", "job-override", "brand-kit", "app-defaults"]);
