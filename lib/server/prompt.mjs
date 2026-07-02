import { materialLines, readAttachments, readImageAttachmentSources } from "./attachments.mjs";
import { AD_GENERATION_MODE, buildAdAutomationResult, composeAdSetPrompt, isAdGenerationMode, readAdAutomationInput, readBrandInput, readGenerationMode } from "./ad-automation.mjs";
import { logEntry } from "./logs.mjs";
import { redactSensitive } from "./redaction.mjs";
import { defaultImageStyle, imageStyleOptions, maxImageCount, minImageCount } from "../../assets/image-options.js";

export function parseGenerationRequest(value) {
  const input = readObject(value);
  const engineInput = readObject(input.engine ?? input);
  const productInput = readObject(input.product ?? input);
  const attachments = readAttachments(productInput.attachments);
  if (!attachments.ok) return invalid(attachments.error);
  const product = {
    name: readString(productInput.name) ?? readString(productInput.productName),
    description: readString(productInput.description),
    requirements: readString(productInput.requirements) ?? arrayText(productInput.requirements),
    materials: readStringArray(productInput.materials ?? productInput.images ?? productInput.imageRefs),
    attachments: attachments.value,
  };
  const markets = readStringArray(input.markets ?? input.targetMarkets);
  const generationMode = readGenerationMode(input.generationMode);
  const engineConfig = {
    mode: normalizeMode(readString(engineInput.mode)),
    engineId: readString(engineInput.engineId) ?? readString(engineInput.engine) ?? "custom",
    command: readString(engineInput.command) ?? defaultCommand(readString(engineInput.engineId)),
    model: readString(engineInput.model),
    reasoning: readString(engineInput.reasoning),
    extraArgs: readString(engineInput.extraArgs),
    promptTransport: readPromptTransport(engineInput.promptTransport),
    byokProvider: readString(engineInput.byokProvider),
    apiKey: readString(engineInput.apiKey),
    timeoutMs: readPositiveInt(engineInput.timeoutMs),
  };
  const routing = readRouting(input.routing);
  const imageGenerationResult = readImageGeneration(input.imageGeneration);
  if (!imageGenerationResult.ok) return invalid(imageGenerationResult.error);
  const imageGeneration = imageGenerationResult.value;
  if (!product.name) return invalid("product.name is required");
  if (!product.description) return invalid("product.description is required");
  if (!product.requirements) return invalid("product.requirements is required");
  if (markets.length === 0) return invalid("at least one target market is required");
  if (engineConfig.mode !== "byok-http" && !engineConfig.command) return invalid("engine.command is required for local CLI");
  const brand = readBrandInput(input.brand);
  const adAutomation = generationMode === AD_GENERATION_MODE
    ? readAdAutomationInput(input.adAutomation, { product, markets, brand })
    : undefined;
  return {
    ok: true,
    value: {
      ...(generationMode === AD_GENERATION_MODE ? { generationMode, brand, adAutomation } : {}),
      product,
      markets,
      engine: engineConfig,
      routing,
      imageGeneration,
      policy: readString(input.policy),
      runtime: { imageAttachmentSources: readImageAttachmentSources(productInput.attachments, attachments.value) },
    },
  };
}

export function composePrompt(input) {
  if (isAdGenerationMode(input)) return composeAdSetPrompt(input);
  return [
    "당신은 한국 이커머스 상세페이지 제작 에이전트입니다.",
    "아래 상품 정보와 요구사항을 실제 입력으로 사용해 상세페이지 초안을 작성하세요.",
    "파일을 수정하거나 로컬 명령을 실행하지 말고 최종 답변만 Markdown으로 출력하세요.",
    "",
    "## 상품 입력",
    `- 상품명: ${input.product.name}`,
    `- 상품 설명: ${input.product.description}`,
    `- 요구사항: ${input.product.requirements}`,
    ...materialLines(input.product),
    `- 목표 마켓: ${input.markets.join(", ")}`,
    "- 작업 목적: 상품 정보를 바탕으로 구매 설득용 상세페이지 초안을 생성하고 마켓별 변환 기준을 제안",
    input.policy ? `- 운영 정책: ${input.policy}` : "- 운영 정책: 원본 자료는 로컬 작업 범위에서만 사용",
    routingText(input.routing),
    "",
    "## 수행 단계",
    "1. 카테고리와 구매 포인트를 분석합니다.",
    "2. 상세페이지 문구를 작성합니다.",
    "3. 이미지 생성/촬영 프롬프트를 목적별로 제안합니다.",
    "4. 목표 마켓별 톤과 정보 순서로 변환합니다.",
    "",
    "## 출력 형식",
    "Markdown으로 제목, 요약, 핵심 bullet, 섹션 본문, 이미지 프롬프트, 마켓별 변환 메모를 포함하세요.",
  ].join("\n");
}

