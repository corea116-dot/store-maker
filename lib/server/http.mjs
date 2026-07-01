import { randomBytes } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { discoverEngines, preflightEngine, runEngine } from "./engines.mjs";
import { runImageGeneration } from "./imagegen.mjs";
import { logEntry } from "./logs.mjs";
import { buildExports, buildResult, composePrompt, fallbackResult, parseGenerationRequest } from "./prompt.mjs";
import { MAX_JSON_BODY_BYTES } from "./config.mjs";
import { serveStatic } from "./static.mjs";

export function createServer() {
  const localToken = randomBytes(32).toString("base64url");
  return createHttpServer(async (request, response) => {
    try {
      await routeRequest(request, response, localToken);
    } catch (error) {
      if (error instanceof HttpInputError) {
        sendJson(response, error.status, { ok: false, error: { code: error.code, message: error.message } });
        return;
      }
      sendJson(response, 500, {
        ok: false,
        error: { code: "INTERNAL_ERROR", message: error instanceof Error ? error.message : "Unexpected server error" },
      });
    }
  });
}

async function routeRequest(request, response, localToken) {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (!isLoopbackHost(request.headers.host)) {
    sendJson(response, 403, { ok: false, error: { code: "FORBIDDEN", message: "Host must be localhost or loopback" } });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, { ok: true, app: "store-maker", checkedAt: new Date().toISOString() });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/engines") {
    sendJson(response, 200, { ok: true, engines: await discoverEngines(), scannedAt: new Date().toISOString() });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/preflight") {
    if (!allowApiWrite(request, response, localToken)) return;
    sendJson(response, 200, await preflightEngine(await readJsonBody(request)));
    return;
  }
  if (request.method === "POST" && (url.pathname === "/api/generate" || url.pathname === "/api/engines/invoke")) {
    if (!allowApiWrite(request, response, localToken)) return;
    const result = await generateDetailPage(await readJsonBody(request));
    sendJson(response, result.ok ? 200 : 422, result);
    return;
  }
  if (request.method === "GET") {
    await serveStatic(url.pathname, response, sendJson, localToken);
    return;
  }
  sendJson(response, 405, { ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
}

async function generateDetailPage(body) {
  const parsed = parseGenerationRequest(body);
  if (!parsed.ok) return parsed;
  const prompt = composePrompt(parsed.value);
  const logs = [logEntry("info", "prompt composed", "상품 정보, 요구사항, 이미지/자료, 목표 마켓을 하나의 프롬프트로 구성했습니다.")];
  const execution = await runEngine(parsed.value, prompt);
  logs.push(...execution.logs);
  if (!execution.ok) {
    return {
      ok: false,
      prompt,
      logs,
      error: { code: "ENGINE_FAILED", message: execution.error },
      result: fallbackResult(parsed.value, execution.output),
    };
  }
  const imageGeneration = await runImageGeneration(parsed.value);
  logs.push(...imageGeneration.logs);
  if (!imageGeneration.ok) {
    return {
      ok: false,
      prompt,
      logs,
      error: { code: "IMAGEGEN_FAILED", message: imageGeneration.error },
      result: fallbackResult(parsed.value, execution.output),
    };
  }
  const result = buildResult(parsed.value, execution.output, prompt, imageGeneration.images);
  logs.push(logEntry("success", "preview ready", "상세페이지 미리보기와 내보내기 페이로드를 생성했습니다."));
  return { ok: true, prompt, logs, result, exports: buildExports(parsed.value, result, prompt, logs) };
}

function readJsonBody(request) {
  return new Promise((resolveRead, rejectRead) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += String(chunk);
      if (raw.length > MAX_JSON_BODY_BYTES) request.destroy(new HttpInputError(413, "PAYLOAD_TOO_LARGE", "Request body is too large"));
    });
    request.on("end", () => {
      if (!raw) {
        resolveRead({});
        return;
      }
      try {
        resolveRead(JSON.parse(raw));
      } catch (error) {
        rejectRead(new HttpInputError(400, "INVALID_JSON", "Request body must be valid JSON"));
      }
    });
    request.on("error", rejectRead);
  });
}

function sendJson(response, status, payload) {
  if (response.headersSent) return;
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload, null, 2));
}

function allowApiWrite(request, response, localToken) {
  const trustError = requestTrustError(request, localToken);
  if (trustError) {
    sendJson(response, 403, { ok: false, error: { code: "FORBIDDEN", message: trustError } });
    return false;
  }
  if (!isJsonRequest(request)) {
    sendJson(response, 415, { ok: false, error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "Content-Type must be application/json" } });
    return false;
  }
  return true;
}

function requestTrustError(request, localToken) {
  const host = request.headers.host;
  const origin = request.headers.origin;
  if (!isLoopbackHost(host)) return "Host must be localhost or loopback";
  if (typeof origin === "string" && !isAllowedOrigin(origin, host)) return "Cross-origin API requests are not allowed";

  const fetchSite = request.headers["sec-fetch-site"];
  if (typeof fetchSite === "string" && fetchSite !== "same-origin" && fetchSite !== "none") {
    return "Cross-site API requests are not allowed";
  }

  if (request.headers["x-store-maker-token"] !== localToken) return "Local app session is missing or invalid. Reload Store Maker.";
  return undefined;
}

function isJsonRequest(request) {
  return (request.headers["content-type"] ?? "").toLowerCase().split(";")[0].trim() === "application/json";
}

function isAllowedOrigin(origin, host) {
  return origin === `http://${host}` && isLoopbackHost(host);
}

function isLoopbackHost(hostHeader) {
  const hostname = parseHostname(hostHeader);
  if (!hostname) return false;
  if (hostname === "localhost" || hostname === "[::1]") return true;
  if (!/^127(?:\.\d{1,3}){3}$/u.test(hostname)) return false;
  return hostname.split(".").every((part) => Number(part) <= 255);
}

function parseHostname(hostHeader) {
  if (typeof hostHeader !== "string" || !hostHeader.trim()) return undefined;
  try {
    return new URL(`http://${hostHeader.trim().toLowerCase()}`).hostname;
  } catch (error) {
    return undefined;
  }
}

class HttpInputError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
