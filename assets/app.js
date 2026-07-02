import { $, $$, escapeHtml, getJson, postJson, readableError, showToast } from "./app-utils.js";
import { appendLog, enableExports, renderPreview, renderServerLogs, setPreviewState, setStatus, writeExport } from "./app-view.js";
import { bindAttachmentControls, getAttachments } from "./attachments.js";
import { adMoodPresets, defaultImageCount, generationModes, imageProviderLabels, imageProviders, imageStyleOptions, loadSettings, maxImageCount, minImageCount, normalizeMode, providerDefaults, providerLabels, providers, routeTasks, saveSettings, state } from "./settings-state.js";

const jobPollIntervalMs = 1500;
const terminalJobStatuses = new Set(["completed", "failed", "cancelled"]);
let activeJobId;
let jobPollTimer;
let renderedJobResultId;

document.addEventListener("DOMContentLoaded", () => {
  loadSettings();
  populateRoutingSelects();
  configureImageOptions();
  bindAttachmentControls();
  bindControls();
  renderSettings();
  void scanEngines();
  void checkHealth();
  void loadGenerationJobs({ attachLatest: true });
});

function bindControls() {
  $("[data-action='open-settings']")?.addEventListener("click", openSettings);
  $$("[data-action='close-settings']").forEach((button) => button.addEventListener("click", closeSettings));
  $$("input[name='generation-mode']").forEach((input) => input.addEventListener("change", () => setGenerationMode(input.value)));
  $$(".mode-row button").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode ?? "local-cli")));
  $$(".provider-row button").forEach((button) => button.addEventListener("click", () => setProvider(button.dataset.provider ?? "custom")));
  $$("[data-image-provider]").forEach((button) => button.addEventListener("click", () => setImageProvider(button.dataset.imageProvider ?? "none")));
  $$("[data-settings-tab]").forEach((button) => button.addEventListener("click", () => setSettingsTab(button.dataset.settingsTab ?? "engine")));
  $$("[data-route-task]").forEach((select) => select.addEventListener("change", () => updateRouting(select)));
  ["#command", "#model", "#reasoning", "#extra-args", "#prompt-transport", "#timeout-ms", "#api-key"].forEach((selector) => {
    $(selector)?.addEventListener("input", () => saveVisibleEngineFields());
    $(selector)?.addEventListener("change", () => saveVisibleEngineFields());
  });
  ["#image-command", "#image-model", "#image-extra-args", "#image-timeout-ms"].forEach((selector) => {
    $(selector)?.addEventListener("input", () => saveImageGenerationFields());
    $(selector)?.addEventListener("change", () => saveImageGenerationFields());
  });
  ["#image-count", "#image-ratio", "#image-style", "#image-background", "#image-custom-background", "#image-use-reference"].forEach((selector) => {
    $(selector)?.addEventListener("input", () => saveImageOptionsFromUi());
    $(selector)?.addEventListener("change", () => saveImageOptionsFromUi());
  });
  $("#ad-mood-preset")?.addEventListener("change", saveAdOptionsFromUi);
  $$("[data-action='preflight']").forEach((button) => button.addEventListener("click", () => void runPreflight()));
  $$("[data-action='generate']").forEach((button) => button.addEventListener("click", () => void runGeneration()));
  $("[data-action='cancel-generation']")?.addEventListener("click", () => void cancelActiveGenerationJob());
  $("[data-action='refresh-jobs']")?.addEventListener("click", () => void loadGenerationJobs({ attachLatest: false }));
  $$("[data-action='save-settings']").forEach((button) => button.addEventListener("click", saveSettingsFromUi));
  $$("[data-export]").forEach((button) => button.addEventListener("click", () => exportResult(button.dataset.export)));
  $("#job-history-list")?.addEventListener("click", (event) => {
    const item = event.target.closest("[data-job-id]");
    if (!item) return;
    void openGenerationJob(item.dataset.jobId);
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest("[data-action='regenerate-images']")) return;
    void runGeneration();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSettings();
  });
}

function setGenerationMode(mode) {
  const nextMode = generationModes.includes(mode) ? mode : "detail-page";
  if (state.generationMode === nextMode) return;
  state.generationMode = nextMode;
  renderGenerationMode();
  clearRunState(nextMode === "ad-set"
    ? "광고 세트 모드로 전환했습니다. 상품 입력은 유지되며 새 결과를 생성하세요."
    : "상세페이지 모드로 전환했습니다. 상품 입력은 유지되며 새 결과를 생성하세요.");
  saveSettings();
}

