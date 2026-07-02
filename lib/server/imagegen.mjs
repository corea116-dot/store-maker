import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join, sep } from "node:path";
import { IMAGE_RUNS_DIR, IMAGE_UPLOADS_DIR, IMAGEGEN_TIMEOUT_MS, OUTPUT_LIMIT, ROOT } from "./config.mjs";
import { logEntry } from "./logs.mjs";
import { createAdAutomationPlan, isAdGenerationMode } from "./ad-automation.mjs";
import { formatCommand, redactSensitive } from "./redaction.mjs";
import { defaultImageStyle, diversityImageStyles, imageStyleDefinitions, maxImageCount, minImageCount, singleStylePurposes, visualVariations } from "../../assets/image-options.js";

const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const hiddenValueOptions = new Set(["--image", "-i", "--output-last-message", "-o"]);
const MANIFEST_GRACE_MS = 5000;
const DIVERSITY_STYLE_OPTIONS = new Set(diversityImageStyles);

export async function runImageGeneration(input, options = {}) {
  if (!input.imageGeneration?.enabled) return { ok: true, images: undefined, logs: [] };
  if (options.signal?.aborted) return imageCancelled([]);
  const runId = randomUUID();
  const outputRelativeDir = join("outputs", "image-runs", runId);
  const uploadRelativeDir = join("outputs", "uploads", runId);
  const outputDir = join(IMAGE_RUNS_DIR, runId);
  const uploadDir = join(IMAGE_UPLOADS_DIR, runId);
  const config = input.imageGeneration;
  const requestedImageCount = normalizedImageCount(config);
  const providerLabel = "Codex CLI ImageGen";
  const startedAt = Date.now();
  const imageBriefs = buildImageBriefs(input, requestedImageCount);

  await mkdir(outputDir, { recursive: true });
  await mkdir(uploadDir, { recursive: true });

  let references;
  try {
    references = config.useReference ? await persistReferenceImages(input.runtime?.imageAttachmentSources ?? [], uploadDir, uploadRelativeDir) : [];
  } catch (error) {
    return imageFailure("첨부 이미지 저장 실패", error, []);
  }

  const prompt = composeImagePrompt(input, { outputDir, outputRelativeDir, references, imageCount: requestedImageCount, imageBriefs });
  const publicPrompt = publicText(prompt);
  const parsed = parseCommandLine(config.command);
  if (!parsed) {
    return imageFailure(`${providerLabel} command is required`, undefined, []);
  }

  let invocation;
  try {
    invocation = await prepareCodexImageInvocation({ parsed, config, references });
  } catch (error) {
    return imageFailure(error instanceof Error ? error.message : "Codex CLI ImageGen 실행 준비에 실패했습니다.", error, []);
  }

  const safeCommand = formatCommand(invocation.command, invocation.args, invocation.hiddenArgIndexes);
  const logs = [
    logEntry("info", "image generation requested", `${providerLabel} image 단계에서 ${safeCommand} 실행을 시작합니다.`),
  ];

  try {
    const execution = await spawnImageInvocation({
      invocation,
      prompt,
      timeoutMs: config.timeoutMs ?? IMAGEGEN_TIMEOUT_MS,
      providerLabel,
      outputDir,
      outputRelativeDir,
      runId,
      startedAt,
      expectedCount: requestedImageCount,
      referenceCount: references.length,
      logs,
      signal: options.signal,
    });
    if (!execution.ok) return execution;
    if (options.signal?.aborted) return imageCancelled(execution.logs);
    let collection = await collectGeneratedImages({
      outputDir,
      outputRelativeDir,
      runId,
      startedAt,
      expectedCount: requestedImageCount,
      input,
      references,
      providerLabel,
      imageBriefs,
    });
    if (collection.files.length < requestedImageCount) {
      const retryPrompt = composeImageRetryPrompt(input, {
        outputDir,
        outputRelativeDir,
        references,
        imageCount: requestedImageCount,
        generatedCount: collection.files.length,
        files: collection.files,
        imageBriefs,
      });
      const retry = await spawnImageInvocation({
        invocation,
        prompt: retryPrompt,
        timeoutMs: config.timeoutMs ?? IMAGEGEN_TIMEOUT_MS,
        providerLabel,
        outputDir,
        outputRelativeDir,
        runId,
        startedAt,
        expectedCount: requestedImageCount,
        referenceCount: references.length,
        logs: [
          logEntry(
            "warning",
            "image generation retry requested",
            `${requestedImageCount}개 요청, ${collection.files.length}개 생성. 부족한 ${requestedImageCount - collection.files.length}개 보충 생성을 1회 재시도합니다.`,
          ),
        ],
        signal: options.signal,
      });
      if (options.signal?.aborted || retry.aborted) return imageCancelled([...execution.logs, ...retry.logs]);
      collection = await collectGeneratedImages({
        outputDir,
        outputRelativeDir,
        runId,
        startedAt,
        expectedCount: requestedImageCount,
        input,
        references,
        providerLabel,
        imageBriefs,
      });
      execution.logs.push(...retry.logs);
      if (!retry.ok && collection.files.length < requestedImageCount) {
        const diagnostics = imageShortfallMessage(requestedImageCount, collection.files.length, collection.files);
        return {
          ok: false,
          error: `${diagnostics} ${retry.error ?? ""}`.trim(),
          logs: [...execution.logs, logEntry("error", "image generation failed", diagnostics)],
        };
      }
    }
    if (collection.files.length < requestedImageCount) {
      const diagnostics = imageShortfallMessage(requestedImageCount, collection.files.length, collection.files);
      return {
        ok: false,
        error: diagnostics,
        logs: [...execution.logs, logEntry("error", "image generation failed", diagnostics)],
      };
    }
    const uniqueResult = await ensureUniqueImageCollection({
      collection,
      input,
      outputDir,
      outputRelativeDir,
      runId,
      references,
      providerLabel,
      imageBriefs,
      invocation,
      timeoutMs: config.timeoutMs ?? IMAGEGEN_TIMEOUT_MS,
      requestedImageCount,
      signal: options.signal,
    });
    execution.logs.push(...uniqueResult.logs);
    if (!uniqueResult.ok) {
      return {
        ok: false,
        error: uniqueResult.error,
        logs: [...execution.logs, logEntry("error", "image generation failed", uniqueResult.error)],
      };
    }
    collection = uniqueResult.collection;
    if (collection.files.length === 0) {
      const diagnostic = execution.diagnostic ? ` ${execution.diagnostic}` : "";
      return {
        ok: false,
        error: `${providerLabel} 실행은 끝났지만 output 이미지 파일이 생성되지 않았습니다.${diagnostic} $imagegen 사용 가능 여부, --image 파일 접근, output directory 쓰기/복사 지시를 확인하세요.`,
        logs: [...execution.logs, logEntry("error", "image generation failed", `output 이미지 파일을 찾지 못했습니다.${diagnostic}`)],
      };
    }
    const quality = imageQualitySummary(collection.files, config.command);
    const files = collection.files.map((file) => annotateImageFileQuality(file, quality));
    const qualityLogs = quality.warnings.length
      ? [logEntry("warning", "image quality warning", quality.warnings.join(" "))]
      : [];
    const recoveryLogs = collection.fallbackCreated
      ? [logEntry("warning", "fallback manifest created", `이미지는 생성됐지만 manifest가 없어 ${collection.files.length}개 이미지 파일로 fallback manifest를 자동 생성했습니다.`)]
      : [];
    const importLogs = collection.importedFromCodexHome
      ? [logEntry("warning", "image output imported", `Codex 기본 이미지 저장소에서 새 이미지 ${collection.importedFromCodexHome}개를 ${outputRelativeDir}로 복구했습니다.`)]
      : [];
    return {
      ok: true,
      images: {
        provider: "codex-imagegen",
        providerLabel,
        runId,
        outputDir: outputRelativeDir,
        prompt: publicPrompt,
        imageCount: requestedImageCount,
        count: requestedImageCount,
        requestedImageCount,
        generatedImageCount: files.length,
        ratio: config.ratio,
        style: config.style,
        imageBriefs,
        background: effectiveBackground(config),
        referenceFiles: references.map(({ name, type, size }) => ({ name, type, size })),
        quality,
        files,
        images: files,
        manifest: collection.manifest,
      },
      logs: [...execution.logs, ...importLogs, ...recoveryLogs, ...qualityLogs, logEntry("success", "image generation completed", `${requestedImageCount}개 요청, ${files.length}개 생성. 이미지 파일을 ${outputRelativeDir}에서 찾았습니다.`)],
    };
  } finally {
    await invocation.cleanup?.();
  }
}

