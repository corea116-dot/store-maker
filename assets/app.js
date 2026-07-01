import { $, $$, getJson, postJson, readableError, showToast } from "./app-utils.js";
import { appendLog, enableExports, renderPreview, renderServerLogs, setPreviewState, setStatus, writeExport } from "./app-view.js";
import { bindAttachmentControls, getAttachments } from "./attachments.js";
import { imageProviderLabels, imageProviders, loadSettings, normalizeMode, providerDefaults, providerLabels, providers, routeTasks, saveSettings, state } from "./settings-state.js";

document.addEventListener("DOMContentLoaded", () => {
  loadSettings();
  populateRoutingSelects();
  bindAttachmentControls();
  bindControls();
  renderSettings();
  void scanEngines();
  void checkHealth();
});

function bindControls() {
  $("[data-action='open-settings']")?.addEventListener("click", openSettings);
  $$("[data-action='close-settings']").forEach((button) => button.addEventListener("click", closeSettings));
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
  $$("[data-action='preflight']").forEach((button) => button.addEventListener("click", () => void runPreflight()));
  $$("[data-action='generate']").forEach((button) => button.addEventListener("click", () => void runGeneration()));
  $$("[data-action='save-settings']").forEach((button) => button.addEventListener("click", saveSettingsFromUi));
  $$("[data-export]").forEach((button) => button.addEventListener("click", () => exportResult(button.dataset.export)));
  document.addEventListener("click", (event) => {
    if (!event.target.closest("[data-action='regenerate-images']")) return;
    void runGeneration();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSettings();
  });
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
  if (!payload.product.name || !payload.product.description || !payload.product.requirements || payload.markets.length === 0) {
    appendLog({ level: "error", title: "validation failed", message: "상품명, 설명, 요구사항, 목표 마켓을 모두 입력하세요." });
    showToast("필수 입력을 확인하세요.");
    return;
  }
  setPreviewState("생성 중", "저장된 엔진/라우팅 설정으로 프롬프트를 전달하고 있습니다.", "warn");
  appendLog({ level: "info", title: "generation requested", message: `${payload.engine.engineId} 엔진으로 ${routingSummary()} 실행` });
  try {
    const result = await postJson("/api/generate", payload);
    state.exports = result.exports;
    renderServerLogs(result.logs ?? []);
    if (!result.ok) {
      clearExportState();
      setPreviewState("생성 실패", result.error?.message ?? "엔진 실행 실패", "error");
      showToast("생성에 실패했습니다.");
      return;
    }
    renderPreview(result.result.html, result.result.title);
    enableExports(true);
    $("#preview-badge").textContent = "생성 완료";
    $("#preview-badge").className = "pill good";
    showToast("생성 결과가 준비되었습니다.");
  } catch (error) {
    setPreviewState("생성 실패", readableError(error), "error");
    appendLog({ level: "error", title: "generation failed", message: readableError(error) });
  }
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
  return {
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
  $("#image-count").value = state.imageOptions.count;
  $("#image-ratio").value = state.imageOptions.ratio;
  $("#image-style").value = state.imageOptions.style;
  $("#image-background").value = state.imageOptions.background;
  $("#image-custom-background").value = state.imageOptions.customBackground;
  $("#image-use-reference").checked = state.imageOptions.useReference;
  $("#image-custom-background-field").classList.toggle("is-hidden", state.imageOptions.background !== "사용자 지정");
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
  state.imageOptions.count = $("#image-count").value;
  state.imageOptions.ratio = $("#image-ratio").value;
  state.imageOptions.style = $("#image-style").value;
  state.imageOptions.background = $("#image-background").value;
  state.imageOptions.customBackground = $("#image-custom-background").value.trim();
  state.imageOptions.useReference = $("#image-use-reference").checked;
  renderImageOptions();
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
    count: Number.parseInt(state.imageOptions.count, 10),
    ratio: state.imageOptions.ratio,
    style: state.imageOptions.style,
    background: state.imageOptions.background,
    customBackground: state.imageOptions.customBackground,
    useReference: state.imageOptions.useReference,
  };
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
