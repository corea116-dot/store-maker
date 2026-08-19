import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { BRAND_ASSETS_DIR, BRAND_KIT_STATE_FILE } from "./config.mjs";
import { parseLogoDataUrl, publishLogoAsset } from "./brand-kit-assets.mjs";
import { normalizeBrandKit } from "./brand-kit-model.mjs";

const transactionChains = new Map();

export class BrandKitStoreError extends Error {
  constructor(code, message, { status = 500, fields, current, cause } = {}) {
    super(message, { cause });
    this.name = "BrandKitStoreError";
    this.code = code;
    this.status = status;
    if (fields) this.fields = fields;
    if (current !== undefined) this.current = structuredClone(current);
  }
}

export function createBrandKitStore(options = {}) {
  const registryFile = resolve(options.registryFile ?? BRAND_KIT_STATE_FILE);
  const assetsDir = resolve(options.assetsDir ?? BRAND_ASSETS_DIR);
  const now = options.now ?? (() => new Date().toISOString());
  const createId = options.createId ?? randomUUID;
  let committed;

  const transact = (operation) => enqueue(registryFile, async () => {
    const registry = await loadRegistry(registryFile);
    const result = await operation(registry);
    if (!result?.next) return result?.value;
    await persistRegistry(registryFile, result.next, options.beforeRegistryRename);
    committed = result.next;
    return result.value(committed);
  });

  return {
    read: () => transact((registry) => ({ value: clone(registry) })),

    create(input = {}) {
      return transact(async (registry) => {
        if (registry.kits.length >= 50) throw domain("BRAND_KIT_LIMIT_REACHED", "브랜드 키트는 최대 50개까지 저장할 수 있습니다.", 422);
        if (input.setAsDefault === true) requireRegistryRevision(registry, input.expectedRegistryRevision);
        else if (input.expectedRegistryRevision !== undefined) requireRegistryRevision(registry, input.expectedRegistryRevision);
        const timestamp = now();
        const identity = { id: createId(), revision: 1, createdAt: timestamp, updatedAt: timestamp };
        const validated = normalizeBrandKit({ ...input.kit, ...identity, logo: null });
        const logo = input.logoDataUrl === undefined || input.logoDataUrl === null ? null : await writeLogo(input.logoDataUrl, assetsDir);
        const kit = logo ? attachTrustedLogo(validated, logo) : validated;
        const next = { ...registry, registryRevision: registry.registryRevision + 1, defaultBrandKitId: input.setAsDefault === true ? kit.id : registry.defaultBrandKitId, kits: [...registry.kits, kit] };
        return { next, value: (saved) => ({ registry: clone(saved), kit: clone(kit) }) };
      });
    },

    update(input = {}) {
      return transact(async (registry) => {
        const index = findKitIndex(registry, input.id);
        const current = registry.kits[index];
        requireKitRevision(current, input.expectedRevision);
        validateLogoChange(input.logoChange);
        const identity = { id: current.id, revision: current.revision + 1, createdAt: current.createdAt, updatedAt: now() };
        const validated = normalizeBrandKit({ ...input.kit, ...identity, logo: current.logo });
        const logo = await updatedLogo(current.logo, input.logoChange, assetsDir);
        const kit = attachTrustedLogo(validated, logo);
        const kits = registry.kits.slice(); kits[index] = kit;
        const next = { ...registry, registryRevision: registry.registryRevision + 1, kits };
        return { next, value: (saved) => ({ registry: clone(saved), kit: clone(kit) }) };
      });
    },

    setDefault(input = {}) {
      return transact((registry) => {
        requireRegistryRevision(registry, input.expectedRegistryRevision);
        findKitIndex(registry, input.id);
        const next = { ...registry, registryRevision: registry.registryRevision + 1, defaultBrandKitId: input.id };
        return { next, value: clone };
      });
    },

    duplicate(input = {}) {
      return transact((registry) => {
        if (registry.kits.length >= 50) throw domain("BRAND_KIT_LIMIT_REACHED", "브랜드 키트는 최대 50개까지 저장할 수 있습니다.", 422);
        const source = registry.kits[findKitIndex(registry, input.id)];
        requireKitRevision(source, input.expectedRevision);
        const timestamp = now();
        const normalized = normalizeBrandKit({ ...source, id: createId(), revision: 1, name: input.name ?? `${source.name} 복사본`, createdAt: timestamp, updatedAt: timestamp });
        const kit = { ...normalized, sourceUrlSafety: clone(source.sourceUrlSafety) };
        const next = { ...registry, registryRevision: registry.registryRevision + 1, kits: [...registry.kits, kit] };
        return { next, value: (saved) => ({ registry: clone(saved), kit: clone(kit) }) };
      });
    },

    delete(input = {}) {
      return transact((registry) => {
        requireRegistryRevision(registry, input.expectedRegistryRevision);
        const index = findKitIndex(registry, input.id);
        requireKitRevision(registry.kits[index], input.expectedRevision);
        const next = { ...registry, registryRevision: registry.registryRevision + 1, defaultBrandKitId: registry.defaultBrandKitId === input.id ? null : registry.defaultBrandKitId, kits: registry.kits.filter(({ id }) => id !== input.id) };
        return { next, value: clone };
      });
    },

    resolveKit(input = {}) {
      return transact(async (registry) => {
        const kit = registry.kits[findKitIndex(registry, input.id)];
        requireKitRevision(kit, input.expectedRevision);
        await verifyLogoAsset(kit.logo, assetsDir);
        return { value: { kit: clone(kit), ...(kit.logo ? { logoAbsolutePath: join(assetsDir, kit.logo.filename) } : {}) } };
      });
    },

    paths: Object.freeze({ registryFile, assetsDir }),
  };
}

