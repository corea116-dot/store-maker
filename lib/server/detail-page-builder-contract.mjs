import { getDetailPageSectionType, normalizeDetailPageSectionKind } from "./detail-page-section-registry.mjs";
import { DetailPageDocumentValidationError, normalizeDetailPageDocument } from "./detail-page-schema.mjs";

export const DETAIL_PAGE_BUILDER_OPERATIONS = Object.freeze(["template", "add", "regenerate"]);
export const DETAIL_PAGE_REGENERATION_MODES = Object.freeze(["copy", "image", "layout", "copy+image", "whole"]);

const allowedFieldsByMode = Object.freeze({
  copy: ["heading", "body", "bullets"],
  image: ["image"],
  layout: ["layout"],
  "copy+image": ["heading", "body", "bullets", "image"],
  whole: ["kind", "layout", "heading", "body", "bullets", "image"],
});

export class DetailPageBuilderRequestError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DetailPageBuilderRequestError";
    this.code = code;
  }
}

export function allowedCandidateFields(mode) {
  const fields = allowedFieldsByMode[mode];
  if (!fields) throw new DetailPageBuilderRequestError("INVALID_BUILDER_REQUEST", "지원하지 않는 부분 재생성 모드입니다.");
  return [...fields];
}

export function parseBuilderRequest(value, project) {
  const input = objectValue(value);
  const operation = input.operation;
  if (!DETAIL_PAGE_BUILDER_OPERATIONS.includes(operation)) {
    throw new DetailPageBuilderRequestError("INVALID_BUILDER_REQUEST", "지원하지 않는 상세페이지 빌더 작업입니다.");
  }
  if (!project || typeof project !== "object" || !Number.isSafeInteger(project.revision)) {
    throw new DetailPageBuilderRequestError("PROJECT_UNAVAILABLE", "상세페이지 프로젝트를 열 수 없습니다.");
  }
  if (operation === "template") {
    return {
      operation,
      category: text(input.category, "default", 80),
      selectedTemplateSectionIds: optionalStringArray(input.selectedTemplateSectionIds, 60, 120),
      instruction: optionalText(input.instruction, 2000),
      evidenceRefs: evidenceRefs(input.evidenceRefs, project.evidenceSources),
    };
  }
  if (operation === "add") {
    const source = input.source;
    if (source !== "registry" && source !== "instruction") {
      throw new DetailPageBuilderRequestError("INVALID_BUILDER_REQUEST", "섹션 추가 방식이 올바르지 않습니다.");
    }
    const afterSectionId = optionalText(input.afterSectionId, 120);
    if (afterSectionId && !project.document.sections.some((section) => section.id === afterSectionId)) {
      throw new DetailPageBuilderRequestError("INVALID_BUILDER_REQUEST", "삽입 기준 섹션을 찾을 수 없습니다.");
    }
    if (source === "registry") {
      const typeKey = normalizeDetailPageSectionKind(input.typeKey);
      if (!typeKey) throw new DetailPageBuilderRequestError("INVALID_BUILDER_REQUEST", "지원하지 않는 섹션 유형입니다.");
      return { operation, source, typeKey, afterSectionId, evidenceRefs: evidenceRefs(input.evidenceRefs, project.evidenceSources) };
    }
    return {
      operation,
      source,
      instruction: requiredText(input.instruction, "자연어 섹션 요청", 2000),
      afterSectionId,
      engine: engine(input.engine),
      evidenceRefs: evidenceRefs(input.evidenceRefs, project.evidenceSources),
    };
  }
  const sectionId = requiredText(input.sectionId, "섹션 ID", 120);
  const target = project.document.sections.find((section) => section.id === sectionId);
  if (!target) throw new DetailPageBuilderRequestError("INVALID_BUILDER_REQUEST", "다시 만들 섹션을 찾을 수 없습니다.");
  const mode = input.mode;
  const allowedFields = allowedCandidateFields(mode);
  return {
    operation,
    sectionId,
    target,
    mode,
    allowedFields,
    instruction: optionalText(input.instruction, 2000),
    engine: engine(input.engine),
    evidenceRefs: evidenceRefs(input.evidenceRefs, project.evidenceSources),
  };
}

export function normalizeCandidatePatch(project, targetSectionId, mode, value) {
  const targetIndex = project.document.sections.findIndex((section) => section.id === targetSectionId);
  if (targetIndex < 0) throw new DetailPageBuilderRequestError("INVALID_CANDIDATE_OUTPUT", "대상 섹션이 더 이상 없습니다.");
  const changes = objectValue(value, "INVALID_CANDIDATE_OUTPUT");
  const allowedFields = allowedCandidateFields(mode);
  const unexpected = Object.keys(changes).filter((key) => !allowedFields.includes(key));
  if (unexpected.length > 0) {
    throw new DetailPageBuilderRequestError("INVALID_CANDIDATE_OUTPUT", `허용되지 않은 후보 변경 필드: ${unexpected.join(", ")}`);
  }
  const preserved = ["id", "visible", "source"];
  if (preserved.some((key) => Object.hasOwn(changes, key))) {
    throw new DetailPageBuilderRequestError("INVALID_CANDIDATE_OUTPUT", "섹션 식별자, 표시 상태, 생성 출처는 후보가 변경할 수 없습니다.");
  }
  const nextSection = { ...project.document.sections[targetIndex], ...changes };
  try {
    const document = normalizeDetailPageDocument({
      ...project.document,
      schemaVersion: 2,
      sections: project.document.sections.map((section, index) => index === targetIndex ? nextSection : section),
    });
    const normalized = document.sections[targetIndex];
    const patch = Object.fromEntries(allowedFields.filter((field) => Object.hasOwn(changes, field)).map((field) => [field, structuredClone(normalized[field])]));
    return { allowedFields, patch, section: normalized };
  } catch (error) {
    const message = error instanceof DetailPageDocumentValidationError ? error.message : "후보 응답 형식이 올바르지 않습니다.";
    throw new DetailPageBuilderRequestError("INVALID_CANDIDATE_OUTPUT", message);
  }
}