export function buildResult(input, engineOutput, prompt, images) {
  if (isAdGenerationMode(input)) {
    const result = buildAdAutomationResult(input, engineOutput, prompt);
    const markdown = appendImageMarkdown(result.markdown, input, images);
    return {
      ...result,
      markdown,
      html: `${result.html}${imageSectionHtml(input, images)}`,
      ...(images ? { images } : {}),
    };
  }
  const markdown = appendImageMarkdown(engineOutput.trim() || fallbackMarkdown(input), input, images);
  return {
    title: `${input.product.name} 상세페이지`,
    summary: firstUsefulLine(markdown) ?? `${input.product.name}의 상세페이지 초안입니다.`,
    markdown,
    html: `${markdownToHtml(engineOutput.trim() || fallbackMarkdown(input))}${imageSectionHtml(input, images)}`,
    promptPreview: prompt.slice(0, 2000),
    markets: input.markets.map((market) => marketCopy(market, input.product.name, markdown)),
    ...(images ? { images } : {}),
    generatedAt: new Date().toISOString(),
    engineId: input.engine.engineId,
  };
}

export function buildExports(input, result, prompt, logs) {
  const json = {
    product: input.product,
    markets: input.markets,
    engine: redactedEngine(input.engine),
    imageGeneration: exportImageGeneration(input.imageGeneration),
    prompt,
    imagePrompt: result.images?.prompt,
    ...(result.images ? {
      requestedImageCount: result.images.requestedImageCount ?? result.images.count,
      generatedImageCount: result.images.generatedImageCount ?? result.images.files?.length ?? 0,
      imageBriefs: result.images.imageBriefs ?? [],
      images: result.images.images ?? result.images.files ?? [],
    } : {}),
    result,
    logs,
  };
  if (isAdGenerationMode(input)) {
    Object.assign(json, {
      generationMode: AD_GENERATION_MODE,
      brand: input.brand,
      brandDna: result.brandDna,
      adAutomation: result.adAutomation,
      adSet: result.adSet,
    });
  }
  return {
    markdown: result.markdown,
    html: result.html,
    json,
  };
}

export function fallbackResult(input, output) {
  if (isAdGenerationMode(input)) {
    const result = buildAdAutomationResult(input, output, "");
    return {
      title: result.title,
      markdown: result.markdown,
      html: result.html,
      generationMode: result.generationMode,
      brandDna: result.brandDna,
      adAutomation: result.adAutomation,
      adSet: result.adSet,
    };
  }
  const markdown = output.trim() || fallbackMarkdown(input);
  return { title: `${input.product.name} 상세페이지`, markdown, html: markdownToHtml(markdown) };
}

function markdownToHtml(markdown) {
  const html = [];
  let listItems = [];
  for (const line of markdown.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") {
      listItems = flushList(html, listItems);
      continue;
    }
    if (trimmed.startsWith("# ")) {
      listItems = flushList(html, listItems);
      html.push(`<h1>${escapeHtml(trimmed.slice(2))}</h1>`);
      continue;
    }
    if (trimmed.startsWith("## ")) {
      listItems = flushList(html, listItems);
      html.push(`<h2>${escapeHtml(trimmed.slice(3))}</h2>`);
      continue;
    }
    if (trimmed.startsWith("- ")) {
      listItems.push(trimmed.slice(2));
      continue;
    }
    listItems = flushList(html, listItems);
    html.push(`<p>${escapeHtml(trimmed)}</p>`);
  }
  flushList(html, listItems);
  return html.join("\n");
}

function flushList(html, listItems) {
  if (listItems.length > 0) html.push(`<ul>${listItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`);
  return [];
}

function fallbackMarkdown(input) {
  return [
    `# ${input.product.name} 상세페이지 초안`,
    "",
    `대상 마켓: ${input.markets.join(", ")}`,
    "",
    `상품 설명: ${input.product.description}`,
    "",
    `요구사항: ${input.product.requirements}`,
  ].join("\n");
}

function marketCopy(market, productName, markdown) {
  const labels = { smartstore: "스마트스토어", coupang: "쿠팡", eleven: "11번가" };
  return { market, label: labels[market] ?? market, title: `${labels[market] ?? market}용 ${productName}`, body: markdown };
}