function imageQualitySummary(files, command) {
  const isTestProvider = isTestImageProviderCommand(command);
  const tinyPlaceholderCount = files.filter(isLikelyPlaceholderImage).length;
  const placeholderCount = isTestProvider ? files.length : tinyPlaceholderCount;
  const warnings = [];
  if (isTestProvider) {
    warnings.push("현재 ImageGen command가 fake-codex-imagegen.mjs 테스트 엔진입니다. 실제 상품 사진이 아닌 테스트용 플레이스홀더 이미지를 생성합니다.");
  }
  if (tinyPlaceholderCount > 0) {
    warnings.push(`${tinyPlaceholderCount}개 이미지가 16px 이하의 저해상도 플레이스홀더로 감지되었습니다.`);
  }
  const level = placeholderCount === 0
    ? "ok"
    : placeholderCount >= files.length
      ? "placeholder"
      : "mixed";
  return {
    level,
    isTestProvider,
    checkedCount: files.length,
    placeholderCount,
    warnings,
  };
}

function annotateImageFileQuality(file, quality) {
  const isPlaceholder = quality.isTestProvider || isLikelyPlaceholderImage(file);
  if (!isPlaceholder) return file;
  return {
    ...file,
    isPlaceholder: true,
    qualityLabel: "테스트 이미지",
    qualityWarning: "실제 상품 사진이 아닌 테스트용 플레이스홀더입니다.",
  };
}

function isTestImageProviderCommand(command = "") {
  return /(?:^|[/\\])fake-codex-imagegen\.mjs(?:\s|$)/u.test(command);
}

function isLikelyPlaceholderImage(file) {
  return Number.isSafeInteger(file.width)
    && Number.isSafeInteger(file.height)
    && file.width <= 16
    && file.height <= 16
    && Number.isSafeInteger(file.size)
    && file.size <= 1024;
}

