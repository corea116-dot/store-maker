import { stat } from "node:fs/promises";
import { basename, extname, resolve, sep } from "node:path";
import { IMAGE_RUNS_DIR, ROOT } from "./config.mjs";
import { runImageGeneration } from "./imagegen.mjs";
import { logEntry } from "./logs.mjs";
import { parseGenerationRequest } from "./prompt.mjs";

const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp"]);

export async function editGeneratedImage(body, options = {}) {
  const edit = readObject(body.imageEdit);
  const instruction = readString(edit.instruction);
  if (!instruction) return editFailure("VALIDATION_ERROR", "imageEdit.instruction is required");

  const parsed = parseGenerationRequest(body);
  if (!parsed.ok) return parsed;
  if (!parsed.value.imageGeneration.enabled) {
    return editFailure("IMAGEGEN_DISABLED", "개별 이미지 수정은 설정에서 Codex CLI ImageGen을 켠 뒤 사용할 수 있습니다.");
  }

  const source = await readGeneratedImageSource(edit.source);
  if (!source.ok) return editFailure("VALIDATION_ERROR", source.error);

  const editInput = buildEditGenerationInput(parsed.value, source.value, instruction);
  const logs = [logEntry("info", "image edit requested", `${source.value.filename} 이미지를 reference로 추가 수정 1장을 요청했습니다.`)];
  const generation = await runImageGeneration(editInput, { signal: options.signal });
  if (!generation.ok) {
    return {
      ok: false,
      logs: [...logs, ...(generation.logs ?? [])],
      error: { code: "IMAGE_EDIT_FAILED", message: generation.error },
    };
  }

  const image = generation.images?.files?.[0];
  if (!image) {
    return editFailure("IMAGE_EDIT_EMPTY", "개별 이미지 수정 실행은 끝났지만 수정본 이미지 파일을 찾지 못했습니다.", [...logs, ...(generation.logs ?? [])]);
  }

  return {
    ok: true,
    image,
    images: generation.images,
    logs: [...logs, ...(generation.logs ?? []), logEntry("success", "image edit completed", `${image.filename} 수정본을 생성했습니다.`)],
  };
}

function buildEditGenerationInput(input, source, instruction) {
  return {
    ...input,
    product: {
      ...input.product,
      requirements: `${input.product.requirements}\n개별 이미지 수정 요청: ${instruction}`,
      materials: [
        ...(input.product.materials ?? []),
        `수정 대상 이미지: ${source.filename}`,
        ...(source.purpose ? [`원본 목적: ${source.purpose}`] : []),
      ],
      attachments: [{
        name: source.filename,
        type: source.type,
        size: source.size,
        extension: source.extension,
        kind: "image",
        preview: true,
      }],
    },
    imageGeneration: {
      ...input.imageGeneration,
      imageCount: 1,
      count: 1,
      moodMode: "consistent",
      sameMoodCount: 1,
      variedMoodCount: 0,
      style: source.style ?? input.imageGeneration.style,
      useReference: true,
      editInstruction: instruction,
      sourceImageName: source.filename,
    },
    runtime: {
      imageAttachmentSources: [],
      imageReferenceFiles: [{
        name: source.filename,
        type: source.type,
        size: source.size,
        relativePath: source.relativePath,
        absolutePath: source.absolutePath,
      }],
    },
  };
}

async function readGeneratedImageSource(value) {
  const source = readObject(value);
  const publicPath = publicImagePath(readString(source.url) ?? readString(source.relativePath));
  if (!publicPath.ok) return publicPath;
  const absolutePath = resolve(ROOT, `.${publicPath.value}`);
  const imageRunsRoot = resolve(IMAGE_RUNS_DIR);
  if (!absolutePath.startsWith(`${imageRunsRoot}${sep}`)) return { ok: false, error: "수정 대상 이미지는 Store Maker output 이미지여야 합니다." };
  const extension = extname(absolutePath).toLowerCase();
  if (!imageExtensions.has(extension)) return { ok: false, error: "수정 대상은 png, jpg, jpeg, webp 이미지여야 합니다." };

  let info;
  try {
    info = await stat(absolutePath);
  } catch {
    return { ok: false, error: "수정 대상 이미지 파일을 찾지 못했습니다." };
  }
  if (!info.isFile()) return { ok: false, error: "수정 대상 이미지가 파일이 아닙니다." };

  return {
    ok: true,
    value: {
      filename: basename(absolutePath),
      relativePath: publicPath.value.slice(1),
      absolutePath,
      type: mimeType(extension),
      extension: extension.slice(1),
      size: info.size,
      style: readString(source.style),
      purpose: readString(source.purpose),
    },
  };
}

function publicImagePath(value) {
  if (!value) return { ok: false, error: "imageEdit.source.url is required" };
  let pathname = value;
  if (/^https?:\/\//iu.test(value)) {
    try {
      pathname = new URL(value).pathname;
    } catch (error) {
      return { ok: false, error: "수정 대상 이미지 URL이 올바르지 않습니다." };
    }
  }
  const withSlash = pathname.startsWith("/") ? pathname : `/${pathname}`;
  let decoded;
  try {
    decoded = decodeURIComponent(withSlash);
  } catch {
    return { ok: false, error: "수정 대상 이미지 URL을 해석할 수 없습니다." };
  }
  if (!decoded.startsWith("/outputs/image-runs/") || decoded.includes("..")) {
    return { ok: false, error: "수정 대상 이미지는 Store Maker output 이미지여야 합니다." };
  }
  return { ok: true, value: decoded };
}

function editFailure(code, message, logs = []) {
  return { ok: false, logs, error: { code, message } };
}

function mimeType(extension) {
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  return "application/octet-stream";
}

function readObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
