import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, realpath, rm, stat } from "node:fs/promises";
import { join, parse, resolve, sep } from "node:path";

const MAX_BYTES = 2 * 1024 * 1024;
const TYPES = {
  "image/png": { extension: "png", dimensions: pngDimensions },
  "image/jpeg": { extension: "jpg", dimensions: jpegDimensions },
  "image/webp": { extension: "webp", dimensions: webpDimensions },
};

export function parseLogoDataUrl(dataUrl) {
  if (typeof dataUrl !== "string") throw logoError("INVALID_BRAND_KIT_LOGO", "로고 data URL이 필요합니다.");
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/u.exec(dataUrl);
  if (!match || !match[2] || match[2].length % 4 !== 0) throw logoError("INVALID_BRAND_KIT_LOGO", "올바른 base64 로고 data URL이 아닙니다.");
  const declaredType = match[1].toLowerCase();
  if (!Object.hasOwn(TYPES, declaredType)) throw logoError("BRAND_KIT_LOGO_TYPE_UNSUPPORTED", "PNG, JPEG, WebP 로고만 지원합니다.", 415);
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.toString("base64") !== match[2]) throw logoError("INVALID_BRAND_KIT_LOGO", "canonical base64 로고 data URL이 필요합니다.");
  if (bytes.length > MAX_BYTES) throw logoError("BRAND_KIT_LOGO_TOO_LARGE", "로고는 2MiB 이하여야 합니다.", 413);
  const detectedType = detectType(bytes);
  if (!detectedType || detectedType !== declaredType) throw logoError("BRAND_KIT_LOGO_TYPE_UNSUPPORTED", "선언한 MIME과 실제 로고 형식이 일치해야 합니다.", 415);
  const { width, height } = TYPES[detectedType].dimensions(bytes);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096 || width * height > 16_777_216) {
    throw logoError("INVALID_BRAND_KIT_LOGO", "로고 크기는 각 변 1~4096px, 총 16,777,216px 이하여야 합니다.");
  }
  const assetId = createHash("sha256").update(bytes).digest("hex");
  const extension = TYPES[detectedType].extension;
  const filename = `${assetId}.${extension}`;
  return { bytes, metadata: { assetId, filename, type: detectedType, size: bytes.length, url: `/outputs/brand-assets/${filename}` } };
}