function composeImagePrompt(input, { outputDir, outputRelativeDir, references, imageCount, imageBriefs }) {
  const config = input.imageGeneration;
  const requestedCount = imageCount ?? normalizedImageCount(config);
  const targetFiles = plannedImageFiles(requestedCount);
  const briefs = imageBriefs ?? buildImageBriefs(input, requestedCount);
  const attachmentSummary = input.product.attachments?.length
    ? input.product.attachments.map((attachment) => `- ${attachment.name} | ${attachment.type} | ${attachment.size} bytes | ${attachment.kind}`).join("\n")
    : "- 제공 없음";
  const referenceSummary = references.length
    ? references.map((reference) => `- ${reference.name} (${reference.type}, ${reference.size} bytes) | attached via --image | ${reference.relativePath} | ${reference.absolutePath}`).join("\n")
    : "- reference image 없음. 텍스트 정보만 기반으로 생성";
  const targetFile = join(outputDir, "product-main.png");
  const targetRelativeFile = join(outputRelativeDir, "product-main.png");
  const targetFileLines = targetFiles.map((filename, index) => `- image-${String(index + 1).padStart(2, "0")}: ${join(outputRelativeDir, filename)} | ${join(outputDir, filename)}`).join("\n");
  const briefLines = imageBriefLines(briefs).join("\n");
  const briefsJson = JSON.stringify({ imageBriefs: briefs }, null, 2);

  if (isAdGenerationMode(input)) {
    const plan = createAdAutomationPlan(input);
    const angles = plan.adAutomation.recommendedAngles.length
      ? plan.adAutomation.recommendedAngles.map((angle, index) => `${index + 1}. ${angle.label} (${angle.id})`).join("\n")
      : "- 서버 추천 앵글 없음";
    const brandDnaLines = Object.entries(plan.brandDna.layers).map(([key, layer]) => `- ${key}: ${layer.summary}`).join("\n");
    const visualBriefs = (plan.adSet.items ?? plan.adSet.ads)
      .map((ad) => `- ${ad.id}: ${ad.visualBrief}`)
      .join("\n");
    return [
      "$imagegen",
      "한국 이커머스 광고 세트에 사용할 대표 제품 광고 이미지를 실제 이미지 파일로 생성하세요.",
      "상품 사진의 형태를 왜곡하지 말고, 과장 광고·검증되지 않은 효능·순위 보장 표현을 피하세요.",
      "",
      "## 상품 정보",
      `- 상품명: ${input.product.name}`,
      `- 상품 설명: ${input.product.description}`,
      `- 요구사항: ${input.product.requirements}`,
      `- 목표 마켓: ${input.markets.join(", ")}`,
      `- 무드 프리셋: ${input.adAutomation?.mood?.label ?? input.adAutomation?.moodPreset ?? "clean"}`,
      "",
      "## Brand DNA",
      brandDnaLines,
      "",
      "## 추천 카피 앵글",
      angles,
      "",
      "## 광고 비주얼 브리프 5개",
      visualBriefs,
      "",
      "## 이미지별 브리프",
      briefLines,
      "",
      "## imageBriefs JSON",
      briefsJson,
      "",
      "## 첨부 파일 요약",
      attachmentSummary,
      "",
      "## Reference 이미지",
      referenceSummary,
      "",
      "## 생성 옵션",
      `- 생성 개수: ${requestedCount}`,
      `- 비율: ${config.ratio}`,
      `- 스타일: ${config.style}`,
      `- 배경: ${effectiveBackground(config)}`,
      "",
      "## Output Contract",
      `OUTPUT_DIR: ${outputRelativeDir}`,
      `OUTPUT_DIR_RELATIVE: ${outputRelativeDir}`,
      `OUTPUT_DIR_ABSOLUTE: ${outputDir}`,
      `TARGET_FILE_RELATIVE: ${targetRelativeFile}`,
      `TARGET_FILE_ABSOLUTE: ${targetFile}`,
      `REQUESTED_IMAGE_COUNT: ${requestedCount}`,
      `GENERATE_IMAGE_COUNT: ${requestedCount}`,
      "TARGET_FILES:",
      targetFileLines,
      `정확히 ${requestedCount}개의 독립 이미지 파일을 생성하세요.`,
      "한 장짜리 콜라주/그리드/시트 이미지로 합치지 말고, 위 TARGET_FILES의 각 파일에 별도 이미지를 저장하세요.",
      "생성 이미지를 반드시 위 output directory에 저장하세요.",
      "파일명은 product-main.png, product-main-02.png처럼 안정적인 이름을 사용하세요.",
      "텍스트 설명만 하지 말고 실제 png/jpg/webp 이미지 파일을 저장하세요.",
      "$imagegen 도구가 이미지를 CODEX_HOME/generated_images 같은 기본 위치에 저장하면, 생성된 최종 이미지 파일들을 TARGET_FILES의 절대 경로로 복사하세요.",
      `저장 후 ${requestedCount}개 파일이 모두 존재하고 0 bytes가 아닌지 확인하세요.`,
      "manifest.json을 같은 폴더에 생성하고 files 배열에 생성 파일명을 순서대로 기록하세요.",
      "manifest.json 작성이 실패하더라도 생성 이미지는 반드시 output directory에 남기세요.",
      "저장 후 작업을 종료하세요. 추가 질문하지 말고 대화형 입력을 기다리지 마세요.",
      "최종 답변은 짧게 완료 여부만 설명하고, 실제 산출물은 이미지 파일이어야 합니다.",
    ].join("\n");
  }

  return [
    "$imagegen",
    "한국 이커머스 상세페이지용 제품 이미지를 실제 이미지 파일로 생성하세요.",
    "과장 광고, 의료/성능 보장 표현, 실제 상품 형태 왜곡을 피하고 상품 정보와 요구사항에 맞춥니다.",
    "",
    "## 상품 정보",
    `- 상품명: ${input.product.name}`,
    `- 상품 설명: ${input.product.description}`,
    `- 요구사항: ${input.product.requirements}`,
    `- 목표 마켓: ${input.markets.join(", ")}`,
    "",
    "## 첨부 파일 요약",
    attachmentSummary,
    "",
    "## Reference 이미지",
    referenceSummary,
    "",
      "## 이미지별 브리프",
      briefLines,
      "",
      "## imageBriefs JSON",
      briefsJson,
      "",
      "## 생성 옵션",
    `- 생성 개수: ${requestedCount}`,
    `- 비율: ${config.ratio}`,
    `- 스타일: ${config.style}`,
    `- 배경: ${effectiveBackground(config)}`,
    "",
    "## Output Contract",
    `OUTPUT_DIR: ${outputRelativeDir}`,
    `OUTPUT_DIR_RELATIVE: ${outputRelativeDir}`,
    `OUTPUT_DIR_ABSOLUTE: ${outputDir}`,
    `TARGET_FILE_RELATIVE: ${targetRelativeFile}`,
    `TARGET_FILE_ABSOLUTE: ${targetFile}`,
    `REQUESTED_IMAGE_COUNT: ${requestedCount}`,
    `GENERATE_IMAGE_COUNT: ${requestedCount}`,
    "TARGET_FILES:",
    targetFileLines,
    `정확히 ${requestedCount}개의 독립 이미지 파일을 생성하세요.`,
    "한 장짜리 콜라주/그리드/시트 이미지로 합치지 말고, 위 TARGET_FILES의 각 파일에 별도 이미지를 저장하세요.",
    "생성 이미지를 반드시 위 output directory에 저장하세요.",
    "파일명은 product-main.png, product-main-02.png처럼 안정적인 이름을 사용하세요.",
    "텍스트 설명만 하지 말고 실제 png/jpg/webp 이미지 파일을 저장하세요.",
    "$imagegen 도구가 이미지를 CODEX_HOME/generated_images 같은 기본 위치에 저장하면, 생성된 최종 이미지 파일들을 TARGET_FILES의 절대 경로로 복사하세요.",
    `저장 후 ${requestedCount}개 파일이 모두 존재하고 0 bytes가 아닌지 확인하세요.`,
    "manifest.json을 같은 폴더에 생성하고 files 배열에 생성 파일명을 순서대로 기록하세요.",
    "manifest.json 작성이 실패하더라도 생성 이미지는 반드시 output directory에 남기세요.",
    "저장 후 작업을 종료하세요. 추가 질문하지 말고 대화형 입력을 기다리지 마세요.",
    "최종 답변은 짧게 완료 여부만 설명하고, 실제 산출물은 이미지 파일이어야 합니다.",
  ].join("\n");
}

function composeImageRetryPrompt(input, { outputDir, outputRelativeDir, references, imageCount, generatedCount, files, imageBriefs }) {
  const remaining = Math.max(0, imageCount - generatedCount);
  const startIndex = generatedCount + 1;
  const targetFiles = plannedImageFiles(imageCount).slice(generatedCount);
  const remainingBriefs = (imageBriefs ?? buildImageBriefs(input, imageCount)).slice(generatedCount);
  const existing = files.length
    ? files.map((file) => `- ${file.filename} | ${file.relativePath} | ${file.size} bytes`).join("\n")
    : "- 없음";
  const targetFileLines = targetFiles.map((filename, index) => `- image-${String(startIndex + index).padStart(2, "0")}: ${join(outputRelativeDir, filename)} | ${join(outputDir, filename)}`).join("\n");
  const briefLines = imageBriefLines(remainingBriefs).join("\n");
  return [
    "$imagegen",
    "이전 이미지 생성 실행에서 요청 개수보다 적은 파일만 생성되었습니다. 부족분만 보충 생성하세요.",
    `REQUESTED_IMAGE_COUNT: ${imageCount}`,
    `GENERATE_IMAGE_COUNT: ${remaining}`,
    `RETRY_IMAGE_START_INDEX: ${startIndex}`,
    `OUTPUT_DIR: ${outputRelativeDir}`,
    `OUTPUT_DIR_RELATIVE: ${outputRelativeDir}`,
    `OUTPUT_DIR_ABSOLUTE: ${outputDir}`,
    "## 이미 생성된 파일",
    existing,
    "## 추가 생성 대상",
    targetFileLines,
    "",
    "## 남은 imageBriefs JSON",
    JSON.stringify({ imageBriefs: remainingBriefs }, null, 2),
    "",
    "## 남은 이미지별 브리프",
    briefLines,
    "",
    `정확히 ${remaining}개의 독립 이미지 파일을 추가 생성하세요.`,
    "기존 파일을 덮어쓰지 마세요. 한 장짜리 콜라주/그리드 이미지는 실패입니다.",
    "manifest.json의 files 배열에는 기존 파일과 새 파일을 합쳐 순서대로 기록하세요.",
    `Reference 이미지 수: ${references.length}`,
    `상품명: ${input.product.name}`,
    `요구사항: ${input.product.requirements}`,
  ].join("\n");
}

