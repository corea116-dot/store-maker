import { $, $$, escapeHtml } from "./app-utils.js";
import { state } from "./settings-state.js";

export function renderPreview(html, title) {
  $("#result-preview").innerHTML = html;
  $("#result-preview").setAttribute("aria-label", title);
}

export function renderServerLogs(logs) {
  for (const log of logs) appendLog(log);
}

export function appendLog(log) {
  state.logs.unshift(log);
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
  const toggleButton = $("[data-action='toggle-export-panel']");
  if (toggleButton) toggleButton.disabled = !enabled;
  if (!enabled) setExportPanelExpanded(false);
}

export function writeExport(exports, format) {
  setExportPanelExpanded(true);
  const content = format === "json" ? JSON.stringify(exports.json, null, 2) : exports[format];
  const output = $("#export-output");
  output.value = content ?? "";
  output.focus();
  const label = format === "markdown" ? "Markdown" : format.toUpperCase();
  appendLog({
    level: "success",
    title: `${format} export ready`,
    message: `${label} 페이로드를 아래 텍스트 영역에 표시했습니다. 파일은 자동 저장하지 않습니다.`,
  });
}

export function setExportPanelExpanded(expanded) {
  const panel = $("#export-panel");
  const button = $("[data-action='toggle-export-panel']");
  if (!panel || !button) return;
  panel.classList.toggle("is-hidden", !expanded);
  button.setAttribute("aria-expanded", expanded ? "true" : "false");
  button.textContent = expanded ? "고급 내보내기 닫기" : "고급 내보내기 열기";
}
