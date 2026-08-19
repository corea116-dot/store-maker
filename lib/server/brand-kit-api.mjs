import { BrandKitStoreError } from "./brand-kit-store.mjs";
import { BrandKitValidationError } from "./brand-kit-model.mjs";

const KIT_PATH = /^\/api\/brand-kits\/([^/]+)(?:\/(duplicate|default|delete))?$/u;
const SAFE_ID = /^[A-Za-z0-9_-]{1,120}$/u;

export async function handleBrandKitApi({ method, pathname, body, store }) {
  const route = parseRoute(method, pathname);
  if (!route.handled) return route;
  if (route.error) return failure(400, "INVALID_BRAND_KIT_PATH", route.error);
  try {
    if (route.action === "list") return success(200, publicRegistry(await store.read()));
    if (!body || typeof body !== "object" || Array.isArray(body)) return failure(400, "INVALID_REQUEST", "요청 본문은 JSON 객체여야 합니다.");
    const assetFailure = untrustedAssetFailure(body, route.action);
    if (assetFailure) return assetFailure;
    if (route.action === "create") {
      const result = await store.create({
        kit: body.kit,
        logoDataUrl: body.logoDataUrl,
        setAsDefault: body.setAsDefault === true,
        expectedRegistryRevision: body.expectedRegistryRevision,
      });
      return success(201, publicMutation(result));
    }
    if (route.action === "update") {
      const logoChangeFailure = invalidLogoChangeShape(body.logoChange);
      if (logoChangeFailure) return logoChangeFailure;
      const result = await store.update({ id: route.id, expectedRevision: body.expectedRevision, kit: body.kit, logoChange: body.logoChange });
      return success(200, publicMutation(result));
    }
    if (route.action === "duplicate") {
      if (Object.hasOwn(body, "setAsDefault") || Object.hasOwn(body, "expectedRegistryRevision") || Object.hasOwn(body, "logoDataUrl") || Object.hasOwn(body, "logoChange")) {
        return failure(400, "INVALID_DUPLICATE_REQUEST", "복제 요청은 기본 키트나 로고를 함께 변경할 수 없습니다.");
      }
      const result = await store.duplicate({ id: route.id, expectedRevision: body.expectedRevision, name: body.name });
      return success(201, publicMutation(result));
    }
    if (route.action === "default") return success(200, publicRegistry(await store.setDefault({ id: route.id, expectedRegistryRevision: body.expectedRegistryRevision })));
    return success(200, publicRegistry(await store.delete({ id: route.id, expectedRevision: body.expectedRevision, expectedRegistryRevision: body.expectedRegistryRevision })));
  } catch (error) {
    return mapError(error);
  }
}

function parseRoute(method, pathname) {
  if (pathname === "/api/brand-kits") {
    if (method === "GET") return { handled: true, action: "list" };
    if (method === "POST") return { handled: true, action: "create" };
    return { handled: false };
  }
  if (!pathname.startsWith("/api/brand-kits/")) return { handled: false };
  const match = KIT_PATH.exec(pathname);
  if (!match) return { handled: true, error: "브랜드 키트 경로가 올바르지 않습니다." };
  let id;
  try { id = decodeURIComponent(match[1]); } catch { return { handled: true, error: "브랜드 키트 ID 인코딩이 올바르지 않습니다." }; }
  if (!SAFE_ID.test(id)) return { handled: true, error: "브랜드 키트 ID가 올바르지 않습니다." };
  const suffix = match[2];
  if (!suffix && method === "PUT") return { handled: true, action: "update", id };
  if (suffix && method === "POST") return { handled: true, action: suffix, id };
  return { handled: false };
}

function publicMutation({ registry, kit }) { return { ...publicRegistry(registry), kit: publicKit(kit) }; }
function publicRegistry(registry) { return { registryRevision: registry.registryRevision, defaultBrandKitId: registry.defaultBrandKitId, kits: registry.kits.map(publicKit) }; }
function publicKit(kit) {
  return structuredClone({
    schemaVersion: kit.schemaVersion, id: kit.id, revision: kit.revision, name: kit.name,
    sourceUrl: kit.sourceUrl, sourceUrlSafety: kit.sourceUrlSafety, logo: kit.logo,
    colors: kit.colors, typography: kit.typography, voice: kit.voice, imagery: kit.imagery,
    defaults: kit.defaults, createdAt: kit.createdAt, updatedAt: kit.updatedAt,
  });
}

function mapError(error) {
  if (error instanceof BrandKitStoreError || error instanceof BrandKitValidationError) {
    const status = [400, 404, 409, 413, 415, 422, 500].includes(error.status) ? error.status : 500;
    const fields = Array.isArray(error.fields) ? structuredClone(error.fields) : undefined;
    const current = error.current === undefined ? undefined : publicCurrent(error.current);
    return { handled: true, status, payload: { ok: false, error: { code: error.code ?? "BRAND_KIT_ERROR", message: error.message, ...(fields ? { fields } : {}) }, ...(current !== undefined ? { current } : {}) } };
  }
  return failure(500, "BRAND_KIT_OPERATION_FAILED", "브랜드 키트 작업을 완료할 수 없습니다.");
}

function publicCurrent(current) {
  if (current && Array.isArray(current.kits)) return publicRegistry(current);
  if (current && typeof current === "object" && current.id) return publicKit(current);
  return undefined;
}
function untrustedAssetFailure(body, action) {
  const allowedDataUrl = action === "create"
    ? ["logoDataUrl"]
    : action === "update" && body.logoChange?.action === "replace" ? ["logoChange", "dataUrl"] : undefined;
  if (findAssetAlias(body, [], allowedDataUrl)) {
    return failure(422, "UNTRUSTED_BRAND_KIT_ASSET", "클라이언트 로고 경로나 자산 메타데이터는 사용할 수 없습니다.");
  }
  return undefined;
}
function findAssetAlias(value, path, allowedDataUrl) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item, index) => findAssetAlias(item, [...path, String(index)], allowedDataUrl));
  const forbidden = new Set(["logo", "logourl", "logopath", "logohash", "assetid", "path", "url", "hash", "filename", "absolutepath", "runtime", "data", "bytes", "base64", "dataurl"]);
  return Object.entries(value).some(([key, nested]) => {
    const nextPath = [...path, key];
    const normalized = key.replace(/[-_]/gu, "").toLowerCase();
    const approved = allowedDataUrl && nextPath.length === allowedDataUrl.length && nextPath.every((segment, index) => segment === allowedDataUrl[index]);
    const prefixedAssetAlias = ["logo", "asset", "file"].some((prefix) => normalized.startsWith(prefix))
      && ["url", "path", "hash", "filename", "data", "bytes", "base64", "id"].some((fragment) => normalized.includes(fragment));
    return ((forbidden.has(normalized) || prefixedAssetAlias) && !approved) || findAssetAlias(nested, nextPath, allowedDataUrl);
  });
}
function invalidLogoChangeShape(change) {
  if (!change || typeof change !== "object" || Array.isArray(change)) return undefined;
  const allowed = change.action === "replace" ? ["action", "dataUrl"] : ["action"];
  if (Object.keys(change).some((key) => !allowed.includes(key))) return failure(422, "INVALID_LOGO_CHANGE", "logoChange에는 선택한 action에 필요한 필드만 보낼 수 있습니다.");
  return undefined;
}
function success(status, value) { return { handled: true, status, payload: { ok: true, ...value } }; }
function failure(status, code, message) { return { handled: true, status, payload: { ok: false, error: { code, message } } }; }