function composeDuplicateRepairPrompt(input, { outputDir, outputRelativeDir, references, imageCount, targetIndex, targetFilename, existingFiles, imageBrief }) {
  const existing = existingFiles.length
    ? existingFiles.map((file) => `- ${file.filename} | sha256=${file.contentHash ?? "unknown"} | ${file.size} bytes`).join("\n")
    : "- 없음";
  const targetLine = `- image-${String(targetIndex).padStart(2, "0")}: ${join(outputRelativeDir, targetFilename)} | ${join(outputDir, targetFilename)}`;
  return [
    "$imagegen",
    "DUPLICATE_REPAIR_MODE",
    "이전 이미지 생성 실행에서 동일한 파일 해시가 발견되었습니다. 아래 한 슬롯만 새 이미지로 보충 생성하세요.",
    `REQUESTED_IMAGE_COUNT: ${imageCount}`,
    "GENERATE_IMAGE_COUNT: 1",
    `RETRY_IMAGE_START_INDEX: ${targetIndex}`,
    `OUTPUT_DIR: ${outputRelativeDir}`,
    `OUTPUT_DIR_RELATIVE: ${outputRelativeDir}`,
    `OUTPUT_DIR_ABSOLUTE: ${outputDir}`,
    "## 이미 보존된 고유 이미지",
    existing,
    "## 이번 보충 생성 대상",
    targetLine,
    "",
    "## 이번 이미지 브리프",
    JSON.stringify({ imageBrief }, null, 2),
    "",
    "반드시 새 이미지를 생성하세요. 기존 파일이나 기존 이미지 바이트를 복사하지 마세요.",
    "저장 후 대상 파일이 기존 sha256 해시들과 달라야 합니다.",
    "한 장짜리 콜라주/그리드 이미지는 실패입니다.",
    `Reference 이미지 수: ${references.length}`,
    `상품명: ${input.product.name}`,
    `요구사항: ${input.product.requirements}`,
  ].join("\n");
}

function imageBriefLines(imageBriefs) {
  return imageBriefs.map((brief) => [
    `- image-${String(brief.index).padStart(2, "0")} (${brief.filename})`,
    `스타일: ${brief.style}`,
    `목적: ${brief.purpose}`,
    `비율: ${brief.ratio}`,
    `프롬프트: ${brief.visualPrompt}`,
  ].join(" | "));
}

function buildImageBriefs(input, imageCount) {
  const count = normalizedExpectedCount(imageCount);
  const files = plannedImageFiles(count);
  const selectedStyle = normalizeImageStyle(input.imageGeneration?.style);
  const diversify = DIVERSITY_STYLE_OPTIONS.has(selectedStyle);
  const adBriefs = adImageBriefs(input);
  const background = effectiveBackground(input.imageGeneration);
  return files.map((filename, index) => {
    const definition = diversify
      ? imageStyleDefinitions[index % imageStyleDefinitions.length]
      : imageStyleDefinition(selectedStyle);
    const variation = visualVariations[index % visualVariations.length];
    const cycle = Math.floor(index / imageStyleDefinitions.length) + 1;
    const purpose = diversify
      ? `${definition.purpose}${cycle > 1 ? ` 변주 ${cycle}` : ""}`
      : `${singleStylePurposes[index % singleStylePurposes.length]}${index >= singleStylePurposes.length ? ` 변주 ${Math.floor(index / singleStylePurposes.length) + 1}` : ""}`;
    const contextBrief = adBriefs[index % adBriefs.length] ?? `${input.product.name}의 ${definition.style} 이미지`;
    const visualPrompt = [
      `${definition.style} 스타일`,
      `목적: ${purpose}`,
      `상품: ${input.product.name}`,
      `핵심 맥락: ${definition.focus}`,
      `구도: ${variation.composition}`,
      `배경: ${background}, ${variation.background}`,
      `조명: ${variation.lighting}`,
      `카피 배치: ${variation.copy}`,
      `소품: ${variation.props}`,
      `촬영 거리: ${variation.distance}`,
      `참고 브리프: ${contextBrief}`,
    ].join(" / ");
    return {
      index: index + 1,
      filename,
      style: definition.style,
      purpose,
      ratio: input.imageGeneration?.ratio ?? "1:1",
      visualPrompt,
    };
  });
}

function normalizeImageStyle(style) {
  if (typeof style !== "string") return defaultImageStyle;
  if (DIVERSITY_STYLE_OPTIONS.has(style)) return style;
  return imageStyleDefinitions.some((definition) => definition.style === style) ? style : defaultImageStyle;
}

function imageStyleDefinition(style) {
  return imageStyleDefinitions.find((definition) => definition.style === style) ?? imageStyleDefinitions[0];
}

function adImageBriefs(input) {
  if (!isAdGenerationMode(input)) {
    return [
      `${input.product.name} 대표 제품컷. ${input.product.description}`,
      `${input.product.name} 사용 장면. ${input.product.requirements}`,
      `${input.product.name} 상세페이지 배너형 구성. 목표 마켓: ${input.markets.join(", ")}`,
    ];
  }
  const plan = createAdAutomationPlan(input);
  return (plan.adSet.items ?? plan.adSet.ads ?? []).map((ad) => `${ad.id}: ${ad.visualBrief}`);
}

function plannedImageFiles(count) {
  return Array.from({ length: count }, (_, index) => (index === 0 ? "product-main.png" : `product-main-${String(index + 1).padStart(2, "0")}.png`));
}

async function persistReferenceImages(sources, uploadDir, uploadRelativeDir) {
  const references = [];
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    const buffer = decodeDataUrl(source.dataUrl, source.type);
    if (!buffer) continue;
    const filename = `${String(index + 1).padStart(2, "0")}-${safeOutputName(source.name)}`;
    const absolutePath = join(uploadDir, filename);
    await writeFile(absolutePath, buffer);
    references.push({
      name: source.name,
      type: source.type,
      size: buffer.length,
      relativePath: join(uploadRelativeDir, filename),
      absolutePath,
    });
  }
  return references;
}

async function prepareCodexImageInvocation({ parsed, config, references }) {
  const tempDir = await mkdtemp(join(tmpdir(), "store-maker-imagegen-"));
  const outputFile = join(tempDir, "last-message.md");
  let args = ensureCodexExecArgs([...parsed.args, ...parseWords(config.extraArgs ?? "")]);
  args = withoutOption(args, "--output-last-message", "-o");
  args = withoutOption(args, "--image", "-i");
  args = ensureFlag(args, "--skip-git-repo-check");
  args = ensureFlag(args, "--ephemeral");
  args = ensureOptionPair(args, "--sandbox", "workspace-write", "-s");
  args = ensureOptionPair(args, "--color", "never");
  if (config.model && !/^(cli config|default|provider-default)$/iu.test(config.model)) args = ensureOptionPair(args, "--model", config.model, "-m");
  args.push("--output-last-message", outputFile);
  for (const reference of references) args.push("--image", reference.absolutePath);
  args.push("-");
  return {
    command: parsed.command,
    args,
    hiddenArgIndexes: hiddenArgIndexes(args),
    outputFile,
    cleanup: () => rm(tempDir, { recursive: true, force: true }),
  };
}

