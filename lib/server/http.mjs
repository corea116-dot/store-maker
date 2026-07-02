import { randomBytes } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { discoverEngines, preflightEngine, runEngine } from "./engines.mjs";
import { runImageGeneration } from "./imagegen.mjs";
import { createGenerationJobManager } from "./jobs.mjs";
import { logEntry } from "./logs.mjs";
import { buildExports, buildResult, composePrompt, fallbackResult, parseGenerationRequest } from "./prompt.mjs";
import { MAX_JSON_BODY_BYTES } from "./config.mjs";
import { serveStatic } from "./static.mjs";

export function createServer() {
  const localToken = randomBytes(32).toString("base64url");
  const generationJobs = createGenerationJobManager({ run: generateDetailPage });
  return createHttpServer(async (request, response) => {
    try {
      await routeRequest(request, response, localToken, generationJobs);
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

async function routeRequest(request, response, localToken, generationJobs) {
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
  if (request.method === "POST" && url.pathname === "/api/generate-jobs") {
    if (!allowApiWrite(request, response, localToken)) return;
    const job = await generationJobs.start(await readJsonBody(request));
    sendJson(response, 202, { ok: true, job });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/generate-jobs") {
    if (!allowApiRead(request, response, localToken)) return;
    sendJson(response, 200, { ok: true, jobs: await generationJobs.list() });
    return;
  }
  const jobPath = parseJobPath(url.pathname);
  if (request.method === "GET" && jobPath && !jobPath.cancel) {
    if (!allowApiRead(request, response, localToken)) return;
    const job = await generationJobs.get(jobPath.id);
    sendJson(response, job ? 200 : 404, job ? { ok: true, job } : { ok: false, error: { code: "NOT_FOUND", message: "Generation job not found" } });
    return;
  }
  if (request.method === "POST" && jobPath?.cancel) {
    if (!allowApiWrite(request, response, localToken)) return;
    const job = await generationJobs.cancel(jobPath.id);
    sendJson(response, job ? 200 : 404, job ? { ok: true, job } : { ok: false, error: { code: "NOT_FOUND", message: "Generation job not found" } });
    return;
  }
  if (request.method === "POST" && (url.pathname === "/api/generate" || url.pathname === "/api/engines/invoke")) {
    if (!allowApiWrite(request, response, localToken)) return;
    const result = await generateDetailPage(await readJsonBody(request));
    sendJson(response, result.ok ? 200 : 422, result);
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/generate-stream") {
    if (!allowApiWrite(request, response, localToken)) return;
    await streamGenerateDetailPage(await readJsonBody(request), response);
    return;
  }
  if (request.method === "GET") {
    await serveStatic(url.pathname, response, sendJson, localToken);
    return;
  }
  sendJson(response, 405, { ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
}

async function generateDetailPage(body, options = {}) {
  const parsed = parseGenerationRequest(body);
  if (!parsed.ok) return parsed;
  const prompt = composePrompt(parsed.value);
  const isAdSet = parsed.value.generationMode === "ad-set";
  const logs = [logEntry("info", "prompt composed", isAdSet
    ? "상품 정보, 브랜드 참조, 추천 앵글을 광고 세트 프롬프트로 구성했습니다."
    : "상품 정보, 요구사항, 이미지/자료, 목표 마켓을 하나의 프롬프트로 구성했습니다.")];
  if (isAdSet) {
    const brandUrl = parsed.value.brand.source.brandUrl ?? "브랜드 URL 없음";
    logs.push(logEntry("info", "brand url sanitized", `${parsed.value.brand.source.urlSafety.status}: ${brandUrl}`));
    logs.push(logEntry("info", "angles selected", parsed.value.adAutomation.angleSelection.recommendedAngleIds.join(", ")));
  }
  if (options.signal?.aborted) return cancelledGenerationResult(parsed.value, prompt, logs);
  const execution = await runEngine(parsed.value, prompt, { signal: options.signal });
  logs.push(...execution.logs);
  if (options.signal?.aborted || execution.aborted) return cancelledGenerationResult(parsed.value, prompt, logs, execution.output);
  if (!execution.ok) {
    return {
      ok: false,
      prompt,
      logs,
      error: { code: "ENGINE_FAILED", message: execution.error },
      result: fallbackResult(parsed.value, execution.output),
    };
  }
  const imageGeneration = await runImageGeneration(parsed.value, { signal: options.signal });
  logs.push(...imageGeneration.logs);
  if (options.signal?.aborted || imageGeneration.aborted) return cancelledGenerationResult(parsed.value, prompt, logs, execution.output);
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
  if (isAdSet) {
    const adCount = result.adSet?.items?.length ?? result.adSet?.ads?.length ?? 0;
    logs.push(logEntry("success", "ad gallery ready", `광고 결과 갤러리 카드 ${adCount}개를 준비했습니다.`));
    logs.push(logEntry("success", "ad automation ready", "Brand DNA, 추천 앵글, 기본 광고안 5개를 생성했습니다."));
  }
  logs.push(logEntry("success", "preview ready", isAdSet
    ? "광고 세트 미리보기와 내보내기 페이로드를 생성했습니다."
    : "상세페이지 미리보기와 내보내기 페이로드를 생성했습니다."));
  return { ok: true, prompt, logs, result, exports: buildExports(parsed.value, result, prompt, logs) };
}

async function streamGenerateDetailPage(body, response) {
  const startedAt = Date.now();
  let sequence = 0;
  let heartbeat;
  let finished = false;
  const controller = new AbortController();
  const writeEvent = (event) => {
    if (response.destroyed) return;
    response.write(`${JSON.stringify({ at: new Date().toISOString(), sequence: ++sequence, ...event })}\n`);
  };

  response.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store",
    "x-accel-buffering": "no",
  });
  writeEvent({
    type: "status",
    level: "info",
    title: "generation accepted",
    message: "생성 요청을 접수했습니다. 긴 이미지 생성 중에도 연결 유지를 위해 진행 신호를 보냅니다.",
    elapsedMs: 0,
  });
  heartbeat = setInterval(() => {
    writeEvent({
      type: "heartbeat",
      level: "info",
      title: "generation still running",
      message: "엔진 또는 이미지 생성이 계속 실행 중입니다.",
      elapsedMs: Date.now() - startedAt,
    });
  }, 10_000);
  const closeHandler = () => {
    clearInterval(heartbeat);
    if (!finished) controller.abort();
  };
  response.on("close", closeHandler);

  try {
    const result = await generateDetailPage(body, { signal: controller.signal });
    writeEvent({ type: "result", elapsedMs: Date.now() - startedAt, result });
  } catch (error) {
    const parsed = parseGenerationRequest(body);
    writeEvent({
      type: "result",
      elapsedMs: Date.now() - startedAt,
      result: {
        ok: false,
        logs: [logEntry("error", "generation failed", error instanceof Error ? error.message : "Unexpected server error")],
        error: { code: "INTERNAL_ERROR", message: error instanceof Error ? error.message : "Unexpected server error" },
        ...(parsed.ok ? { result: fallbackResult(parsed.value, "") } : {}),
      },
    });
  } finally {
    finished = true;
    clearInterval(heartbeat);
    response.off("close", closeHandler);
    if (!response.destroyed) response.end();
  }
}

function cancelledGenerationResult(input, prompt, logs, output = "") {
  const message = "생성 작업이 취소되었습니다.";
  return {
    ok: false,
    prompt,
    logs: [...logs, logEntry("warning", "generation cancelled", message)],
    error: { code: "CANCELLED", message },
    result: fallbackResult(input, output),
  };
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

function allowApiRead(request, response, localToken) {
  const trustError = requestTrustError(request, localToken);
  if (trustError) {
    sendJson(response, 403, { ok: false, error: { code: "FORBIDDEN", message: trustError } });
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

function parseJobPath(pathname) {
  const match = pathname.match(/^\/api\/generate-jobs\/([^/]+)(\/cancel)?$/u);
  if (!match) return undefined;
  try {
    return { id: decodeURIComponent(match[1]), cancel: Boolean(match[2]) };
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