function redactedEngine(engineConfig) {
  const { apiKey, ...rest } = engineConfig;
  const safe = { ...rest };
  if (safe.command) safe.command = redactSensitive(safe.command);
  if (safe.extraArgs) safe.extraArgs = redactSensitive(safe.extraArgs);
  return apiKey ? { ...safe, apiKey: "[redacted]" } : safe;
}

function exportImageGeneration(config) {
  if (!config?.enabled) return { provider: "none", enabled: false };
  const { command, extraArgs, ...safe } = config;
  return safe;
}

function appendImageMarkdown(markdown, input, images) {
  if (!images?.files?.length) return markdown;
  const requested = images.requestedImageCount ?? images.count ?? images.files.length;
  const generated = images.generatedImageCount ?? images.files.length;
  const lines = [
    markdown,
    "",
    "## 3. 이미지 생성/촬영 프롬프트",
    "",
    `- 이미지 provider: ${images.providerLabel}`,
    `- 출력 폴더: ${images.outputDir}`,
    `- 생성 상태: 요청 ${requested}개 / 생성 ${generated}개`,
    `- 생성 옵션: ${requested}개, ${images.ratio}, ${images.style}, ${images.background}`,
    ...imageQualityMarkdown(images),
    "",
    ...images.files.flatMap((file) => [
      `![${input.product.name} ${file.filename}](${file.url})`,
      `- 파일: ${file.relativePath}`,
      `- 스타일: ${file.style ?? images.style ?? "미지정"}`,
      `- 목적: ${file.purpose ?? file.brief?.purpose ?? "미지정"}`,
      file.qualityWarning ? `- 품질 경고: ${file.qualityWarning}` : undefined,
      file.brief?.visualPrompt ? `- 브리프: ${file.brief.visualPrompt}` : undefined,
      Number.isSafeInteger(file.width) && Number.isSafeInteger(file.height) ? `- 크기: ${file.width}x${file.height}px` : undefined,
      `- 타입: ${file.mimeType ?? file.type ?? "unknown"}`,
    ]),
    "",
    "<details>",
    "<summary>사용한 프롬프트</summary>",
    "",
    "```text",
    images.prompt,
    "```",
    "",
    "</details>",
  ];
  return lines.join("\n");
}

function imageSectionHtml(input, images) {
  if (!images?.files?.length) return "";
  const requested = images.requestedImageCount ?? images.count ?? images.files.length;
  const generated = images.generatedImageCount ?? images.files.length;
  const files = images.files.map((file) => `
    <figure class="generated-image-card${file.isPlaceholder ? " generated-image-card-placeholder" : ""}">
      <div class="generated-image-frame">
        <img src="${escapeAttribute(file.url)}" alt="${escapeAttribute(`${input.product.name} ${file.filename}`)}" />
        ${file.isPlaceholder ? "<span class=\"generated-image-badge\">테스트 이미지</span>" : ""}
      </div>
      <figcaption>
        <strong>${escapeHtml(file.filename)}</strong>
        <span>${escapeHtml(file.relativePath)} · ${escapeHtml(formatBytes(file.size))}</span>
        <span class="generated-image-style">스타일: ${escapeHtml(file.style ?? images.style ?? "미지정")}</span>
        <span>목적: ${escapeHtml(file.purpose ?? file.brief?.purpose ?? "미지정")}</span>
        ${file.qualityWarning ? `<span class="generated-image-warning">${escapeHtml(file.qualityWarning)}</span>` : ""}
        ${file.brief?.visualPrompt ? `<small>${escapeHtml(file.brief.visualPrompt)}</small>` : ""}
        ${Number.isSafeInteger(file.width) && Number.isSafeInteger(file.height) ? `<span>${escapeHtml(`${file.width}x${file.height}px`)}</span>` : ""}
        <span>${escapeHtml(file.mimeType ?? file.type ?? "unknown")}</span>
      </figcaption>
      <a class="btn" href="${escapeAttribute(file.url)}" download="${escapeAttribute(file.filename)}">다운로드</a>
    </figure>
  `).join("");
  return `
    <section class="generated-image-section">
      <div class="generated-image-head">
        <div>
          <h2>3. 이미지 생성/촬영 프롬프트</h2>
          <p>${escapeHtml(`${images.providerLabel} · ${requested}개 요청 · ${generated}개 생성 · ${images.ratio} · ${images.style} · ${images.background}`)}</p>
          <p class="generated-image-count">${escapeHtml(`요청 ${requested}개 / 생성 ${generated}개`)}</p>
        </div>
        <button class="btn" type="button" data-action="regenerate-images">재생성</button>
      </div>
      ${imageQualityWarningHtml(images)}
      <div class="generated-image-grid">${files}</div>
      <details class="generated-prompt">
        <summary>사용한 프롬프트 보기</summary>
        <pre>${escapeHtml(images.prompt)}</pre>
      </details>
    </section>
  `;
}