function spawnImageInvocation({ invocation, prompt, timeoutMs, providerLabel, outputDir, outputRelativeDir, runId, startedAt, expectedCount, referenceCount, logs, signal }) {
  if (signal?.aborted) return Promise.resolve(imageCancelled(logs));
  return new Promise((resolveRun) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: ROOT,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let killTimer;
    let stdout = "";
    let stderr = "";
    let lastOutputSignature = "";
    let firstStableImageAt;

    let timer;
    let outputTimer;
    const cleanupTimers = () => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      clearInterval(outputTimer);
      signal?.removeEventListener("abort", abortHandler);
    };
    const abortHandler = () => {
      if (settled) return;
      aborted = true;
      killProcessTree(child, "SIGTERM");
      killTimer = setTimeout(() => killProcessTree(child, "SIGKILL"), 500);
    };
    timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child, "SIGTERM");
      killTimer = setTimeout(() => killProcessTree(child, "SIGKILL"), 500);
    }, timeoutMs);
    outputTimer = setInterval(() => {
      void settleWhenOutputContractReady();
    }, 1000);
    signal?.addEventListener("abort", abortHandler, { once: true });
    if (signal?.aborted) abortHandler();

    async function settleWhenOutputContractReady() {
      if (settled || aborted) return;
      const files = await findGeneratedImagesWithRecovery({ outputDir, outputRelativeDir, runId, startedAt, expectedCount });
      if (files.length < normalizedExpectedCount(expectedCount)) return;
      const signature = files.map((file) => `${file.filename}:${file.size}`).join("|");
      if (signature !== lastOutputSignature) {
        lastOutputSignature = signature;
        firstStableImageAt = undefined;
        return;
      }
      firstStableImageAt ??= Date.now();
      const manifestPresent = await hasManifest(outputDir);
      if (!manifestPresent && Date.now() - firstStableImageAt < MANIFEST_GRACE_MS) return;
      if (aborted) return;
      settled = true;
      cleanupTimers();
      await stopChild(child);
      resolveRun({
        ok: true,
        logs: [
          ...logs,
          logEntry("success", "image output detected", `${providerLabel} output contract가 ${outputRelativeDir}에서 충족되어 CLI 종료 대기 없이 완료 처리했습니다. manifest=${manifestPresent ? "present" : "missing"}`),
        ],
      });
    }

    child.stdout.on("data", (chunk) => {
      stdout = limit(stdout + String(chunk));
    });
    child.stderr.on("data", (chunk) => {
      stderr = limit(stderr + String(chunk));
    });
    child.stdin.on("error", () => {});
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      cleanupTimers();
      if (aborted) {
        resolveRun(imageCancelled(logs));
        return;
      }
      resolveRun({ ok: false, error: processErrorMessage(error, providerLabel), logs: [...logs, logEntry("error", "image generation failed", processErrorMessage(error, providerLabel))] });
    });
    child.on("close", async (code, signal) => {
      if (settled) return;
      settled = true;
      cleanupTimers();

      if (aborted) {
        resolveRun(imageCancelled(logs));
        return;
      }
      if (timedOut) {
        const recoveredFiles = await findGeneratedImagesWithRecovery({ outputDir, outputRelativeDir, runId, startedAt, expectedCount });
        if (recoveredFiles.length > 0) {
          const manifestPresent = await hasManifest(outputDir);
          resolveRun({
            ok: true,
            logs: [
              ...logs,
              logEntry("warning", "image output recovered", `${providerLabel}가 timeout 되었지만 ${outputRelativeDir}에서 ${recoveredFiles.length}개 이미지 파일을 발견해 process tree를 정리하고 자동 복구했습니다. manifest=${manifestPresent ? "present" : "missing"}`),
            ],
          });
          return;
        }
        const outputState = await outputDirectoryState(outputDir);
        const diagnostic = await invocationDiagnostic({ invocation, stdout, stderr, prompt, referenceCount, outputRelativeDir, outputState });
        const message = `${providerLabel}가 image 단계에서 timed out after ${timeoutMs}ms. output directory 상태: ${outputState}. ${diagnostic} 이미지 파일이 0개라 성공 처리하지 않았습니다. $imagegen 사용 가능 여부, --image 파일 접근, output directory 쓰기/복사 지시를 확인하세요.`;
        resolveRun({ ok: false, error: message, diagnostic, logs: [...logs, logEntry("error", "image generation timed out", message)] });
        return;
      }
      if (code === 0) {
        const output = await readInvocationOutput(invocation, stdout);
        const diagnostic = await invocationDiagnostic({ invocation, stdout, stderr, prompt, referenceCount, outputRelativeDir, outputState: await outputDirectoryState(outputDir) });
        resolveRun({ ok: true, diagnostic, logs: [...logs, logEntry("success", "image prompt delivered", `${providerLabel} image 단계 완료. output=${output ? "captured" : "empty"}. exit=${code}`)] });
        return;
      }
      const diagnostic = await invocationDiagnostic({ invocation, stdout, stderr, prompt, referenceCount, outputRelativeDir, outputState: await outputDirectoryState(outputDir) });
      const output = publicText(limit((stderr || stdout || "").trim()));
      const auth = looksLikeAuthError(output);
      const exit = code === null ? `signal ${signal}` : `exit ${code}`;
      const message = auth
        ? `${providerLabel} 인증이 필요합니다. 터미널에서 먼저 로그인하세요. ${output}`
        : `${providerLabel} 실행 실패 (image 단계, ${exit}). ${output || "CLI 출력이 없습니다."} ${diagnostic}`;
      resolveRun({ ok: false, error: message, diagnostic, logs: [...logs, logEntry("error", "image generation failed", message)] });
    });

    child.stdin.end(prompt);
  });
}

function killProcessTree(child, signal) {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") {
      child.kill(signal);
      return;
    }
    process.kill(-child.pid, signal);
  } catch (error) {
    try {
      child.kill(signal);
    } catch (innerError) {
      // Process already exited.
    }
  }
}

function stopChild(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolveStop) => {
    let done = false;
    let sigkillTimer;
    let resolveTimer;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(sigkillTimer);
      clearTimeout(resolveTimer);
      resolveStop();
    };
    child.once("close", finish);
    killProcessTree(child, "SIGTERM");
    sigkillTimer = setTimeout(() => killProcessTree(child, "SIGKILL"), 500);
    resolveTimer = setTimeout(finish, 2000);
  });
}

async function findGeneratedImages(outputDir, outputRelativeDir, runId) {
  const imagePaths = await findImagePaths(outputDir);
  const files = [];
  for (const absolutePath of imagePaths) {
    const filename = absolutePath.slice(outputDir.length + 1);
    const ext = extensionOf(filename);
    const info = await stat(absolutePath);
    const type = mimeType(ext);
    const dimensions = await readImageDimensions(absolutePath, ext);
    const contentHash = await imageContentHash(absolutePath);
    files.push({
      filename,
      relativePath: join(outputRelativeDir, filename),
      url: `/${outputRelativeDir.split(sep).join("/")}/${filename.split(sep).map(encodeURIComponent).join("/")}`,
      size: info.size,
      contentHash,
      type,
      mimeType: type,
      ...dimensions,
      createdAt: info.birthtime.toISOString(),
      modifiedAt: info.mtime.toISOString(),
      runId,
    });
  }
  return files.sort(compareGeneratedFiles);
}

