import { extname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { BRAND_ASSETS_DIR, IMAGE_RUNS_DIR, ROOT } from "./config.mjs";
import { openPublishedLogoAsset } from "./brand-kit-assets.mjs";
import { parseOutputImageUrl } from "./detail-page-schema.mjs";
import { openContainedRegularFile } from "./safe-files.mjs";

const TOKEN_PLACEHOLDER = "__STORE_MAKER_TOKEN__";

export async function serveStatic(pathname, response, sendJson, localToken, options = {}) {
  const method = options.method ?? "GET";
  const brandAsset = parseBrandAssetPath(pathname);
  if (brandAsset) {
    await serveBrandAsset(brandAsset, response, sendJson, options, method);
    return;
  }
  const target = publicFileTarget(pathname, options.imageRunsDirectory ?? IMAGE_RUNS_DIR);
  if (!target) {
    sendJson(response, 404, { ok: false, error: { code: "NOT_FOUND", message: "Not found" } });
    return;
  }

  let opened;
  try {
    opened = await openContainedRegularFile(target.root, target.path);
    if (target.index) {
      const html = await opened.handle.readFile("utf8");
      response.writeHead(200, { "content-type": mimeType(target.path) });
      response.end(method === "HEAD" ? undefined : html.replace(TOKEN_PLACEHOLDER, localToken));
      return;
    }
    response.writeHead(200, { "content-type": mimeType(target.path) });
    if (method === "HEAD") { response.end(); return; }
    await pipeline(opened.handle.createReadStream({ autoClose: false }), response);
  } catch (error) {
    if (!response.headersSent) {
      sendJson(response, 404, { ok: false, error: { code: "NOT_FOUND", message: "Not found" } });
    } else if (!response.writableEnded) {
      response.destroy();
    }
  } finally {
    await opened?.handle.close().catch(() => {});
  }
}

function publicFileTarget(pathname, imageRunsDirectory) {
  if (pathname === "/" || pathname === "/index.html") {
    return { root: ROOT, path: resolve(ROOT, "index.html"), index: true };
  }
  if (pathname.startsWith("/assets/")) {
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch (error) {
      return undefined;
    }
    const assetsRoot = resolve(ROOT, "assets");
    return { root: assetsRoot, path: resolve(assetsRoot, decoded.slice("/assets/".length)) };
  }
  const outputImage = parseOutputImageUrl(pathname);
  if (!outputImage) return undefined;
  const imageRunsRoot = resolve(imageRunsDirectory);
  return { root: imageRunsRoot, path: resolve(imageRunsRoot, outputImage.relativePath) };
}

async function serveBrandAsset(filename, response, sendJson, options, method) {
  const brandAssetsDir = resolve(options.brandAssetsDir ?? BRAND_ASSETS_DIR);
  let handle;
  try {
    handle = await openPublishedLogoAsset(brandAssetsDir, filename, { beforeOpen: options.beforeBrandAssetOpen });
    response.writeHead(200, { "content-type": mimeType(filename) });
    if (method === "HEAD") { response.end(); return; }
    await pipeline(handle.createReadStream({ autoClose: false }), response);
  } catch (error) {
    if (!response.headersSent) {
      sendJson(response, 404, { ok: false, error: { code: "NOT_FOUND", message: "Not found" } });
    } else if (!response.writableEnded) {
      response.destroy();
    }
  } finally {
    await handle?.close().catch(() => {});
  }
}

function parseBrandAssetPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch (error) {
    return undefined;
  }
  return /^\/outputs\/brand-assets\/([a-f0-9]{64}\.(?:png|jpg|webp))$/u.exec(decoded)?.[1];
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
