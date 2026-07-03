import { $, $$, showToast } from "./app-utils.js";
import { renderLogs } from "./app-view.js";
import { logPageSizeOptions, saveSettings, state } from "./settings-state.js";

export function bindLogDialogControls() {
  $$("[data-action='open-log-dialog']").forEach((button) => button.addEventListener("click", openLogDialog));
  $$("[data-action='close-log-dialog']").forEach((button) => button.addEventListener("click", closeLogDialog));
  $$("[data-log-page-size]").forEach((select) => {
    select.addEventListener("change", () => updateLogPageSize(select.value));
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeLogDialog();
  });
  renderLogs();
}

function openLogDialog() {
  $("#log-dialog-overlay")?.classList.remove("is-hidden");
  $("#log-dialog")?.classList.remove("is-hidden");
  $("#log-dialog")?.focus();
}

function closeLogDialog() {
  $("#log-dialog-overlay")?.classList.add("is-hidden");
  $("#log-dialog")?.classList.add("is-hidden");
}

function updateLogPageSize(value) {
  const nextSize = readLogPageSize(value);
  state.logPageSize = nextSize;
  saveSettings();
  renderLogs();
  showToast(`실행 로그를 ${nextSize}개씩 표시합니다.`);
}

function readLogPageSize(value) {
  const numeric = Number.parseInt(value, 10);
  return logPageSizeOptions.includes(numeric) ? numeric : state.logPageSize;
}