async function findGeneratedImagesWithRecovery({ outputDir, outputRelativeDir, runId, startedAt, expectedCount }) {
  let files = await findGeneratedImages(outputDir, outputRelativeDir, runId);
  if (files.length >= normalizedExpectedCount(expectedCount)) return files;
  await recoverCodexHomeImages({ outputDir, startedAt, expectedCount, existingCount: files.length });
  files = await findGeneratedImages(outputDir, outputRelativeDir, runId);
  return files;
}

async function collectGeneratedImages({ outputDir, outputRelativeDir, runId, startedAt, expectedCount, input, references, providerLabel, imageBriefs }) {
  const before = await findGeneratedImages(outputDir, outputRelativeDir, runId);
  const discovered = before.length >= normalizedExpectedCount(expectedCount)
    ? before
    : await findGeneratedImagesWithRecovery({ outputDir, outputRelativeDir, runId, startedAt, expectedCount });
  const manifest = await readManifest(outputDir);
  const files = attachImageBriefs(selectExpectedFiles(discovered, manifest, normalizedExpectedCount(expectedCount)), imageBriefs);
  if (files.length === 0) return { files, manifest: undefined, fallbackCreated: false, importedFromCodexHome: 0 };
  if (manifest) return { files, manifest, fallbackCreated: false, importedFromCodexHome: Math.max(0, files.length - before.length) };
  const fallback = fallbackManifest({ files, runId, outputRelativeDir, input, references, providerLabel, imageBriefs });
  await writeFile(join(outputDir, "manifest.json"), JSON.stringify(fallback, null, 2));
  return { files, manifest: fallback, fallbackCreated: true, importedFromCodexHome: Math.max(0, files.length - before.length) };
}

async function ensureUniqueImageCollection({
  collection,
  input,
  outputDir,
  outputRelativeDir,
  runId,
  references,
  providerLabel,
  imageBriefs,
  invocation,
  timeoutMs,
  requestedImageCount,
  signal,
}) {
  const logs = [];
  let current = collection;
  const targetFiles = plannedImageFiles(requestedImageCount);

  for (let pass = 0; pass < 2; pass += 1) {
    if (signal?.aborted) return { ok: false, aborted: true, error: "이미지 생성 작업이 취소되었습니다.", collection: current, logs };
    const analysis = duplicateImageAnalysis(current.files);
    if (analysis.duplicates.length === 0 && analysis.uniqueFiles.length >= requestedImageCount) {
      return { ok: true, collection: current, logs };
    }

    if (analysis.duplicates.length > 0) {
      logs.push(logEntry(
        "warning",
        "duplicate image repair requested",
        `${requestedImageCount}개 요청 결과에서 중복 이미지 해시 ${analysis.duplicates.length}개를 발견했습니다. 중복 슬롯을 삭제하고 고유 이미지로 보충 생성합니다.`,
      ));
      await removeDuplicateImageFiles(outputDir, analysis.duplicates);
      current = await refreshImageCollection({ outputDir, outputRelativeDir, runId, input, references, providerLabel, imageBriefs, requestedImageCount });
    }

    const missingTargets = missingImageTargets(targetFiles, current.files);
    if (missingTargets.length === 0) continue;

    for (const target of missingTargets) {
      const repaired = await repairSingleImageSlot({
        target,
        input,
        outputDir,
        outputRelativeDir,
        runId,
        references,
        providerLabel,
        imageBriefs,
        invocation,
        timeoutMs,
        requestedImageCount,
        logs,
        signal,
      });
      current = repaired.collection;
      if (!repaired.ok) break;
    }

    current = await refreshImageCollection({ outputDir, outputRelativeDir, runId, input, references, providerLabel, imageBriefs, requestedImageCount });
  }

  const finalAnalysis = duplicateImageAnalysis(current.files);
  if (finalAnalysis.duplicates.length === 0 && finalAnalysis.uniqueFiles.length >= requestedImageCount) {
    return { ok: true, collection: current, logs };
  }
  return {
    ok: false,
    error: imageDuplicateMessage(requestedImageCount, finalAnalysis.uniqueFiles.length, finalAnalysis.duplicates),
    collection: current,
    logs,
  };
}

async function repairSingleImageSlot({
  target,
  input,
  outputDir,
  outputRelativeDir,
  runId,
  references,
  providerLabel,
  imageBriefs,
  invocation,
  timeoutMs,
  requestedImageCount,
  logs,
  signal,
}) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    if (signal?.aborted) return { ok: false, collection: await refreshImageCollection({ outputDir, outputRelativeDir, runId, input, references, providerLabel, imageBriefs, requestedImageCount }) };
    const before = await findGeneratedImages(outputDir, outputRelativeDir, runId);
    const prompt = composeDuplicateRepairPrompt(input, {
      outputDir,
      outputRelativeDir,
      references,
      imageCount: requestedImageCount,
      targetIndex: target.index,
      targetFilename: target.filename,
      existingFiles: before,
      imageBrief: imageBriefs[target.index - 1],
    });
    const expectedCount = Math.min(requestedImageCount, before.length + 1);
    const repairStartedAt = Date.now();
    const repair = await spawnImageInvocation({
      invocation,
      prompt,
      timeoutMs,
      providerLabel,
      outputDir,
      outputRelativeDir,
      runId,
      startedAt: repairStartedAt,
      expectedCount,
      referenceCount: references.length,
      logs: [
        logEntry(
          "warning",
          "duplicate image repair slot",
          `${target.filename} 중복 슬롯을 고유 이미지 1장으로 보충 생성합니다. attempt=${attempt}`,
        ),
      ],
      signal,
    });
    logs.push(...repair.logs);
    if (signal?.aborted || repair.aborted) return { ok: false, collection: await refreshImageCollection({ outputDir, outputRelativeDir, runId, input, references, providerLabel, imageBriefs, requestedImageCount }) };
    let current = await refreshImageCollection({ outputDir, outputRelativeDir, runId, input, references, providerLabel, imageBriefs, requestedImageCount });
    const analysis = duplicateImageAnalysis(current.files);
    if (analysis.duplicates.length > 0) {
      await removeDuplicateImageFiles(outputDir, analysis.duplicates);
      current = await refreshImageCollection({ outputDir, outputRelativeDir, runId, input, references, providerLabel, imageBriefs, requestedImageCount });
    }
    const refreshedAnalysis = duplicateImageAnalysis(current.files);
    const repairedFile = refreshedAnalysis.uniqueFiles.find((file) => file.filename === target.filename);
    if (repair.ok && repairedFile && refreshedAnalysis.duplicates.every((file) => file.filename !== target.filename)) {
      return { ok: true, collection: current };
    }
  }
  const collection = await refreshImageCollection({ outputDir, outputRelativeDir, runId, input, references, providerLabel, imageBriefs, requestedImageCount });
  return { ok: false, collection };
}

