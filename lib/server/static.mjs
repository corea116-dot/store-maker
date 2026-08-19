import { constants, createReadStream } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { extname, resolve, sep } from "node:path";
import { BRAND_ASSETS_DIR, IMAGE_RUNS_DIR, ROOT } from "./config.mjs";
import { openPublishedLogoAsset } from "./brand-kit-assets.mjs";

const TOKEN_PLACEHOLDER = "__STORE_MAKER_TOKEN__";

export async function serveStatic(pathname, response, sendJson, localToken, options = {}) {
  const brandAssetsDir = resolve(options.brandAssetsDir ?? BRAND_ASSETS_DIR);
  const publicPath = publicFilePath(pathname);
  if (!publicPath) {
    sendJson(response, 404, { ok: false, error: { code: "NOT_FOUND", message: "Not found" } });
    return;
  }
  const decodedPath = decodePath(publicPath);
  if (!decodedPath) {
    sendJson(response, 404, { ok: false, error: { code: "NOT_FOUND", message: "Not found" } });
    return;
  }
  const brandAsset = /^\/outputs\/brand-assets\/([a-f0-9]{64}\.(?:png|jpg|webp))$/u.exec(decodedPath);
  const filePath = brandAsset ? resolve(brandAssetsDir, brandAsset[1]) : resolve(ROOT, `.${decodedPath}`);
  if (!isAllowedResolvedPath(filePath, brandAsset ? brandAssetsDir : undefined)) {
    sendJson(response, 404, { ok: false, error: { code: "NOT_FOUND", message: "Not found" } });
    return;
  }
  let brandAssetHandle;
  try {
    if (brandAsset) {
      brandAssetHandle = await openPublishedLogoAsset(brandAssetsDir, brandAsset[1], { beforeOpen: options.beforeBrandAssetOpen });
    } else {
      await access(filePath, constants.R_OK);
    }
  } catch (error) {
    await brandAssetHandle?.close().catch(() => {});
    sendJson(response, 404, { ok: false, error: { code: "NOT_FOUND", message: "Not found" } });
    return;
  }
  if (filePath === resolve(ROOT, "index.html")) {
    const html = await readFile(filePath, "utf8");
    response.writeHead(200, { "content-type": mimeType(filePath) });
    response.end(options.method === "HEAD" ? undefined : html.replace(TOKEN_PLACEHOLDER, localToken));
    return;
  }
  if (brandAssetHandle) {
    try {
      response.writeHead(200, { "content-type": mimeType(filePath) });
      if (options.method === "HEAD") { response.end(); return; }
      await pipeline(brandAssetHandle.createReadStream(), response);
      return;
    } finally {
      await brandAssetHandle.close().catch(() => {});
    }
  }
  response.writeHead(200, { "content-type": mimeType(filePath) });
  if (options.method === "HEAD") { response.end(); return; }
  createReadStream(filePath).pipe(response);
}

function publicFilePath(pathname) {
  if (pathname === "/") return "/index.html";
  if (pathname === "/index.html") return "/index.html";
  if (pathname.startsWith("/assets/") && !pathname.includes("..")) return pathname;
  if (pathname.startsWith("/outputs/image-runs/") && !pathname.includes("..")) return pathname;
  if (pathname.startsWith("/outputs/brand-assets/") && !pathname.includes("..")) return pathname;
  return undefined;
}

function decodePath(pathname) {
  try {
    return decodeURIComponent(pathname);
  } catch (error) {
    return undefined;
  }
}

function isAllowedResolvedPath(filePath, brandAssetsRoot) {
  const indexPath = resolve(ROOT, "index.html");
  const assetsRoot = resolve(ROOT, "assets");
  const imageRunsRoot = resolve(IMAGE_RUNS_DIR);
  return filePath === indexPath || filePath.startsWith(`${assetsRoot}${sep}`) || (filePath.startsWith(`${imageRunsRoot}${sep}`) && isImageFile(filePath)) || (brandAssetsRoot && filePath.startsWith(`${brandAssetsRoot}${sep}`) && isImageFile(filePath));
}

function mimeType(filePath) {
  const ext = extname(filePath);
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js" || ext === ".mjs") return "text/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

function isImageFile(filePath) {
  return [".png", ".jpg", ".jpeg", ".webp"].includes(extname(filePath).toLowerCase());
}
