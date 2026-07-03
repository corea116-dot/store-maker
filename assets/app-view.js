import { $, $$, escapeHtml } from "./app-utils.js";
import { logPageSizeOptions, state } from "./settings-state.js";

export function renderPreview(html, title) {
  $("#result-preview").innerHTML = html;
  $("#result-preview").setAttribute("aria-label", title);
}

export function renderServerLogs(logs) {
  for (const log of logs) appendLog(log);
}

export function appendLog(log) {
  state.logs.unshift(log);
  renderLogs();
}

export function renderLogs() {
  renderLogPageSizeControls();
  const totalCount = state.logs.length;
  const visibleLogs = state.logs.slice(0, state.logPageSize);
  renderInlineLogSummary($("#log-list"), totalCount);
  renderLogList($("#log-dialog-list"), visibleLogs);
  updateLogCounts(visibleLogs.length, totalCount);
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

function renderLogList(list, logs) {
  if (!list) return;
  if (!logs.length) {
    list.innerHTML = "<li class=\"log-empty\">아직 기록된 로그가 없습니다.</li>";
    return;
  }
  list.innerHTML = logs.map((log) => logHtml(log)).join("");
}

function renderInlineLogSummary(list, totalCount) {
  if (!list) return;
  const message =
    totalCount > 0
      ? `기록된 ${totalCount}개 로그는 실행 로그 버튼을 눌러 팝업에서 확인하세요.`
      : "아직 기록된 로그가 없습니다.";
  list.innerHTML = `<li class="log-inline-summary">${escapeHtml(message)}</li>`;
}

function logHtml(log) {
  const time = log.at ? new Date(log.at) : new Date();
  return `
    <li class="log-entry ${logLevelClass(log.level)}">
      <time>${time.toLocaleTimeString("ko-KR")}</time>
      <strong>${escapeHtml(log.title ?? "log")}</strong>
      <span>${escapeHtml(log.message ?? "")}</span>
    </li>
  `;
}

function logLevelClass(level) {
  return ["info", "success", "warning", "error"].includes(level) ? `log-${level}` : "log-info";
}

function updateLogCounts(visibleCount, totalCount) {
  $("#log-count").textContent = `${totalCount} logs`;
  const dialogCount = $("#log-dialog-count");
  if (dialogCount) dialogCount.textContent = `${totalCount} logs`;
  for (const summary of $$(".log-page-summary")) {
    summary.textContent = totalCount > 0 ? `최근 ${visibleCount}/${totalCount} logs` : "0 logs";
  }
}

function renderLogPageSizeControls() {
  for (const select of $$("[data-log-page-size]")) {
    if (!select.children.length) {
      select.innerHTML = logPageSizeOptions.map((size) => `<option value="${size}">${size}개</option>`).join("");
    }
    select.value = String(state.logPageSize);
  }
}
