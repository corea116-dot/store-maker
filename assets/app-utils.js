export const $ = (selector) => document.querySelector(selector);
export const $$ = (selector) => [...document.querySelectorAll(selector)];

export async function getJson(url) {
  const response = await fetch(url, { headers: localHeaders() });
  return parseJsonResponse(response);
}

export async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...localHeaders() },
    body: JSON.stringify(body),
  });
  return parseJsonResponse(response);
}

export function lines(value) {
  return value.split(/\n|,/u).map((item) => item.trim()).filter(Boolean);
}

export function readableError(error) {
  return error instanceof Error ? error.message : "요청 처리 중 오류가 발생했습니다.";
}

export function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 1800);
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function parseJsonResponse(response) {
  const payload = await response.json();
  if (!response.ok) throw new Error(publicErrorMessage(payload.error?.message ?? `HTTP ${response.status}`));
  return payload;
}

function localHeaders() {
  const token = document.querySelector("meta[name='store-maker-token']")?.content;
  return token ? { "x-store-maker-token": token } : {};
}

function publicErrorMessage(message) {
  if (/local app session/i.test(message) || /local API token/i.test(message)) {
    return "Store Maker 로컬 세션이 만료되었습니다. 페이지를 새로고침한 뒤 다시 실행하세요.";
  }
  return message;
}
