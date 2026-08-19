import { BrandKitStoreError } from "./brand-kit-store.mjs";
import {
  BrandKitValidationError,
  createBrandKitApplication,
  deriveEffectiveBrandStyle,
} from "./brand-kit-model.mjs";

const SELECTION_FIELDS = new Set(["enabled", "id", "expectedRevision", "overrides"]);
const HOSTILE_FIELDS = new Set([
  "brandKitSnapshot", "effectiveBrandStyle", "brandKitRuntime", "runtime",
  "logoAbsolutePath", "sourceSnapshot", "oldSnapshot",
]);

export class BrandKitResolutionError extends Error {
  constructor(status, code, message, { fields, current } = {}) {
    super(message);
    this.name = "BrandKitResolutionError";
    this.status = status;
    this.code = code;
    if (fields) this.fields = structuredClone(fields);
    if (current !== undefined) this.current = publicCurrent(current);
  }
}

export async function resolveBrandKitSelection(body, { store, now = () => new Date().toISOString() }) {
  const source = objectBody(body);
  const clean = stripHostileFields(source);
  const selection = source.brandKitSelection;
  if (selection === undefined || selection === null) return clean;
  if (!isRecord(selection)) throw validation("brandKitSelection", "요청 선택값은 객체여야 합니다.");
  if (selection.enabled === false) return clean;
  if (selection.enabled !== true) throw validation("brandKitSelection.enabled", "enabled는 true 또는 false여야 합니다.");
  const unexpected = Object.keys(selection).filter((field) => !SELECTION_FIELDS.has(field));
  if (unexpected.length) throw validation(`brandKitSelection.${unexpected[0]}`, "허용되지 않는 선택 필드입니다.");
  if (typeof selection.id !== "string" || !/^[A-Za-z0-9_-]{1,120}$/u.test(selection.id)) {
    throw validation("brandKitSelection.id", "안전한 브랜드 키트 ID가 필요합니다.");
  }
  if (!Number.isSafeInteger(selection.expectedRevision) || selection.expectedRevision < 1) {
    throw validation("brandKitSelection.expectedRevision", "양의 정수 revision이 필요합니다.");
  }
  if (selection.overrides !== undefined && !isRecord(selection.overrides)) {
    throw validation("brandKitSelection.overrides", "오버라이드는 객체여야 합니다.");
  }

  try {
    const resolved = await store.resolveKit({ id: selection.id, expectedRevision: selection.expectedRevision });
    const overrides = selection.overrides ?? {};
    const application = createBrandKitApplication(resolved.kit, {
      appliedAt: now(),
      logoAbsolutePath: resolved.logoAbsolutePath,
      overrideFields: Object.keys(overrides),
    });
    const effectiveBrandStyle = deriveEffectiveBrandStyle(application.snapshot, overrides, resolved.kit.defaults);
    return {
      ...clean,
      brandKitSelection: {
        enabled: true,
        id: selection.id,
        expectedRevision: selection.expectedRevision,
        overrides: structuredClone(overrides),
      },
      brandKitSnapshot: deepFreeze(structuredClone(application.snapshot)),
      effectiveBrandStyle: deepFreeze(structuredClone(effectiveBrandStyle)),
      runtime: deepFreeze(structuredClone(application.runtime)),
    };
  } catch (error) {
    if (error instanceof BrandKitValidationError) {
      throw new BrandKitResolutionError(422, error.code, error.message, { fields: error.fields });
    }
    if (error instanceof BrandKitStoreError) {
      if (["BRAND_KIT_NOT_FOUND", "BRAND_KIT_REVISION_CONFLICT"].includes(error.code)) {
        throw new BrandKitResolutionError(409, "BRAND_KIT_CHANGED", "브랜드 키트가 변경되었거나 삭제되었습니다.", { current: error.current ?? null });
      }
      if (error.code === "BRAND_KIT_ASSET_MISSING") {
        throw new BrandKitResolutionError(409, error.code, error.message, { current: null });
      }
      throw new BrandKitResolutionError(error.status ?? 500, error.code ?? "BRAND_KIT_RESOLUTION_FAILED", error.message, { fields: error.fields });
    }
    throw error;
  }
}

function stripHostileFields(source) {
  return Object.fromEntries(Object.entries(source).filter(([field]) => field !== "brandKitSelection" && !HOSTILE_FIELDS.has(field)));
}

function validation(field, message) {
  return new BrandKitResolutionError(422, "VALIDATION_ERROR", "브랜드 키트 선택값을 확인하세요.", {
    fields: [{ field, code: "invalid", message }],
  });
}

function publicCurrent(current) {
  if (current === null) return null;
  if (!isRecord(current)) return undefined;
  return structuredClone({
    schemaVersion: current.schemaVersion, id: current.id, revision: current.revision,
    name: current.name, sourceUrl: current.sourceUrl, sourceUrlSafety: current.sourceUrlSafety,
    logo: current.logo, colors: current.colors, typography: current.typography,
    voice: current.voice, imagery: current.imagery, defaults: current.defaults,
    createdAt: current.createdAt, updatedAt: current.updatedAt,
  });
}

function objectBody(value) {
  if (!isRecord(value)) throw validation("request", "요청 본문은 JSON 객체여야 합니다.");
  return value;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
