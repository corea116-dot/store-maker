import { defaultImageCount, defaultImageStyle, imageStyleOptions, maxImageCount, minImageCount } from "./image-options.js";

export { defaultImageCount, defaultImageStyle, imageStyleOptions, maxImageCount, minImageCount };

export const providers = ["codex", "claude", "gemini", "custom", "byok"];
export const routeTasks = ["category", "copy", "image", "market"];
export const imageProviders = ["none", "codex-imagegen"];
export const generationModes = ["detail-page", "ad-set"];
export const adMoodPresets = ["clean", "bold", "editorial"];
export const providerLabels = {
  codex: "Codex CLI",
  claude: "Claude CLI",
  gemini: "Gemini CLI",
  custom: "커스텀 CLI",
  byok: "BYOK HTTP",
};
export const imageProviderLabels = {
  none: "사용 안 함",
  "codex-imagegen": "Codex CLI ImageGen",
};

export const providerDefaults = {
  codex: { mode: "local-cli", command: "codex exec --skip-git-repo-check --ephemeral --sandbox read-only", model: "CLI config", reasoning: "CLI 기본값", extraArgs: "", promptTransport: "stdin", timeoutMs: "", title: "Codex CLI 테스트 준비" },
  claude: { mode: "local-cli", command: "claude -p", model: "CLI config", reasoning: "CLI 기본값", extraArgs: "", promptTransport: "stdin", timeoutMs: "", title: "Claude CLI 테스트 준비" },
  gemini: { mode: "local-cli", command: "gemini", model: "gemini-2.5-pro", reasoning: "medium", extraArgs: "", promptTransport: "stdin", timeoutMs: "", title: "Gemini CLI 테스트 준비" },
  custom: { mode: "local-cli", command: "node scripts/mock-engine.mjs", model: "mock", reasoning: "CLI 기본값", extraArgs: "", promptTransport: "stdin", timeoutMs: "", title: "커스텀 CLI 테스트 준비" },
  byok: { mode: "byok-http", command: "http://127.0.0.1:9999/generate", model: "provider-default", reasoning: "CLI 기본값", extraArgs: "", promptTransport: "stdin", timeoutMs: "", title: "BYOK HTTP 테스트 준비" },
};

const SETTINGS_KEY = "store-maker.settings.v2";

const imageGenerationDefaults = {
  provider: "none",
  command: "codex --ask-for-approval never exec --skip-git-repo-check --ephemeral --sandbox workspace-write",
  model: "CLI config",
  extraArgs: "",
  timeoutMs: "300000",
};

const imageOptionDefaults = {
  imageCount: String(defaultImageCount),
  ratio: "1:1",
  style: defaultImageStyle,
  background: "흰 배경",
  customBackground: "",
  useReference: true,
};

const adOptionDefaults = {
  moodPreset: "clean",
};

export const state = {
  mode: "local-cli",
  provider: "custom",
  settingsTab: "engine",
  generationMode: "detail-page",
  engines: structuredClone(providerDefaults),
  routing: { category: "custom", copy: "custom", image: "custom", market: "custom" },
  imageGeneration: structuredClone(imageGenerationDefaults),
  imageOptions: structuredClone(imageOptionDefaults),
  adOptions: structuredClone(adOptionDefaults),
  lastPreflight: undefined,
  exports: undefined,
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    state.provider = providers.includes(saved.provider) ? saved.provider : "custom";
    state.mode = normalizeMode(saved.mode);
    state.generationMode = generationModes.includes(saved.generationMode) ? saved.generationMode : "detail-page";
    state.settingsTab = saved.settingsTab === "routing" ? "routing" : "engine";
    state.routing = { ...state.routing, ...readSavedRouting(saved.routing) };
    state.engines = mergeEngines(saved.engines);
    state.imageGeneration = readSavedImageGeneration(saved.imageGeneration);
    state.imageOptions = readSavedImageOptions(saved.imageOptions);
    state.adOptions = readSavedAdOptions(saved.adOptions);
  } catch (error) {
    localStorage.removeItem(SETTINGS_KEY);
  }
}

