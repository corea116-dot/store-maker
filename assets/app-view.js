import { $, $$, escapeHtml } from "./app-utils.js";

export function renderPreview(html, title) {
  $("#result-preview").innerHTML = html;
  $("#result-preview").setAttribute("aria-label", title);
}

export function renderServerLogs(logs) {
  for (const log of logs) appendLog(log);
}

export function appendLog(log) {
  const item = document.createElement("li");
  item.className = `log-${log.level ?? "info"}`;
  const time = log.at ? new Date(log.at) : new Date();
  item.innerHTML = `<time>${time.toLocaleTimeString("ko-KR")}</time><strong>${escapeHtml(log.title ?? "log")}</strong><span>${escapeHtml(log.message ?? "")}</span>`;
  $("#log-list").prepend(item);
  $("#log-count").textContent = `${$("#log-list").children.length} logs`;
}

export function setStatus(kind, title, body) {
  $("#status-title").textContent = title;
  $("#status-body").textContent = body;
  $("#status-badge").textContent = kind === "passed" ? "통과" : kind === "failed" ? "실패" : "확인 중";
  $("#status-badge").className = kind === "passed" ? "pill good" : kind === "failed" ? "pill error" : "pill warn";
}

export function setPreviewState(title, body, kind) {
  $("#result-preview").innerHTML = `<p><strong>${escapeHtml(title)}</strong></p><p>${escapeHtml(body)}</p>`;
  $("#preview-badge").textContent = title;
  $("#preview-badge").className = kind === "error" ? "pill error" : "pill warn";
}

export function enableExports(enabled) {
  $$("[data-export]").forEach((button) => {
    button.disabled = !enabled;
  });
}

export function writeExport(exports, format) {
  const content = format === "json" ? JSON.stringify(exports.json, null, 2) : exports[format];
  $("#export-output").value = content;
  const blob = new Blob([content], { type: format === "html" ? "text/html" : "text/plain" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `store-maker-export.${format === "markdown" ? "md" : format}`;
  link.click();
  URL.revokeObjectURL(link.href);
  appendLog({ level: "success", title: `${format} export`, message: "내보내기 페이로드를 생성했습니다." });
}
