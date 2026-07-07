import { defaultImageCount, defaultImageMoodMode, defaultImageStyle, imageMoodModes, imageStyleOptions, maxImageCount, minImageCount } from "./image-options.js";

export { defaultImageCount, defaultImageStyle, imageStyleOptions, maxImageCount, minImageCount };

export const providers = ["codex", "claude", "gemini", "custom", "byok"];
export const routeTasks = ["category", "copy", "image", "market"];
export const imageProviders = ["none", "codex-imagegen"];
export const generationModes = ["detail-page", "ad-set"];
export const adMoodPresets = [
  "clean",
  "bold",
  "editorial",
  "premium",
  "warm",
  "fresh",
  "minimal",
  "energetic",
  "technical",
  "gift",
  "seasonal",
];
export const jobHistoryPageSizeOptions = [3, 5, 10, 20, 50];
export const logPageSizeOptions = [5, 10, 20, 50, 100];
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
  provider: "codex-imagegen",
  command: "codex exec --skip-git-repo-check --ephemeral --sandbox workspace-write",
  model: "CLI config",
  extraArgs: "",
  timeoutMs: "300000",
};

const imageOptionDefaults = {
  imageCount: String(defaultImageCount),
  moodMode: defaultImageMoodMode,
  sameMoodCount: String(defaultImageCount),
  variedMoodCount: "0",
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
  imageGenerationExplicit: false,
  imageOptions: structuredClone(imageOptionDefaults),
  adOptions: structuredClone(adOptionDefaults),
  jobHistoryPageSize: 5,
  jobHistoryPage: 1,
  jobHistorySearch: "",
  logPageSize: 10,
  logs: [],
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
    state.imageGenerationExplicit = saved.imageGenerationExplicit === true;
    state.imageGeneration = readSavedImageGeneration(saved.imageGeneration, { explicit: state.imageGenerationExplicit });
    state.imageOptions = readSavedImageOptions(saved.imageOptions);
    state.adOptions = readSavedAdOptions(saved.adOptions);
    state.jobHistoryPageSize = readSavedJobHistoryPageSize(saved.jobHistoryPageSize);
    state.logPageSize = readSavedLogPageSize(saved.logPageSize);
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
    imageGenerationExplicit: state.imageGenerationExplicit,
    imageGeneration: persistedImageGeneration(),
    imageOptions: state.imageOptions,
    adOptions: state.adOptions,
    jobHistoryPageSize: state.jobHistoryPageSize,
    logPageSize: state.logPageSize,
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

function readSavedImageGeneration(value, { explicit = false } = {}) {
  if (typeof value !== "object" || value === null) return structuredClone(imageGenerationDefaults);
  const savedProvider = imageProviders.includes(value.provider) ? value.provider : imageGenerationDefaults.provider;
  const provider = !explicit && savedProvider === "none" ? imageGenerationDefaults.provider : savedProvider;
  return {
    ...structuredClone(imageGenerationDefaults),
    provider,
    command: typeof value.command === "string" ? value.command : imageGenerationDefaults.command,
    model: typeof value.model === "string" ? value.model : imageGenerationDefaults.model,
    extraArgs: typeof value.extraArgs === "string" ? value.extraArgs : "",
    timeoutMs: typeof value.timeoutMs === "string" ? value.timeoutMs : imageGenerationDefaults.timeoutMs,
  };
}

function readSavedImageOptions(value) {
  if (typeof value !== "object" || value === null) return structuredClone(imageOptionDefaults);
  const style = imageStyleOptions.includes(value.style) ? value.style : imageOptionDefaults.style;
  const legacyCount = readSavedImageCount(value.imageCount ?? value.count);
  const moodMode = imageMoodModes.includes(value.moodMode) ? value.moodMode : (style === "자동 다양화" || style === "여러 스타일" ? "varied" : imageOptionDefaults.moodMode);
  const hasMoodCounts = Object.hasOwn(value, "sameMoodCount") || Object.hasOwn(value, "variedMoodCount");
  const counts = hasMoodCounts
    ? readSavedMoodCounts(value.sameMoodCount, value.variedMoodCount, legacyCount, moodMode)
    : moodCountsFromMode(legacyCount, moodMode);
  return {
    ...structuredClone(imageOptionDefaults),
    imageCount: String(counts.same + counts.varied),
    moodMode,
    sameMoodCount: String(counts.same),
    variedMoodCount: String(counts.varied),
    ratio: ["1:1", "4:5", "16:9"].includes(value.ratio) ? value.ratio : imageOptionDefaults.ratio,
    style,
    background: ["흰 배경", "사무실", "책상 위", "스튜디오", "사용자 지정"].includes(value.background) ? value.background : imageOptionDefaults.background,
    customBackground: typeof value.customBackground === "string" ? value.customBackground : "",
    useReference: value.useReference !== false,
  };
}

function readSavedImageCount(value) {
  const numeric = Number.parseInt(value, 10);
  return Number.isSafeInteger(numeric) && numeric >= minImageCount && numeric <= maxImageCount ? String(numeric) : imageOptionDefaults.imageCount;
}

function readSavedMoodCounts(sameValue, variedValue, legacyCount, moodMode) {
  const fallback = moodCountsFromMode(legacyCount, moodMode);
  const same = readSavedMoodCount(sameValue, fallback.same);
  const varied = readSavedMoodCount(variedValue, fallback.varied);
  const total = same + varied;
  if (total < minImageCount || total > maxImageCount) return fallback;
  return { same, varied };
}

function readSavedMoodCount(value, fallback) {
  const numeric = Number.parseInt(value, 10);
  return Number.isSafeInteger(numeric) && numeric >= 0 && numeric <= maxImageCount ? numeric : fallback;
}

function moodCountsFromMode(imageCount, moodMode) {
  const total = Number.parseInt(readSavedImageCount(imageCount), 10);
  if (moodMode === "varied") return { same: 0, varied: total };
  if (moodMode === "mixed") {
    const same = Math.ceil(total / 2);
    return { same, varied: total - same };
  }
  return { same: total, varied: 0 };
}

function readSavedAdOptions(value) {
  if (typeof value !== "object" || value === null) return structuredClone(adOptionDefaults);
  return {
    ...structuredClone(adOptionDefaults),
    moodPreset: adMoodPresets.includes(value.moodPreset) ? value.moodPreset : adOptionDefaults.moodPreset,
  };
}

function readSavedJobHistoryPageSize(value) {
  const numeric = Number.parseInt(value, 10);
  return jobHistoryPageSizeOptions.includes(numeric) ? numeric : 5;
}

function readSavedLogPageSize(value) {
  const numeric = Number.parseInt(value, 10);
  return logPageSizeOptions.includes(numeric) ? numeric : 10;
}

function persistedImageGeneration() {
  const { provider, command, model, extraArgs, timeoutMs } = state.imageGeneration;
  return { provider, command, model, extraArgs, timeoutMs };
}