export function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    mode: state.mode,
    provider: state.provider,
    generationMode: state.generationMode,
    settingsTab: state.settingsTab,
    routing: state.routing,
    engines: persistedEngines(),
    imageGeneration: persistedImageGeneration(),
    imageOptions: state.imageOptions,
    adOptions: state.adOptions,
  }));
}

export function normalizeMode(mode) {
  return mode === "byok" || mode === "byok-http" ? "byok-http" : "local-cli";
}

function persistedEngines() {
  return Object.fromEntries(providers.map((provider) => {
    const { command, model, reasoning, extraArgs, promptTransport, timeoutMs, mode, title } = state.engines[provider] ?? providerDefaults[provider];
    return [provider, { command, model, reasoning, extraArgs, promptTransport, timeoutMs, mode, title }];
  }));
}

function mergeEngines(savedEngines) {
  const merged = structuredClone(providerDefaults);
  if (typeof savedEngines !== "object" || savedEngines === null) return merged;
  for (const provider of providers) {
    const saved = savedEngines[provider];
    if (typeof saved !== "object" || saved === null) continue;
    merged[provider] = { ...merged[provider], ...saved, mode: provider === "byok" ? "byok-http" : "local-cli" };
  }
  return merged;
}

function readSavedRouting(routing) {
  const saved = {};
  if (typeof routing !== "object" || routing === null) return saved;
  for (const task of routeTasks) {
    if (providers.includes(routing[task])) saved[task] = routing[task];
  }
  return saved;
}

function readSavedImageGeneration(value) {
  if (typeof value !== "object" || value === null) return structuredClone(imageGenerationDefaults);
  return {
    ...structuredClone(imageGenerationDefaults),
    provider: imageProviders.includes(value.provider) ? value.provider : "none",
    command: typeof value.command === "string" ? value.command : imageGenerationDefaults.command,
    model: typeof value.model === "string" ? value.model : imageGenerationDefaults.model,
    extraArgs: typeof value.extraArgs === "string" ? value.extraArgs : "",
    timeoutMs: typeof value.timeoutMs === "string" ? value.timeoutMs : imageGenerationDefaults.timeoutMs,
  };
}

function readSavedImageOptions(value) {
  if (typeof value !== "object" || value === null) return structuredClone(imageOptionDefaults);
  return {
    ...structuredClone(imageOptionDefaults),
    imageCount: readSavedImageCount(value.imageCount ?? value.count),
    ratio: ["1:1", "4:5", "16:9"].includes(value.ratio) ? value.ratio : imageOptionDefaults.ratio,
    style: imageStyleOptions.includes(value.style) ? value.style : imageOptionDefaults.style,
    background: ["흰 배경", "사무실", "책상 위", "스튜디오", "사용자 지정"].includes(value.background) ? value.background : imageOptionDefaults.background,
    customBackground: typeof value.customBackground === "string" ? value.customBackground : "",
    useReference: value.useReference !== false,
  };
}

function readSavedImageCount(value) {
  const numeric = Number.parseInt(value, 10);
  return Number.isSafeInteger(numeric) && numeric >= minImageCount && numeric <= maxImageCount ? String(numeric) : imageOptionDefaults.imageCount;
}

function readSavedAdOptions(value) {
  if (typeof value !== "object" || value === null) return structuredClone(adOptionDefaults);
  return {
    ...structuredClone(adOptionDefaults),
    moodPreset: adMoodPresets.includes(value.moodPreset) ? value.moodPreset : adOptionDefaults.moodPreset,
  };
}

function persistedImageGeneration() {
  const { provider, command, model, extraArgs, timeoutMs } = state.imageGeneration;
  return { provider, command, model, extraArgs, timeoutMs };
}