async function checkHealth() {
  try {
    const result = await getJson("/api/health");
    $("#health-pill").textContent = result.ok ? "로컬 앱 실행 중" : "확인 필요";
    $("#health-pill").className = result.ok ? "pill good" : "pill warn";
  } catch (error) {
    $("#health-pill").textContent = "서버 확인 실패";
    $("#health-pill").className = "pill error";
  }
}

async function scanEngines() {
  try {
    const result = await getJson("/api/engines");
    $("#engine-scan-pill").textContent = "PATH 스캔됨";
    $("#engine-scan-pill").className = "pill good";
    for (const engine of result.engines ?? []) {
      const button = $(`[data-provider='${engine.id}']`);
      if (!button) continue;
      const status = button.querySelector("em");
      if (status) status.textContent = engine.status === "missing" ? "없음" : engine.status;
      button.classList.toggle("missing", engine.status === "missing");
      button.title = engine.detail ?? "";
    }
  } catch (error) {
    $("#engine-scan-pill").textContent = "PATH 스캔 실패";
    $("#engine-scan-pill").className = "pill warn";
  }
}

function setMode(mode) {
  saveVisibleEngineFields();
  const nextMode = normalizeMode(mode);
  if (nextMode === "byok-http") {
    setProvider("byok");
    return;
  }
  state.mode = "local-cli";
  if (state.provider === "byok") state.provider = "custom";
  renderSettings();
  clearRunState("실행 모드가 바뀌었습니다. Preflight를 다시 실행하세요.");
  saveSettings();
}

function setProvider(provider) {
  saveVisibleEngineFields();
  state.provider = providers.includes(provider) ? provider : "custom";
  state.mode = state.provider === "byok" ? "byok-http" : "local-cli";
  state.routing.copy = state.provider;
  renderSettings();
  clearRunState("엔진이 바뀌었습니다. Preflight를 다시 실행하세요.");
  saveSettings();
}

function setImageProvider(provider) {
  saveImageGenerationFields();
  state.imageGeneration.provider = imageProviders.includes(provider) ? provider : "none";
  renderImageGenerationFields();
  clearRunState("이미지 생성 엔진이 바뀌었습니다. 생성 실행으로 다시 확인하세요.");
  saveSettings();
}

async function runPreflight() {
  saveVisibleEngineFields();
  const request = engineRequest(state.provider);
  setStatus("checking", "Preflight 실행 중", "엔진 실행 가능 여부를 확인합니다.");
  appendLog({ level: "info", title: "preflight requested", message: preflightMessage(request) });
  try {
    const result = await postJson("/api/preflight", request);
    state.lastPreflight = result.ok ? result : undefined;
    setStatus(result.ok ? "passed" : "failed", result.ok ? "Preflight 통과" : "Preflight 실패", result.detail ?? result.message);
    appendLog({ level: result.ok ? "success" : "error", title: "preflight result", message: result.message });
    showToast(result.ok ? "Preflight를 통과했습니다." : "Preflight 실패 원인을 로그에서 확인하세요.");
  } catch (error) {
    setStatus("failed", "Preflight 실패", readableError(error));
    appendLog({ level: "error", title: "preflight failed", message: readableError(error) });
  }
}

async function runGeneration() {
  saveVisibleEngineFields();
  const payload = generationRequest();
  clearExportState();
  renderedJobResultId = undefined;
  if (!payload.product.name || !payload.product.description || !payload.product.requirements || payload.markets.length === 0) {
    appendLog({ level: "error", title: "validation failed", message: "상품명, 설명, 요구사항, 목표 마켓을 모두 입력하세요." });
    showToast("필수 입력을 확인하세요.");
    return;
  }
  setPreviewState("작업 등록 중", "생성 요청을 서버 작업 큐에 등록하고 있습니다.", "warn");
  appendLog({ level: "info", title: "generation job requested", message: `${payload.engine.engineId} 엔진으로 ${routingSummary()} 큐 실행` });
  try {
    const response = await postJson("/api/generate-jobs", payload);
    renderGenerationJob(response.job, { renderResult: false });
    startJobPolling(response.job.id);
    await loadGenerationJobs({ attachLatest: false });
    showToast("생성 작업을 시작했습니다.");
  } catch (error) {
    setPreviewState("생성 실패", readableError(error), "error");
    appendLog({ level: "error", title: "generation failed", message: readableError(error) });
  }
}

