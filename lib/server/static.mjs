import { constants, createReadStream } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { IMAGE_RUNS_DIR, ROOT } from "./config.mjs";

const TOKEN_PLACEHOLDER = "__STORE_MAKER_TOKEN__";

export async function serveStatic(pathname, response, sendJson, localToken) {
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
  const filePath = resolve(ROOT, `.${decodedPath}`);
  if (!isAllowedResolvedPath(filePath)) {
    sendJson(response, 404, { ok: false, error: { code: "NOT_FOUND", message: "Not found" } });
    return;
  }
  try {
    await access(filePath, constants.R_OK);
  } catch (error) {
    sendJson(response, 404, { ok: false, error: { code: "NOT_FOUND", message: "Not found" } });
    return;
  }
  if (filePath === resolve(ROOT, "index.html")) {
    const html = await readFile(filePath, "utf8");
    response.writeHead(200, { "content-type": mimeType(filePath) });
    response.end(html.replace(TOKEN_PLACEHOLDER, localToken));
    return;
  }
  response.writeHead(200, { "content-type": mimeType(filePath) });
  createReadStream(filePath).pipe(response);
}

function publicFilePath(pathname) {
  if (pathname === "/") return "/index.html";
  if (pathname === "/index.html") return "/index.html";
  if (pathname.startsWith("/assets/") && !pathname.includes("..")) return pathname;
  if (pathname.startsWith("/outputs/image-runs/") && !pathname.includes("..")) return pathname;
  return undefined;
}

function decodePath(pathname) {
  try {
    return decodeURIComponent(pathname);
  } catch (error) {
    return undefined;
  }
}

function isAllowedResolvedPath(filePath) {
  const indexPath = resolve(ROOT, "index.html");
  const assetsRoot = resolve(ROOT, "assets");
  const imageRunsRoot = resolve(IMAGE_RUNS_DIR);
  return filePath === indexPath || filePath.startsWith(`${assetsRoot}${sep}`) || (filePath.startsWith(`${imageRunsRoot}${sep}`) && isImageFile(filePath));
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