export function normalizeCandidateSection(project, value) {
  try {
    const document = normalizeDetailPageDocument({
      ...project.document,
      schemaVersion: 2,
      sections: [...project.document.sections, value],
    });
    return document.sections.at(-1);
  } catch (error) {
    const message = error instanceof DetailPageDocumentValidationError ? error.message : "후보 응답 형식이 올바르지 않습니다.";
    throw new DetailPageBuilderRequestError("INVALID_CANDIDATE_OUTPUT", message);
  }
}

export function candidateEvidence(sectionKinds, refs = [], evidenceSources = []) {
  const required = [...new Set(sectionKinds
    .map((kind) => getDetailPageSectionType(kind)?.evidencePolicy)
    .filter((policy) => policy && policy !== "not-applicable"))];
  if (required.length === 0) return { status: "not-applicable", refs: [], warnings: [] };
  const availableSources = new Map(Array.isArray(evidenceSources)
    ? evidenceSources
      .filter((source) => typeof source?.id === "string" && typeof source?.excerpt === "string" && source.excerpt.trim())
      .map((source) => [source.id, source])
    : []);
  const verifiedRefs = refs.filter((ref) => availableSources.has(ref));
  if (verifiedRefs.length > 0) {
    return {
      status: "source-linked",
      refs: verifiedRefs,
      warnings: ["선택한 자료 파일의 텍스트 발췌를 후보 생성에 연결했습니다. 자동 사실 검증은 아니므로 적용 전에 원문과 문구가 일치하는지 확인하세요."],
    };
  }
  const reviewOnly = required.every((policy) => policy === "reviews-required");
  return {
    status: "needs-input",
    refs: [],
    warnings: [reviewOnly
      ? "실제 고객 후기, 별점, 구매자 수는 텍스트 내용을 확인할 수 있는 등록 자료 파일이 있을 때만 적용할 수 있습니다."
      : "인증, 수치, 성분, 보증, 전후 효과 같은 사실은 텍스트 내용을 확인할 수 있는 등록 자료 파일이 있을 때만 적용할 수 있습니다."],
  };
}

function engine(value) {
  const input = objectValue(value, "INVALID_BUILDER_REQUEST");
  const mode = input.mode;
  if (mode !== "local-cli" && mode !== "byok-http") {
    throw new DetailPageBuilderRequestError("INVALID_BUILDER_REQUEST", "AI 후보 생성에 사용할 엔진 설정이 필요합니다.");
  }
  const engineId = requiredText(input.engineId, "엔진 ID", 40);
  if (mode === "local-cli" && !optionalText(input.command, 1000)) {
    throw new DetailPageBuilderRequestError("INVALID_BUILDER_REQUEST", "로컬 CLI 명령이 필요합니다.");
  }
  return structuredClone(input);
}

function evidenceRefs(value, evidenceSources) {
  const allowedIds = new Set(Array.isArray(evidenceSources)
    ? evidenceSources
      .filter((source) => typeof source?.id === "string" && typeof source?.excerpt === "string" && source.excerpt.trim())
      .map((source) => source.id)
    : []);
  return optionalStringArray(value, 20, 500).filter((ref) => allowedIds.has(ref));
}

function requiredText(value, label, maxLength) {
  const normalized = optionalText(value, maxLength);
  if (!normalized) throw new DetailPageBuilderRequestError("INVALID_BUILDER_REQUEST", `${label}이 필요합니다.`);
  return normalized;
}

function optionalText(value, maxLength) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new DetailPageBuilderRequestError("INVALID_BUILDER_REQUEST", "텍스트 입력 형식이 올바르지 않습니다.");
  const normalized = value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, "").trim();
  if (normalized.length > maxLength) throw new DetailPageBuilderRequestError("INVALID_BUILDER_REQUEST", "입력 길이가 너무 깁니다.");
  return normalized;
}

function text(value, fallback, maxLength) {
  return optionalText(value, maxLength) || fallback;
}

function optionalStringArray(value, maxItems, maxLength) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems) throw new DetailPageBuilderRequestError("INVALID_BUILDER_REQUEST", "목록 입력 형식이 올바르지 않습니다.");
  return [...new Set(value.map((item) => requiredText(item, "목록 항목", maxLength)))];
}

function objectValue(value, code = "INVALID_BUILDER_REQUEST") {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DetailPageBuilderRequestError(code, code === "INVALID_CANDIDATE_OUTPUT" ? "AI 후보 응답은 JSON 객체여야 합니다." : "요청 본문은 JSON 객체여야 합니다.");
  }
  return value;
}