async function refreshImageCollection({ outputDir, outputRelativeDir, runId, input, references, providerLabel, imageBriefs, requestedImageCount }) {
  return collectGeneratedImages({
    outputDir,
    outputRelativeDir,
    runId,
    startedAt: Date.now(),
    expectedCount: requestedImageCount,
    input,
    references,
    providerLabel,
    imageBriefs,
  });
}

function duplicateImageAnalysis(files) {
  const seen = new Map();
  const uniqueFiles = [];
  const duplicates = [];
  for (const file of files) {
    if (!file.contentHash) {
      uniqueFiles.push(file);
      continue;
    }
    const original = seen.get(file.contentHash);
    if (original) {
      duplicates.push({ ...file, duplicateOf: original.filename });
      continue;
    }
    seen.set(file.contentHash, file);
    uniqueFiles.push(file);
  }
  return { uniqueFiles, duplicates };
}

async function removeDuplicateImageFiles(outputDir, duplicates) {
  for (const duplicate of duplicates) {
    await rm(join(outputDir, duplicate.filename), { force: true });
  }
}

function missingImageTargets(targetFiles, files) {
  const present = new Set(files.map((file) => file.filename));
  return targetFiles
    .map((filename, index) => ({ filename, index: index + 1 }))
    .filter((target) => !present.has(target.filename));
}

async function readManifest(outputDir) {
  try {
    return sanitizeManifest(JSON.parse(await readFile(join(outputDir, "manifest.json"), "utf8")));
  } catch (error) {
    return undefined;
  }
}

function selectExpectedFiles(files, manifest, expectedCount) {
  const limitCount = normalizedExpectedCount(expectedCount);
  const manifestOrder = manifestFileOrder(manifest);
  const byName = new Map(files.map((file) => [file.filename, file]));
  const ordered = [];
  for (const filename of manifestOrder) {
    const file = byName.get(filename);
    if (!file) continue;
    ordered.push(file);
    byName.delete(filename);
  }
  ordered.push(...[...byName.values()].sort(compareGeneratedFiles));
  return ordered.slice(0, limitCount);
}

function attachImageBriefs(files, imageBriefs = []) {
  return files.map((file, index) => {
    const brief = imageBriefs[index];
    if (!brief) return file;
    return {
      ...file,
      style: brief.style,
      purpose: brief.purpose,
      brief,
    };
  });
}

function manifestFileOrder(manifest) {
  if (!manifest || typeof manifest !== "object") return [];
  const rawFiles = Array.isArray(manifest.files) ? manifest.files : [];
  return rawFiles
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") return typeof item.filename === "string" ? item.filename : undefined;
      return undefined;
    })
    .filter(Boolean);
}

function compareGeneratedFiles(left, right) {
  return imageFileSortKey(left.filename).localeCompare(imageFileSortKey(right.filename));
}

function imageFileSortKey(filename) {
  if (/^product-main\.[a-z0-9]+$/iu.test(filename)) return "product-main-000";
  return filename.replace(/product-main-(\d+)\./u, (_, value) => `product-main-${value.padStart(3, "0")}.`);
}

async function hasManifest(outputDir) {
  try {
    await stat(join(outputDir, "manifest.json"));
    return true;
  } catch (error) {
    return false;
  }
}

function fallbackManifest({ files, runId, outputRelativeDir, input, references, providerLabel, imageBriefs = [] }) {
  return {
    provider: "codex-imagegen",
    providerLabel,
    fallback: true,
    reason: "manifest.json was missing; Store Maker recovered generated image files from the output directory or Codex generated_images fallback.",
    runId,
    outputDir: outputRelativeDir,
    createdAt: new Date().toISOString(),
    promptSummary: {
      productName: input.product.name,
      markets: input.markets,
      imageOptions: {
        imageCount: normalizedImageCount(input.imageGeneration),
        count: normalizedImageCount(input.imageGeneration),
        ratio: input.imageGeneration.ratio,
        style: input.imageGeneration.style,
        background: effectiveBackground(input.imageGeneration),
      },
      referenceCount: references.length,
    },
    requestedImageCount: normalizedImageCount(input.imageGeneration),
    generatedImageCount: files.length,
    imageBriefs,
    files: files.map(({ filename, relativePath, url, size, contentHash, type, mimeType, width, height, style, purpose, brief, createdAt, modifiedAt }) => ({
      filename,
      relativePath,
      url,
      size,
      ...(contentHash ? { contentHash } : {}),
      type,
      mimeType: mimeType ?? type,
      ...(Number.isSafeInteger(width) ? { width } : {}),
      ...(Number.isSafeInteger(height) ? { height } : {}),
      ...(style ? { style } : {}),
      ...(purpose ? { purpose } : {}),
      ...(brief ? { brief } : {}),
      createdAt,
      modifiedAt,
    })),
  };
}

function sanitizeManifest(value) {
  if (Array.isArray(value)) return value.map((item) => sanitizeManifest(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeManifest(item)]));
  }
  if (typeof value === "string" && looksLikeLocalPath(value)) return "[redacted-local-path]";
  return value;
}

function looksLikeLocalPath(value) {
  if (value.includes(ROOT)) return true;
  return /^\/(?:Users|private|var|tmp|Volumes)\//u.test(value) || /^[A-Za-z]:\\/u.test(value);
}

async function findImagePaths(rootDir) {
  const found = [];
  async function visit(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      return;
    }
    for (const entry of entries) {
      const absolutePath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (imageExtensions.has(extensionOf(entry.name))) found.push(absolutePath);
    }
  }
  await visit(rootDir);
  return found;
}

async function recoverCodexHomeImages({ outputDir, startedAt, expectedCount, existingCount = 0 }) {
  const candidates = [];
  const needed = Math.max(0, normalizedExpectedCount(expectedCount) - existingCount);
  if (needed === 0) return;
  for (const root of codexGeneratedImageRoots()) {
    const paths = await findImagePaths(root);
    for (const absolutePath of paths) {
      const info = await stat(absolutePath);
      if (info.size <= 0 || info.mtimeMs < startedAt) continue;
      candidates.push({ absolutePath, info });
    }
  }
  const selected = candidates
    .sort((a, b) => b.info.mtimeMs - a.info.mtimeMs)
    .slice(0, needed);
  for (let index = 0; index < selected.length; index += 1) {
    const ext = extensionOf(selected[index].absolutePath) || ".png";
    const imageIndex = existingCount + index + 1;
    const filename = imageIndex === 1 ? `product-main${ext}` : `product-main-${String(imageIndex).padStart(2, "0")}${ext}`;
    await copyFile(selected[index].absolutePath, join(outputDir, filename));
  }
}

function codexGeneratedImageRoots() {
  const roots = new Set();
  const codexHome = process.env.CODEX_HOME || join(homedir(), ".codex");
  roots.add(join(codexHome, "generated_images"));
  roots.add(join(codexHome, "generated-images"));
  return [...roots];
}

function imageFailure(message, error, logs) {
  const detail = error instanceof Error ? ` ${redactSensitive(error.message)}` : "";
  return { ok: false, error: `${message}${detail}`, logs: [...logs, logEntry("error", "image generation failed", `${message}${detail}`)] };
}