function imageQualityMarkdown(images) {
  const warnings = imageQualityWarnings(images);
  if (warnings.length === 0) return [];
  return ["", ...warnings.map((warning) => `- 품질 경고: ${warning}`)];
}

function imageQualityWarningHtml(images) {
  const warnings = imageQualityWarnings(images);
  if (warnings.length === 0) return "";
  return `
    <div class="generated-image-warning-panel" role="note">
      <strong>이미지 품질 확인 필요</strong>
      ${warnings.map((warning) => `<p>${escapeHtml(warning)}</p>`).join("")}
    </div>
  `;
}

function imageQualityWarnings(images) {
  return Array.isArray(images.quality?.warnings)
    ? images.quality.warnings.filter((warning) => typeof warning === "string" && warning.trim())
    : [];
}

function readRouting(value) {
  const input = readObject(value);
  return {
    category: readString(input.category) ?? "custom",
    copy: readString(input.copy) ?? "custom",
    image: readString(input.image) ?? "custom",
    market: readString(input.market) ?? "custom",
  };
}

function readImageGeneration(value) {
  const input = readObject(value);
  const provider = readString(input.provider) ?? "none";
  if (provider !== "codex-imagegen") return { ok: true, value: { provider: "none", enabled: false } };
  const requestedCountValue = Object.hasOwn(input, "imageCount") ? input.imageCount : input.count;
  const imageCount = readImageCount(requestedCountValue);
  if (!imageCount.ok) return imageCount;
  return { ok: true, value: {
    provider,
    enabled: true,
    command: readString(input.command) ?? "codex exec --skip-git-repo-check --ephemeral --sandbox workspace-write",
    model: readString(input.model),
    extraArgs: readString(input.extraArgs),
    timeoutMs: readPositiveInt(input.timeoutMs),
    imageCount: imageCount.value,
    count: imageCount.value,
    ratio: readChoice(input.ratio, ["1:1", "4:5", "16:9"], "1:1"),
    style: readChoice(input.style, imageStyleOptions, defaultImageStyle),
    background: readChoice(input.background, ["흰 배경", "사무실", "책상 위", "스튜디오", "사용자 지정"], "흰 배경"),
    customBackground: readString(input.customBackground),
    useReference: input.useReference !== false,
  } };
}

function readObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readStringArray(value) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim());
  if (typeof value === "string") return value.split(/[\n,]/u).map((item) => item.trim()).filter(Boolean);
  return [];
}

function readPositiveInt(value) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) return undefined;
  return Math.min(value, 300000);
}

function readImageCount(value) {
  const numeric = value === undefined ? 4 : value;
  if (typeof numeric !== "number" || !Number.isSafeInteger(numeric) || numeric < minImageCount || numeric > maxImageCount) {
    return { ok: false, error: `imageGeneration.imageCount must be an integer from ${minImageCount}-${maxImageCount}` };
  }
  return { ok: true, value: numeric };
}

function readChoice(value, choices, fallback) {
  return choices.includes(value) ? value : fallback;
}

function readPromptTransport(value) {
  return ["stdin", "last-arg", "prompt-file"].includes(value) ? value : undefined;
}

function arrayText(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string").join(", ") : undefined;
}

function firstUsefulLine(markdown) {
  return markdown.split("\n").map((line) => line.replace(/^#+\s*/u, "").trim()).find((line) => line.length > 0);
}

function invalid(message) {
  return { ok: false, error: { code: "VALIDATION_ERROR", message }, logs: [logEntry("error", "validation failed", message)] };
}

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

function formatBytes(size) {
  if (size < 1024) return `${size} bytes`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function routingText(routing) {
  if (!routing) return "- 작업 라우팅: 기본 엔진 설정 사용";
  return `- 작업 라우팅: 카테고리 분석=${routing.category}, 상세페이지 문구=${routing.copy}, 이미지 프롬프트=${routing.image}, 마켓별 변환=${routing.market}`;
}

function normalizeMode(mode) {
  return mode === "byok" || mode === "byok-http" ? "byok-http" : "local-cli";
}

function defaultCommand(engineId) {
  const defaults = { codex: "codex exec --skip-git-repo-check --ephemeral --sandbox read-only", claude: "claude -p", gemini: "gemini", custom: "" };
  return engineId ? defaults[engineId] : undefined;
}
