import { GENERATE_TIMEOUT_MS, PREFLIGHT_TIMEOUT_MS } from "./config.mjs";
import { logEntry } from "./logs.mjs";

export async function preflightByok(input, readString, preflightResult) {
  const provider = readString(input.byokProvider);
  if (!provider) return preflightResult(false, input, "failed", "BYOK provider URL is required");
  const apiKey = readString(input.apiKey);
  if (!apiKey) return { ...preflightResult(false, input, "failed", "BYOK API token is required for BYOK HTTP provider"), byokProvider: provider };
  let url;
  try {
    url = new URL(provider);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new TypeError("Unsupported protocol");
  } catch (error) {
    return preflightResult(false, input, "failed", error instanceof Error ? error.message : "Invalid BYOK provider URL");
  }
  try {
    const response = await fetchWithTimeout(url.toString(), {
      method: "HEAD",
      headers: { authorization: `Bearer ${apiKey}` },
    }, PREFLIGHT_TIMEOUT_MS);
    const authFailed = apiKey && (response.status === 401 || response.status === 403);
    const reachable = response.ok || response.status === 401 || response.status === 403 || response.status === 405;
    if (!reachable || authFailed) {
      return { ...preflightResult(false, input, "failed", `BYOK provider returned HTTP ${response.status}`), byokProvider: url.toString() };
    }
    return { ...preflightResult(true, input, "available", "BYOK provider endpoint is reachable"), byokProvider: url.toString() };
  } catch (error) {
    return { ...preflightResult(false, input, "failed", byokErrorMessage(error)), byokProvider: url.toString() };
  }
}

export async function runByokProvider(input, prompt) {
  const providerUrl = input.engine.byokProvider;
  if (!providerUrl) {
    return { ok: false, output: "", error: "BYOK provider URL is required", logs: [logEntry("error", "BYOK URL missing", "BYOK HTTP provider URL을 입력하세요.")] };
  }
  if (!input.engine.apiKey) {
    const message = "BYOK API token is required for BYOK HTTP provider";
    return { ok: false, output: "", error: message, logs: [logEntry("error", "BYOK token missing", "BYOK HTTP provider token을 입력하세요.")] };
  }
  try {
    const response = await fetchWithTimeout(providerUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(input.engine.apiKey ? { authorization: `Bearer ${input.engine.apiKey}` } : {}),
      },
      body: JSON.stringify({ prompt, product: input.product, markets: input.markets, model: input.engine.model }),
    }, input.engine.timeoutMs ?? GENERATE_TIMEOUT_MS);
    const text = await response.text();
    if (!response.ok) {
      return { ok: false, output: text, error: text || response.statusText, logs: [logEntry("error", "BYOK request failed", `${response.status} ${response.statusText}`)] };
    }
    return { ok: true, output: text, logs: [logEntry("success", "prompt delivered", "prompt delivered via BYOK HTTP body.")] };
  } catch (error) {
    const message = byokErrorMessage(error);
    return { ok: false, output: "", error: message, logs: [logEntry("error", "BYOK request failed", message)] };
  }
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function byokErrorMessage(error) {
  if (error instanceof DOMException && error.name === "AbortError") return "BYOK provider request timed out";
  if (error instanceof Error) return error.message;
  return "BYOK provider request failed";
}