export async function publishLogoAsset(assetsDir, parsed, options = {}) {
  const root = resolve(assetsDir);
  await mkdir(root, { recursive: true });
  const rootIdentity = await assetRootIdentity(root);
  const target = join(root, parsed.metadata.filename);
  const temporary = join(root, `.${parsed.metadata.assetId}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await assertOpenedAsset(handle, temporary, rootIdentity);
    await handle.writeFile(parsed.bytes);
    await (options.syncFile ?? syncHandle)(handle);
    await handle.close();
    handle = undefined;
    await assertSameAssetRoot(rootIdentity);
    try { await link(temporary, target); }
    catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const existing = await readPublishedLogoAsset(root, parsed.metadata.filename);
      const existingHash = createHash("sha256").update(existing).digest("hex");
      if (existing.length !== parsed.bytes.length || existingHash !== parsed.metadata.assetId) throw new Error("immutable logo asset integrity mismatch");
    }
    await assertSameAssetRoot(rootIdentity);
    await rm(temporary, { force: true });
    await (options.syncDirectory ?? syncDirectory)(root, rootIdentity);
  } catch (error) {
    await handle?.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  return structuredClone(parsed.metadata);
}

export async function openPublishedLogoAsset(assetsDir, filename, options = {}) {
  const root = resolve(assetsDir);
  const filePath = resolve(root, filename);
  if (!filePath.startsWith(`${root}${sep}`)) throw new Error("logo asset path escapes its root");
  const rootIdentity = await assetRootIdentity(root);
  let handle;
  try {
    await options.beforeOpen?.();
    handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    await assertOpenedAsset(handle, filePath, rootIdentity);
    return handle;
  } catch (error) {
    await handle?.close().catch(() => {});
    throw error;
  }
}

export async function readPublishedLogoAsset(assetsDir, filename) {
  const handle = await openPublishedLogoAsset(assetsDir, filename);
  try {
    return await handle.readFile();
  } finally {
    await handle.close().catch(() => {});
  }
}

function detectType(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "image/png";
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return undefined;
}

function pngDimensions(bytes) {
  if (bytes.length < 45) throw logoError("INVALID_BRAND_KIT_LOGO", "PNG 데이터가 잘렸습니다.");
  if (bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR" || bytes.toString("ascii", bytes.length - 8, bytes.length - 4) !== "IEND") throw logoError("INVALID_BRAND_KIT_LOGO", "PNG 헤더가 손상되었습니다.");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function jpegDimensions(bytes) {
  if (bytes.length < 22) throw logoError("INVALID_BRAND_KIT_LOGO", "JPEG 데이터가 잘렸습니다.");
  if (bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) throw logoError("INVALID_BRAND_KIT_LOGO", "JPEG 데이터가 잘렸습니다.");
  let offset = 2;
  while (offset + 4 <= bytes.length - 2) {
    if (bytes[offset] !== 0xff) throw logoError("INVALID_BRAND_KIT_LOGO", "JPEG marker가 손상되었습니다.");
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) throw logoError("INVALID_BRAND_KIT_LOGO", "JPEG segment가 잘렸습니다.");
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 7) break;
      return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  throw logoError("INVALID_BRAND_KIT_LOGO", "JPEG 크기 정보를 읽을 수 없습니다.");
}

function webpDimensions(bytes) {
  if (bytes.length < 30) throw logoError("INVALID_BRAND_KIT_LOGO", "WebP 데이터가 잘렸습니다.");
  if (bytes.readUInt32LE(4) + 8 !== bytes.length) throw logoError("INVALID_BRAND_KIT_LOGO", "WebP 데이터 길이가 올바르지 않습니다.");
  const kind = bytes.toString("ascii", 12, 16);
  const length = bytes.readUInt32LE(16);
  if (20 + length + (length % 2) > bytes.length) throw logoError("INVALID_BRAND_KIT_LOGO", "WebP chunk가 잘렸습니다.");
  if (kind === "VP8X" && length >= 10) return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
  if (kind === "VP8L" && length >= 5 && bytes[20] === 0x2f) return { width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8), height: 1 + ((bytes[22] & 0xc0) >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10) };
  if (kind === "VP8 " && length >= 10 && bytes.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))) return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  throw logoError("INVALID_BRAND_KIT_LOGO", "WebP 크기 정보를 읽을 수 없습니다.");
}

function logoError(code, message, status = 422) { return Object.assign(new Error(message), { name: "BrandKitLogoError", code, status, fields: [{ field: "logo", code, message }] }); }

async function assetRootIdentity(root) {
  await assertNoUnexpectedSymlinkComponents(root);
  const metadata = await lstat(root);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("brand asset root must be a real directory");
  return { path: root, realPath: await realpath(root), dev: metadata.dev, ino: metadata.ino };
}

async function assertNoUnexpectedSymlinkComponents(root) {
  const absolute = resolve(root);
  const { root: volumeRoot } = parse(absolute);
  let current = volumeRoot;
  for (const component of absolute.slice(volumeRoot.length).split(sep).filter(Boolean)) {
    current = join(current, component);
    const metadata = await lstat(current);
    if (!metadata.isSymbolicLink()) continue;
    const target = await realpath(current);
    const allowedSystemAlias = (current === "/var" && target === "/private/var")
      || (current === "/tmp" && target === "/private/tmp");
    if (!allowedSystemAlias) throw new Error("brand asset root cannot traverse symlink directories");
  }
}

async function assertSameAssetRoot(expected) {
  const current = await assetRootIdentity(expected.path);
  if (current.realPath !== expected.realPath || current.dev !== expected.dev || current.ino !== expected.ino) throw new Error("brand asset root changed during access");
}

async function assertOpenedAsset(handle, filePath, rootIdentity) {
  const [descriptor, target] = await Promise.all([handle.stat(), realpath(filePath)]);
  if (!descriptor.isFile() || descriptor.nlink !== 1 || !target.startsWith(`${rootIdentity.realPath}${sep}`)) throw new Error("brand asset is not a contained regular file");
  const pathMetadata = await stat(target);
  if (pathMetadata.dev !== descriptor.dev || pathMetadata.ino !== descriptor.ino) throw new Error("brand asset changed during access");
  await assertSameAssetRoot(rootIdentity);
}

async function syncHandle(handle) {
  await handle.sync();
}

async function syncDirectory(directory, rootIdentity) {
  let handle;
  try {
    handle = await open(directory, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = await handle.stat();
    if (!metadata.isDirectory() || metadata.dev !== rootIdentity.dev || metadata.ino !== rootIdentity.ino) throw new Error("brand asset root changed before sync");
    await handle.sync();
  } finally {
    await handle?.close().catch(() => {});
  }
}
