import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { IMAGE_RUNS_DIR, IMAGE_UPLOADS_DIR } from "./config.mjs";
import { parseOutputImageUrl } from "./detail-page-schema.mjs";
import { runImageGeneration } from "./imagegen.mjs";
import { logEntry } from "./logs.mjs";
import { parseGenerationRequest } from "./prompt.mjs";
import { openContainedRegularFile } from "./safe-files.mjs";

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

  const source = await readGeneratedImageSource(edit.source, options);
  if (!source.ok) {
    const failure = editFailure(source.code ?? "VALIDATION_ERROR", source.error, source.logs);
    return source.httpStatus ? { ...failure, httpStatus: source.httpStatus } : failure;
  }

  const logs = [logEntry("info", "image edit requested", `${source.value.filename} 이미지를 reference로 추가 수정 1장을 요청했습니다.`)];
  let result;
  try {
    const editInput = buildEditGenerationInput(parsed.value, source.value, instruction);
    const generateImages = options.generateImages ?? runImageGeneration;
    const generation = await generateImages(editInput, { signal: options.signal });
    if (!generation.ok) {
      result = {
        ok: false,
        logs: [...logs, ...(generation.logs ?? [])],
        error: { code: "IMAGE_EDIT_FAILED", message: generation.error },
      };
    } else {
      const image = generation.images?.files?.[0];
      result = image
        ? {
          ok: true,
          image,
          images: generation.images,
          logs: [...logs, ...(generation.logs ?? []), logEntry("success", "image edit completed", `${image.filename} 수정본을 생성했습니다.`)],
        }
        : editFailure("IMAGE_EDIT_EMPTY", "개별 이미지 수정 실행은 끝났지만 수정본 이미지 파일을 찾지 못했습니다.", [...logs, ...(generation.logs ?? [])]);
    }
  } catch {
    result = {
      ...editFailure(
        "IMAGE_EDIT_FAILED",
        "개별 이미지 수정 실행 중 오류가 발생했습니다.",
        [...logs, logEntry("error", "image edit failed", "개별 이미지 수정 실행 중 예상하지 못한 오류가 발생했습니다.")],
      ),
      httpStatus: 500,
    };
  } finally {
    const cleanupError = await source.value.cleanup();
    if (cleanupError && result) {
      result.logs.push(logEntry("warning", "image edit source cleanup failed", "임시 참조 이미지 정리에 실패했습니다."));
    }
  }
  return result;
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

async function readGeneratedImageSource(value, options) {
  const source = readObject(value);
  const outputImage = outputImageReference(readString(source.url) ?? readString(source.relativePath));
  if (!outputImage.ok) return outputImage;
  const imageRunsRoot = resolve(options.imageRunsDirectory ?? IMAGE_RUNS_DIR);
  const absolutePath = resolve(imageRunsRoot, outputImage.value.relativePath);
  const extension = extname(outputImage.value.filename).toLowerCase();
  if (!imageExtensions.has(extension)) return { ok: false, error: "수정 대상은 png, jpg, jpeg, webp 이미지여야 합니다." };

  let opened;
  try {
    opened = await openContainedRegularFile(imageRunsRoot, absolutePath);
  } catch {
    return { ok: false, error: "수정 대상 이미지 파일을 찾지 못했습니다." };
  }

  let stagingDirectory;
  const removeDirectory = options.removeStagingDirectory ?? removeStagingDirectory;
  try {
    const uploadsRoot = resolve(options.imageUploadsDirectory ?? IMAGE_UPLOADS_DIR);
    await mkdir(uploadsRoot, { recursive: true });
    stagingDirectory = await mkdtemp(join(uploadsRoot, "edit-source-"));
    const snapshotPath = join(stagingDirectory, outputImage.value.filename);
    const writeSnapshot = options.writeSourceSnapshot ?? writeSourceSnapshot;
    await writeSnapshot(opened.handle, snapshotPath);
    return {
      ok: true,
      value: {
        filename: outputImage.value.filename,
        relativePath: outputImage.value.url.slice(1),
        absolutePath: snapshotPath,
        type: mimeType(extension),
        extension: extension.slice(1),
        size: opened.size,
        style: readString(source.style),
        purpose: readString(source.purpose),
        cleanup: async () => {
          try {
            await removeDirectory(stagingDirectory);
            return undefined;
          } catch (error) {
            return error;
          }
        },
      },
    };
  } catch {
    let cleanupError;
    if (stagingDirectory) {
      try {
        await removeDirectory(stagingDirectory);
      } catch (error) {
        cleanupError = error;
      }
    }
    return {
      ok: false,
      code: "IMAGE_EDIT_SOURCE_FAILED",
      httpStatus: 500,
      error: "수정 대상 이미지 준비에 실패했습니다.",
      logs: cleanupError
        ? [logEntry("warning", "image edit source cleanup failed", "부분 생성된 임시 참조 이미지 정리에 실패했습니다.")]
        : [],
    };
  } finally {
    await opened?.handle.close().catch(() => {});
  }
}

function writeSourceSnapshot(handle, snapshotPath) {
  return pipeline(
    handle.createReadStream({ autoClose: false }),
    createWriteStream(snapshotPath, { flags: "wx", mode: 0o600 }),
  );
}

function removeStagingDirectory(path) {
  return rm(path, { recursive: true, force: true });
}

function outputImageReference(value) {
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
  const parsed = parseOutputImageUrl(withSlash);
  return parsed
    ? { ok: true, value: parsed }
    : { ok: false, error: "수정 대상 이미지는 Store Maker output 이미지여야 합니다." };
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