function imageCancelled(logs) {
  const message = "이미지 생성 작업이 취소되었습니다.";
  return {
    ok: false,
    aborted: true,
    error: message,
    logs: [...logs, logEntry("warning", "image generation cancelled", message)],
  };
}

function decodeDataUrl(value, expectedType) {
  const match = value.match(/^data:([^;,]+);base64,([a-z0-9+/=\s]+)$/iu);
  if (!match || match[1].toLowerCase() !== expectedType.toLowerCase()) return undefined;
  return Buffer.from(match[2].replace(/\s+/gu, ""), "base64");
}

function safeOutputName(name) {
  return basename(name).replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/gu, "") || "reference.png";
}

function parseCommandLine(value) {
  const parts = parseWords(value);
  const [command, ...args] = parts;
  return command ? { command, args } : undefined;
}

function parseWords(value) {
  return value.match(/"[^"]+"|'[^']+'|\S+/gu)?.map((part) => part.replace(/^["']|["']$/gu, "")) ?? [];
}

function ensureCodexExecArgs(args) {
  const { args: withoutApproval, approval } = extractOptionPair(args, "--ask-for-approval", "-a");
  const execIndex = withoutApproval.indexOf("exec");
  const globalArgs = approval ?? ["--ask-for-approval", "never"];
  if (execIndex >= 0) {
    return [...withoutApproval.slice(0, execIndex), ...globalArgs, "exec", ...withoutApproval.slice(execIndex + 1)];
  }
  return [...globalArgs, "exec", ...withoutApproval];
}

function ensureFlag(args, flag) {
  return args.includes(flag) ? args : [...args, flag];
}

function ensureOptionPair(args, option, value, alias) {
  if (hasOption(args, option, alias)) return args;
  return [...args, option, value];
}

function hasOption(args, ...options) {
  return options.filter(Boolean).some((option) => args.includes(option));
}

function withoutOption(args, option, alias) {
  const next = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === option || args[index] === alias) {
      index += 1;
      continue;
    }
    next.push(args[index]);
  }
  return next;
}

function extractOptionPair(args, option, alias) {
  const next = [];
  let pair;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === option || args[index] === alias) {
      pair = [args[index], args[index + 1] ?? "never"];
      index += 1;
      continue;
    }
    next.push(args[index]);
  }
  return { args: next, approval: pair };
}

async function outputDirectoryState(outputDir) {
  try {
    const entries = await readdir(outputDir, { withFileTypes: true });
    const imageCount = (await findImagePaths(outputDir)).length;
    const hasManifest = entries.some((entry) => entry.isFile() && entry.name === "manifest.json");
    return `${imageCount} image file(s), manifest=${hasManifest ? "present" : "missing"}`;
  } catch (error) {
    return "output directory를 읽을 수 없습니다";
  }
}

function hiddenArgIndexes(args) {
  const hidden = new Set([args.length - 1]);
  for (let index = 0; index < args.length - 1; index += 1) {
    if (hiddenValueOptions.has(args[index])) hidden.add(index + 1);
  }
  return hidden;
}

async function readInvocationOutput(invocation, stdout) {
  try {
    const output = await readFile(invocation.outputFile, "utf8");
    return limit(output.trim() ? output : stdout);
  } catch (error) {
    return limit(stdout);
  }
}

async function invocationDiagnostic({ invocation, stdout, stderr, prompt, referenceCount, outputRelativeDir, outputState }) {
  const lastMessage = await readInvocationOutput(invocation, "");
  const parts = [
    `진단: prompt 전달=stdin(${Buffer.byteLength(prompt, "utf8")} bytes)`,
    `image inputs=${referenceCount}`,
    `cwd=store-maker root`,
    `outputDir=${outputRelativeDir}`,
    `output directory 상태=${outputState}`,
  ];
  if (stdout.trim()) parts.push(`stdout=${summarize(stdout)}`);
  if (stderr.trim()) parts.push(`stderr=${summarize(stderr)}`);
  if (lastMessage.trim()) parts.push(`last-message=${summarize(lastMessage)}`);
  return parts.join("; ");
}

function processErrorMessage(error, providerLabel) {
  if (!(error instanceof Error)) return `${providerLabel} 실행 중 알 수 없는 오류가 발생했습니다.`;
  if ("code" in error && error.code === "ENOENT") return "Codex CLI 미설치: codex 명령을 찾을 수 없습니다.";
  if ("code" in error && error.code === "EACCES") return "Codex CLI 실행 권한이 없습니다. command 실행 권한을 확인하세요.";
  return redactSensitive(error.message);
}

function looksLikeAuthError(value) {
  return /auth|login|credential|unauthorized|forbidden|api key|api-key|token/i.test(value);
}

function limit(value) {
  return value.length > OUTPUT_LIMIT ? `${value.slice(0, OUTPUT_LIMIT)}\n[truncated]` : value;
}

function summarize(value) {
  return publicText(value.trim().replace(/\s+/gu, " ").slice(0, 800));
}

function publicText(value) {
  return redactSensitive(value);
}

function extensionOf(value) {
  const ext = `.${value.split(".").pop()?.toLowerCase() ?? ""}`;
  return imageExtensions.has(ext) ? ext : "";
}

async function readImageDimensions(absolutePath, ext) {
  if (ext !== ".png") return {};
  try {
    const buffer = await readFile(absolutePath);
    if (buffer.length < 24) return {};
    const signature = buffer.subarray(1, 4).toString("ascii");
    if (signature !== "PNG") return {};
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 ? { width, height } : {};
  } catch (error) {
    return {};
  }
}

async function imageContentHash(absolutePath) {
  const buffer = await readFile(absolutePath);
  return createHash("sha256").update(buffer).digest("hex");
}

function mimeType(ext) {
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

function normalizedImageCount(config) {
  return normalizedExpectedCount(config?.imageCount ?? config?.count);
}

function normalizedExpectedCount(value) {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? Math.max(minImageCount, Math.min(maxImageCount, value))
    : minImageCount;
}

function imageShortfallMessage(requestedCount, generatedCount, files) {
  const fileList = files.length
    ? files.map((file) => file.relativePath).join(", ")
    : "생성 파일 없음";
  return `Codex CLI ImageGen shortfall: ${requestedCount}개 요청, ${generatedCount}개 생성. 생성된 이미지 파일: ${fileList}. 요청 개수보다 적어 성공 처리하지 않았습니다.`;
}

function imageDuplicateMessage(requestedCount, uniqueCount, duplicates) {
  const duplicateList = duplicates.length
    ? duplicates.map((file) => `${file.filename}${file.duplicateOf ? `=${file.duplicateOf}` : ""}`).join(", ")
    : "중복 파일 없음";
  return `Codex CLI ImageGen duplicate output: ${requestedCount}개 요청, 고유 이미지 ${uniqueCount}개 확보. 중복 이미지 파일: ${duplicateList}. 중복 해시를 고유 이미지로 보충하지 못해 성공 처리하지 않았습니다.`;
}

function effectiveBackground(config) {
  return config.background === "사용자 지정" ? (config.customBackground ?? "사용자 지정") : config.background;
}