function formatElapsed(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}분 ${String(remainder).padStart(2, "0")}초` : `${remainder}초`;
}

async function loadGenerationJobs({ attachLatest } = { attachLatest: false }) {
  try {
    const response = await getJson("/api/generate-jobs");
    renderJobHistory(response.jobs ?? []);
    if (attachLatest && !activeJobId) {
      const active = (response.jobs ?? []).find((job) => !terminalJobStatuses.has(job.status));
      if (active) {
        renderGenerationJob(active, { renderResult: false });
        startJobPolling(active.id);
      }
    }
  } catch (error) {
    appendLog({ level: "warning", title: "job history unavailable", message: readableError(error) });
  }
}

async function openGenerationJob(jobId) {
  if (!jobId) return;
  try {
    const response = await getJson(`/api/generate-jobs/${encodeURIComponent(jobId)}`);
    renderGenerationJob(response.job, { renderResult: true });
    if (!terminalJobStatuses.has(response.job.status)) startJobPolling(response.job.id);
  } catch (error) {
    showToast(readableError(error));
  }
}

async function cancelActiveGenerationJob() {
  if (!activeJobId) return;
  try {
    const response = await postJson(`/api/generate-jobs/${encodeURIComponent(activeJobId)}/cancel`, {});
    renderGenerationJob(response.job, { renderResult: false });
    startJobPolling(response.job.id);
    showToast("생성 취소를 요청했습니다.");
  } catch (error) {
    appendLog({ level: "error", title: "job cancel failed", message: readableError(error) });
    showToast("취소 요청에 실패했습니다.");
  }
}

function startJobPolling(jobId) {
  activeJobId = jobId;
  clearInterval(jobPollTimer);
  jobPollTimer = window.setInterval(() => void pollActiveGenerationJob(), jobPollIntervalMs);
  void pollActiveGenerationJob();
}

async function pollActiveGenerationJob() {
  if (!activeJobId) return;
  try {
    const response = await getJson(`/api/generate-jobs/${encodeURIComponent(activeJobId)}`);
    renderGenerationJob(response.job, { renderResult: true });
    if (terminalJobStatuses.has(response.job.status)) {
      stopJobPolling();
      await loadGenerationJobs({ attachLatest: false });
    }
  } catch (error) {
    stopJobPolling();
    setPreviewState("작업 확인 실패", readableError(error), "error");
  }
}

function stopJobPolling() {
  clearInterval(jobPollTimer);
  jobPollTimer = undefined;
  activeJobId = undefined;
}

function renderGenerationJob(job, { renderResult }) {
  if (!job) return;
  activeJobId = terminalJobStatuses.has(job.status) ? activeJobId : job.id;
  updateJobControls(job);
  if (!terminalJobStatuses.has(job.status)) {
    renderedJobResultId = undefined;
    clearExportState();
    const elapsed = formatElapsed(job.elapsedMs ?? 0);
    const title = job.status === "queued" ? "작업 대기 중" : job.status === "cancelling" ? "취소 중" : "생성 중";
    const body = job.status === "queued"
      ? `큐에서 순서를 기다리고 있습니다. 탭을 닫거나 새로고침해도 작업 히스토리에서 다시 확인할 수 있습니다. 경과 ${elapsed}.`
      : job.status === "cancelling"
        ? `실행 중인 provider를 정리하고 있습니다. 경과 ${elapsed}.`
        : `엔진 또는 이미지 생성이 서버에서 계속 실행 중입니다. 탭을 닫거나 터널이 끊겨도 서버가 살아 있으면 히스토리에서 다시 불러올 수 있습니다. 경과 ${elapsed}.`;
    setPreviewState(title, body, "warn");
    return;
  }
  if (renderResult && job.result) renderGenerationJobResult(job);
}

function renderGenerationJobResult(job) {
  if (renderedJobResultId === job.id) return;
  renderedJobResultId = job.id;
  const result = job.result;
  renderServerLogs(result.logs ?? []);
  if (!result.ok) {
    clearExportState();
    const cancelled = job.status === "cancelled" || result.error?.code === "CANCELLED";
    setPreviewState(cancelled ? "생성 취소됨" : "생성 실패", result.error?.message ?? job.error?.message ?? "엔진 실행 실패", cancelled ? "warn" : "error");
    showToast(cancelled ? "생성이 취소되었습니다." : "생성에 실패했습니다.");
    return;
  }
  state.exports = result.exports;
  renderPreview(result.result.html, result.result.title);
  enableExports(true);
  $("#preview-badge").textContent = "생성 완료";
  $("#preview-badge").className = "pill good";
  showToast("생성 결과가 준비되었습니다.");
}

function updateJobControls(job) {
  const statusPill = $("#job-status-pill");
  if (statusPill) {
    statusPill.textContent = job ? jobStatusLabel(job.status) : "작업 없음";
    statusPill.className = `pill ${jobStatusClass(job?.status)}`;
  }
  const activeId = $("#job-active-id");
  if (activeId) activeId.textContent = job ? `작업 ID ${job.id.slice(0, 8)}` : "작업 ID 없음";
  const cancelButton = $("[data-action='cancel-generation']");
  if (cancelButton) cancelButton.disabled = !job || terminalJobStatuses.has(job.status) || job.status === "cancelling";
}

function renderJobHistory(jobs) {
  const list = $("#job-history-list");
  if (!list) return;
  if (!jobs.length) {
    list.innerHTML = "<li class=\"job-history-empty\">아직 저장된 생성 작업이 없습니다.</li>";
    return;
  }
  list.innerHTML = jobs.map((job) => `
    <li>
      <button class="job-history-item" type="button" data-job-id="${escapeHtml(job.id)}">
        <span>
          <strong>${escapeHtml(job.title ?? "생성 작업")}</strong>
          <small>${escapeHtml(new Date(job.createdAt).toLocaleString("ko-KR"))} · ${escapeHtml(formatElapsed(job.elapsedMs ?? 0))}</small>
        </span>
        <em class="pill ${jobStatusClass(job.status)}">${escapeHtml(jobStatusLabel(job.status))}</em>
      </button>
    </li>
  `).join("");
}

function jobStatusLabel(status) {
  if (status === "queued") return "대기 중";
  if (status === "running") return "생성 중";
  if (status === "cancelling") return "취소 중";
  if (status === "completed") return "완료";
  if (status === "failed") return "실패";
  if (status === "cancelled") return "취소됨";
  return "작업 없음";
}

function jobStatusClass(status) {
  if (status === "completed") return "good";
  if (status === "failed") return "error";
  if (status === "queued" || status === "running" || status === "cancelling" || status === "cancelled") return "warn";
  return "";
}

function engineRequest(provider) {
  const config = state.engines[provider] ?? state.engines.custom;
  const mode = normalizeMode(config.mode);
  const base = {
    mode,
    engineId: provider,
    model: config.model,
    reasoning: config.reasoning,
    extraArgs: config.extraArgs,
  };
  if (mode === "byok-http") {
    return { ...base, engineId: "byok", byokProvider: config.command, apiKey: $("#api-key")?.value.trim() || undefined, timeoutMs: readTimeout(config.timeoutMs) };
  }
  return { ...base, command: config.command, promptTransport: config.promptTransport, timeoutMs: readTimeout(config.timeoutMs) };
}

function generationRequest() {
  const engineProvider = state.routing.copy || state.provider;
  const generationMode = state.generationMode;
  if (generationMode === "ad-set") saveAdOptionsFromUi();
  const request = {
    generationMode,
    engine: engineRequest(engineProvider),
    routing: { ...state.routing },
    imageGeneration: imageGenerationRequest(),
    product: {
      name: $("#product-name").value.trim(),
      description: $("#product-description").value.trim(),
      requirements: $("#product-requirements").value.trim(),
      attachments: getAttachments(),
    },
    markets: $$("input[name='market']:checked").map((input) => input.value),
    policy: "원본 자료는 로컬 프로젝트 폴더 범위에서만 사용하고, 로그에는 provider와 실패 원인을 남깁니다.",
  };
  if (generationMode === "ad-set") {
    request.brand = { url: $("#brand-url")?.value.trim() || undefined };
    request.adAutomation = {
      moodPreset: state.adOptions.moodPreset,
      expandAngles: false,
      language: "ko-KR",
    };
  }
  return request;
}

function exportResult(format) {
  if (!state.exports || !format) return;
  writeExport(state.exports, format);
}

function populateRoutingSelects() {
  for (const select of $$("[data-route-task]")) {
    select.innerHTML = providers.map((provider) => `<option value="${provider}">${providerLabels[provider]}</option>`).join("");
  }
}

function configureImageOptions() {
  const countInput = $("#image-count");
  if (countInput) {
    countInput.min = String(minImageCount);
    countInput.max = String(maxImageCount);
    countInput.value ||= String(defaultImageCount);
  }
  const styleSelect = $("#image-style");
  if (styleSelect) {
    styleSelect.innerHTML = imageStyleOptions.map((style) => `<option>${style}</option>`).join("");
  }
}

function renderSettings() {
  $$(".mode-row button").forEach((button) => button.classList.toggle("active", normalizeMode(button.dataset.mode) === state.mode));
  $$(".provider-row button").forEach((button) => button.classList.toggle("active", button.dataset.provider === state.provider));
  $$("[data-settings-tab]").forEach((button) => {
    const active = button.dataset.settingsTab === state.settingsTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  $$("[data-settings-pane]").forEach((pane) => pane.classList.toggle("is-hidden", pane.dataset.settingsPane !== state.settingsTab));
  for (const task of routeTasks) {
    const select = $(`[data-route-task='${task}']`);
    if (select) select.value = state.routing[task] ?? "custom";
  }
  writeEngineFields();
  renderImageGenerationFields();
  renderImageOptions();
  renderGenerationMode();
}

function writeEngineFields() {
  const defaults = state.engines[state.provider] ?? state.engines.custom;
  $("#command").value = defaults.command ?? "";
  $("#model").value = defaults.model ?? "";
  $("#reasoning").value = defaults.reasoning ?? "CLI 기본값";
  $("#extra-args").value = defaults.extraArgs ?? "";
  $("#prompt-transport").value = defaults.promptTransport ?? "stdin";
  $("#timeout-ms").value = defaults.timeoutMs ?? "";
  if (state.provider !== "byok") $("#api-key").value = "";
  $("#api-key-field").classList.toggle("is-hidden", state.mode !== "byok-http");
  $("#prompt-transport-field").classList.toggle("is-hidden", state.provider !== "custom" || state.mode !== "local-cli");
  $("#status-title").textContent = defaults.title ?? providerDefaults[state.provider].title;
  $("#status-body").textContent = statusHelpText();
  $("#status-badge").textContent = "대기";
  $("#status-badge").className = "pill";
}

function saveVisibleEngineFields() {
  const current = state.engines[state.provider];
  if (!current || !$("#command")) return;
  current.command = $("#command").value.trim();
  current.model = $("#model").value.trim();
  current.reasoning = $("#reasoning").value;
  current.extraArgs = $("#extra-args").value.trim();
  current.promptTransport = $("#prompt-transport").value;
  current.timeoutMs = $("#timeout-ms").value.trim();
  current.mode = state.provider === "byok" ? "byok-http" : "local-cli";
  saveSettings();
}

function renderImageGenerationFields() {
  $$("[data-image-provider]").forEach((button) => button.classList.toggle("active", button.dataset.imageProvider === state.imageGeneration.provider));
  $("#image-command").value = state.imageGeneration.command ?? "";
  $("#image-model").value = state.imageGeneration.model ?? "";
  $("#image-extra-args").value = state.imageGeneration.extraArgs ?? "";
  $("#image-timeout-ms").value = state.imageGeneration.timeoutMs ?? "";
  $("#image-generation-fields").classList.toggle("is-hidden", state.imageGeneration.provider !== "codex-imagegen");
  $("#image-engine-status").textContent = state.imageGeneration.provider === "codex-imagegen"
    ? "codex exec $imagegen"
    : "비활성";
}

function renderImageOptions() {
  $("#image-count").value = normalizedImageCount(state.imageOptions.imageCount);
  $("#image-ratio").value = state.imageOptions.ratio;
  $("#image-style").value = state.imageOptions.style;
  $("#image-background").value = state.imageOptions.background;
  $("#image-custom-background").value = state.imageOptions.customBackground;
  $("#image-use-reference").checked = state.imageOptions.useReference;
  $("#image-custom-background-field").classList.toggle("is-hidden", state.imageOptions.background !== "사용자 지정");
}

function renderGenerationMode() {
  $$("input[name='generation-mode']").forEach((input) => {
    input.checked = input.value === state.generationMode;
  });
  $("#ad-options-panel")?.classList.toggle("is-hidden", state.generationMode !== "ad-set");
  if ($("#ad-mood-preset")) $("#ad-mood-preset").value = state.adOptions.moodPreset;
}

function saveImageGenerationFields() {
  if (!$("#image-command")) return;
  state.imageGeneration.command = $("#image-command").value.trim();
  state.imageGeneration.model = $("#image-model").value.trim();
  state.imageGeneration.extraArgs = $("#image-extra-args").value.trim();
  state.imageGeneration.timeoutMs = $("#image-timeout-ms").value.trim();
  saveSettings();
}

function saveImageOptionsFromUi() {
  if (!$("#image-count")) return;
  state.imageOptions.imageCount = normalizedImageCount($("#image-count").value);
  state.imageOptions.ratio = $("#image-ratio").value;
  state.imageOptions.style = $("#image-style").value;
  state.imageOptions.background = $("#image-background").value;
  state.imageOptions.customBackground = $("#image-custom-background").value.trim();
  state.imageOptions.useReference = $("#image-use-reference").checked;
  renderImageOptions();
  saveSettings();
}

function saveAdOptionsFromUi() {
  const moodPreset = $("#ad-mood-preset")?.value;
  state.adOptions.moodPreset = adMoodPresets.includes(moodPreset) ? moodPreset : "clean";
  saveSettings();
}

function updateRouting(select) {
  const task = select.dataset.routeTask;
  if (!routeTasks.includes(task)) return;
  state.routing[task] = providers.includes(select.value) ? select.value : "custom";
  saveSettings();
  showToast("작업 라우팅을 저장했습니다.");
}

function setSettingsTab(tab) {
  state.settingsTab = tab === "routing" ? "routing" : "engine";
  renderSettings();
  saveSettings();
}

function saveSettingsFromUi() {
  saveVisibleEngineFields();
  saveImageGenerationFields();
  saveImageOptionsFromUi();
  saveSettings();
  showToast("설정을 저장했습니다.");
}

function openSettings() {
  renderSettings();
  $("#settings-overlay").classList.remove("is-hidden");
  $("#settings-dialog").classList.remove("is-hidden");
  $("#settings-dialog").focus();
}

function closeSettings() {
  $("#settings-overlay").classList.add("is-hidden");
  $("#settings-dialog").classList.add("is-hidden");
}

function clearExportState() {
  state.exports = undefined;
  $("#export-output").value = "";
  enableExports(false);
}

function clearRunState(message) {
  state.lastPreflight = undefined;
  clearExportState();
  setPreviewState("생성 전", message, "warn");
}

function preflightMessage(request) {
  return request.mode === "byok-http"
    ? "BYOK endpoint와 token을 확인합니다."
    : `${providerLabels[request.engineId] ?? request.engineId} version/help 명령을 실행합니다.`;
}

function routingSummary() {
  return `카테고리=${providerLabels[state.routing.category]}, 문구=${providerLabels[state.routing.copy]}, 이미지=${providerLabels[state.routing.image]}, 마켓=${providerLabels[state.routing.market]}, 이미지생성=${imageProviderLabels[state.imageGeneration.provider]}`;
}

function readTimeout(value) {
  const numeric = Number.parseInt(value, 10);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : undefined;
}

function imageGenerationRequest() {
  saveImageOptionsFromUi();
  saveImageGenerationFields();
  if (state.imageGeneration.provider !== "codex-imagegen") return { provider: "none" };
  return {
    provider: "codex-imagegen",
    command: state.imageGeneration.command,
    model: state.imageGeneration.model,
    extraArgs: state.imageGeneration.extraArgs,
    timeoutMs: readTimeout(state.imageGeneration.timeoutMs),
    imageCount: Number.parseInt(normalizedImageCount(state.imageOptions.imageCount), 10),
    ratio: state.imageOptions.ratio,
    style: state.imageOptions.style,
    background: state.imageOptions.background,
    customBackground: state.imageOptions.customBackground,
    useReference: state.imageOptions.useReference,
  };
}

function normalizedImageCount(value) {
  const numeric = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(numeric)) return "4";
  return String(Math.min(maxImageCount, Math.max(minImageCount, numeric)));
}

function statusHelpText() {
  if (state.provider === "custom") {
    return "커스텀 CLI는 stdin, 마지막 인자, prompt 파일 경로 중 하나로 실제 프롬프트를 전달합니다.";
  }
  if (state.provider === "codex") {
    return "Codex CLI는 exec non-interactive 모드와 --output-last-message로 최종 답변을 수집합니다.";
  }
  if (state.provider === "claude") {
    return "Claude CLI는 -p/--print non-interactive 모드로 stdout 답변을 수집합니다.";
  }
  if (state.provider === "gemini") {
    return "Gemini CLI는 --prompt 인자로 프롬프트를 전달하고 stdout 답변을 수집합니다.";
  }
  return "BYOK HTTP provider는 endpoint와 현재 세션 token으로만 검증합니다.";
}