function enqueue(key, operation) {
  const pending = (transactionChains.get(key) ?? Promise.resolve()).catch(() => {}).then(operation);
  const tail = pending.catch(() => {});
  transactionChains.set(key, tail);
  void tail.then(() => { if (transactionChains.get(key) === tail) transactionChains.delete(key); });
  return pending;
}

async function loadRegistry(registryFile) {
  let source;
  try { source = await readFile(registryFile, "utf8"); }
  catch (error) { if (error?.code === "ENOENT") return emptyRegistry(); throw invalidStore(error); }
  try { return validateRegistry(JSON.parse(source)); }
  catch (error) { if (error instanceof BrandKitStoreError) throw error; throw invalidStore(error); }
}

function validateRegistry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schemaVersion !== 1 || !Number.isSafeInteger(value.registryRevision) || value.registryRevision < 0 || !Array.isArray(value.kits) || value.kits.length > 50) throw invalidStore();
  const kits = value.kits.map((kit) => {
    const normalized = normalizeBrandKit(kit);
    validateStoredSourceSafety(kit.sourceUrlSafety, normalized.sourceUrlSafety);
    return { ...normalized, sourceUrlSafety: clone(kit.sourceUrlSafety) };
  });
  const ids = new Set(kits.map(({ id }) => id));
  if (ids.size !== kits.length || (value.defaultBrandKitId !== null && !ids.has(value.defaultBrandKitId))) throw invalidStore();
  for (const kit of kits) validateStoredLogo(kit.logo);
  return { schemaVersion: 1, registryRevision: value.registryRevision, defaultBrandKitId: value.defaultBrandKitId, kits };
}

function validateStoredLogo(logo) {
  if (!logo) return;
  const match = /^([a-f0-9]{64})\.(png|jpg|webp)$/u.exec(logo.filename);
  const expectedType = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" }[match?.[2]];
  if (!match || logo.assetId !== match[1] || logo.type !== expectedType || logo.url !== `/outputs/brand-assets/${logo.filename}`) throw invalidStore();
}

function validateStoredSourceSafety(value, expected) {
  const statuses = ["absent", "unsafe-for-future-fetch", "safe-reference"];
  if (!value || typeof value !== "object" || !statuses.includes(value.status) || typeof value.safeForFutureFetch !== "boolean" || typeof value.reason !== "string" || !value.reason) throw invalidStore();
  const strippedReason = "URL의 자격 정보, query, fragment를 제외한 참조 주소만 사용했습니다.";
  if (value.status !== expected.status || value.safeForFutureFetch !== expected.safeForFutureFetch || (value.reason !== expected.reason && !(value.status === "safe-reference" && value.reason === strippedReason))) throw invalidStore();
}

async function verifyLogoAsset(logo, assetsDir) {
  if (!logo) return;
  try {
    const bytes = await readFile(join(assetsDir, logo.filename));
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (bytes.length !== logo.size || hash !== logo.assetId) throw new Error("asset integrity mismatch");
  } catch (cause) {
    throw new BrandKitStoreError("BRAND_KIT_ASSET_MISSING", "브랜드 로고 자산을 확인할 수 없습니다.", { cause });
  }
}

async function updatedLogo(current, change, assetsDir) {
  if (change.action === "keep") { if (Object.hasOwn(change, "dataUrl")) throw domain("INVALID_LOGO_CHANGE", "keep에는 dataUrl을 보낼 수 없습니다.", 422); return clone(current); }
  if (change.action === "remove") { if (Object.hasOwn(change, "dataUrl")) throw domain("INVALID_LOGO_CHANGE", "remove에는 dataUrl을 보낼 수 없습니다.", 422); return null; }
  return writeLogo(change.dataUrl, assetsDir);
}

function validateLogoChange(change) {
  if (!change || typeof change !== "object" || !["keep", "remove", "replace"].includes(change.action)) throw domain("INVALID_LOGO_CHANGE", "logoChange action은 keep, remove, replace 중 하나여야 합니다.", 422, [{ field: "logoChange.action", code: "invalid", message: "명시적인 로고 변경 방식이 필요합니다." }]);
}

async function writeLogo(dataUrl, assetsDir) {
  try { return await publishLogoAsset(assetsDir, parseLogoDataUrl(dataUrl)); }
  catch (error) { throw new BrandKitStoreError(error?.code ?? "BRAND_KIT_ASSET_WRITE_FAILED", error?.message ?? "브랜드 로고 저장에 실패했습니다.", { status: error?.status ?? 500, fields: error?.fields, cause: error }); }
}
function attachTrustedLogo(validated, logo) { const normalized = normalizeBrandKit({ ...validated, logo }); return { ...normalized, sourceUrlSafety: clone(validated.sourceUrlSafety) }; }
function emptyRegistry() { return { schemaVersion: 1, registryRevision: 0, defaultBrandKitId: null, kits: [] }; }
function findKitIndex(registry, id) { const index = registry.kits.findIndex((kit) => kit.id === id); if (index < 0) throw domain("BRAND_KIT_NOT_FOUND", "브랜드 키트를 찾을 수 없습니다.", 404); return index; }
function requireKitRevision(kit, expected) { if (!Number.isSafeInteger(expected) || kit.revision !== expected) throw domain("BRAND_KIT_REVISION_CONFLICT", "브랜드 키트가 다른 곳에서 변경되었습니다.", 409, undefined, kit); }
function requireRegistryRevision(registry, expected) { if (!Number.isSafeInteger(expected) || registry.registryRevision !== expected) throw domain("BRAND_KIT_REGISTRY_CONFLICT", "브랜드 키트 목록이 다른 곳에서 변경되었습니다.", 409, undefined, registry); }
function domain(code, message, status, fields, current) { return new BrandKitStoreError(code, message, { status, fields, current }); }
function invalidStore(cause) { return new BrandKitStoreError("BRAND_KIT_STORE_INVALID", "브랜드 키트 저장소가 손상되어 원본을 보존했습니다.", { cause }); }
function clone(value) { return value === undefined ? undefined : structuredClone(value); }

async function persistRegistry(registryFile, registry, beforeRename) {
  await mkdir(dirname(registryFile), { recursive: true });
  const temporary = `${registryFile}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(registry, null, 2)}\n`, "utf8");
    try { await handle.sync(); } catch {}
    await handle.close(); handle = undefined;
    await beforeRename?.({ temporary, registryFile, registry: clone(registry) });
    await rename(temporary, registryFile);
    await syncDirectory(dirname(registryFile));
  } catch (error) {
    await handle?.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    if (error instanceof BrandKitStoreError) throw error;
    throw new BrandKitStoreError("BRAND_KIT_STORE_WRITE_FAILED", "브랜드 키트 저장에 실패했습니다.", { cause: error });
  }
}

async function syncDirectory(directory) { let handle; try { handle = await open(directory, "r"); await handle.sync(); } catch {} finally { await handle?.close().catch(() => {}); } }
