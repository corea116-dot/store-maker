import {
  createDetailPageDocument,
  DetailPageDocumentValidationError,
  normalizeDetailPageDocument,
  renderDetailPageDocument,
} from "./detail-page-document.mjs";
import {
  ProjectRevisionConflictError,
  ProjectRecoveryConflictError,
  ProjectStoreInvalidError,
  ProjectStoreWriteError,
} from "./detail-page-projects.mjs";
import { parseOutputImageUrl } from "./detail-page-schema.mjs";

const apiByDependencies = new WeakMap();

export function parseDetailPageProjectPath(pathname) {
  const match = pathname.match(/^\/api\/detail-page-projects\/([^/]+)$/u);
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch (error) {
    return undefined;
  }
}

export function parseDetailPageProjectRecoveryPath(pathname) {
  const match = pathname.match(/^\/api\/detail-page-projects\/([^/]+)\/recover$/u);
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch (error) {
    return undefined;
  }
}

export function createDetailPageProjectApi(dependencies) {
  const existing = apiByDependencies.get(dependencies);
  if (existing) return existing;
  const operationChains = new Map();
  const api = {
    get(id) {
      return exclusive(id, () => getProject(id, dependencies));
    },
    getExisting(id) {
      return exclusive(id, () => getExistingProject(id, dependencies));
    },
    put(id, body) {
      return exclusive(id, () => putProject(id, body, dependencies));
    },
    recover(id, body) {
      return exclusive(id, () => recoverProject(id, body, dependencies));
    },
    deleteJob(id, options = {}) {
      return exclusive(id, () => deleteJob(id, options, dependencies));
    },
  };
  apiByDependencies.set(dependencies, api);
  return api;

  function exclusive(id, operation) {
    const previous = operationChains.get(id) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    const settled = current.catch(() => {});
    operationChains.set(id, settled);
    void settled.finally(() => {
      if (operationChains.get(id) === settled) operationChains.delete(id);
    });
    return current;
  }
}

export async function getDetailPageProjectResponse(id, dependencies) {
  return createDetailPageProjectApi(dependencies).get(id);
}

export async function putDetailPageProjectResponse(id, body, dependencies) {
  return createDetailPageProjectApi(dependencies).put(id, body);
}

async function getProject(id, dependencies) {
  try {
    const { job, project } = await ensureProject(id, dependencies);
    return successResponse(project, job);
  } catch (error) {
    if (error instanceof ProjectStoreInvalidError) return recoveryResponse(id, dependencies);
    return errorResponse(error);
  }
}

async function getExistingProject(id, dependencies) {
  try {
    const job = await getCompletedDetailPageJob(id, dependencies.jobs);
    const project = await dependencies.projects.get(id);
    if (!project) throw new ProjectRequestError(404, "PROJECT_UNAVAILABLE", "상세페이지 프로젝트를 먼저 열어 주세요.");
    return successResponse(project, job);
  } catch (error) {
    return errorResponse(error);
  }
}

async function putProject(id, body, dependencies) {
  try {
    const input = objectValue(body);
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
      throw new DetailPageDocumentValidationError("expectedRevision must be a positive integer");
    }
    const { job } = await ensureProject(id, dependencies);
    const project = await dependencies.projects.save(id, input.expectedRevision, input.document);
    return successResponse(project, job);
  } catch (error) {
    return errorResponse(error);
  }
}

async function recoverProject(id, body, dependencies) {
  try {
    const input = objectValue(body);
    if (typeof input.expectedCorruptSha256 !== "string" || !/^[0-9a-f]{64}$/iu.test(input.expectedCorruptSha256)) {
      throw new DetailPageDocumentValidationError("expectedCorruptSha256 must be a SHA-256 fingerprint");
    }
    const job = await getCompletedDetailPageJob(id, dependencies.jobs);
    const document = job.result?.result?.detailPageDocument
      ? normalizeDetailPageDocument(job.result.result.detailPageDocument)
      : createLegacyDocument(job);
    const project = await dependencies.projects.recover(id, input.expectedCorruptSha256, document);
    return successResponse(project, job);
  } catch (error) {
    return errorResponse(error);
  }
}

async function deleteJob(id, options, { jobs, projects }) {
  const job = await jobs.get(id);
  if (!job) return { status: 404, payload: failure("NOT_FOUND", "Generation job not found") };
  if (!["completed", "failed", "cancelled"].includes(job.status)) {
    return {
      status: 409,
      payload: {
        ...failure("JOB_ACTIVE", "완료, 실패, 취소된 작업만 삭제할 수 있습니다."),
        job,
      },
    };
  }
  try {
    await projects.delete(id);
  } catch (error) {
    return {
      status: 500,
      payload: failure("PROJECT_DELETE_FAILED", error instanceof Error ? error.message : "Could not delete detail page project"),
    };
  }
  const deleted = await jobs.delete(id);
  if (deleted.status !== "deleted") {
    return { status: 404, payload: failure("NOT_FOUND", "Generation job not found") };
  }
  return {
    status: 200,
    payload: { ok: true, jobs: await jobs.list({ includeEphemeral: options.includeEphemeral === true }) },
  };
}

async function ensureProject(id, { jobs, projects }) {
  const job = await getCompletedDetailPageJob(id, jobs);
  const generated = job.result?.result;
  let project = await projects.get(id);
  if (!project) {
    const document = generated?.detailPageDocument
      ? normalizeDetailPageDocument(generated.detailPageDocument)
      : createLegacyDocument(job);
    project = await projects.create(id, document);
  }
  return { job, project };
}

async function getCompletedDetailPageJob(id, jobs) {
  const job = await jobs.get(id);
  if (!job) throw new ProjectRequestError(404, "NOT_FOUND", "Generation job not found");
  if (job.status !== "completed") throw new ProjectRequestError(409, "JOB_NOT_COMPLETE", "Generation job is not complete");
  if (job.result?.result?.generationMode === "ad-set") {
    throw new ProjectRequestError(422, "UNSUPPORTED_GENERATION_MODE", "Ad-set jobs do not have a detail page project");
  }
  return job;
}

async function recoveryResponse(id, dependencies) {
  try {
    const job = await getCompletedDetailPageJob(id, dependencies.jobs);
    const recovery = await dependencies.projects.getRecovery(id);
    if (!recovery) throw new ProjectRequestError(404, "PROJECT_UNAVAILABLE", "상세페이지 프로젝트를 찾을 수 없습니다.");
    const document = job.result?.result?.detailPageDocument
      ? normalizeDetailPageDocument(job.result.result.detailPageDocument)
      : createLegacyDocument(job);
    return {
      status: 409,
      payload: {
        ...failure("PROJECT_RECOVERY_REQUIRED", "저장된 상세페이지 편집본을 읽을 수 없습니다. 원본 생성 결과로 복구할 수 있습니다."),
        recovery: { expectedCorruptSha256: recovery.expectedCorruptSha256, document },
      },
    };
  } catch (error) {
    return errorResponse(error);
  }
}

function createLegacyDocument(job) {
  const payload = job.result;
  const result = payload?.result ?? {};
  const exported = payload?.exports?.json ?? {};
  const productName = exported.product?.name ?? job.title?.split(" · ")[0] ?? "상품";
  const markets = Array.isArray(exported.markets)
    ? exported.markets
    : Array.isArray(result.markets) ? result.markets.map((market) => market.market).filter(Boolean) : ["smartstore"];
  return createDetailPageDocument({
    title: result.title ?? `${productName} 상세페이지`,
    productName,
    markets,
    markdown: result.markdown ?? "",
    images: result.images,
  });
}

function successResponse(project, job) {
  const generationPayload = job.result ?? {};
  const generated = generationPayload.result ?? {};
  const rendered = renderDetailPageDocument(project.document, { images: generated.images });
  const baseJson = generationPayload.exports?.json ?? {};
  const editedImages = project.document.sections
    .map((section) => section.image)
    .filter((image) => image?.source === "edited" && isValidAsset(image));
  const assets = deduplicateAssets([
    ...(Array.isArray(generated.images?.files) ? generated.images.files : []),
    ...editedImages.map((image) => ({ ...image, purpose: image.alt })),
  ]);
  const json = {
    ...baseJson,
    editedImages,
    result: {
      ...(baseJson.result ?? generated),
      title: rendered.title,
      markdown: rendered.markdown,
      html: rendered.html,
      detailPageDocument: project.document,
      editedImages,
    },
    project,
  };
  return {
    status: 200,
    payload: {
      ok: true,
      project,
      preview: { title: rendered.title, html: rendered.html },
      exports: { markdown: rendered.markdown, html: rendered.html, json },
      assets,
      evidenceSources: evidenceSources(generationPayload),
    },
  };
}

function evidenceSources(generationPayload) {
  const attachments = generationPayload?.exports?.json?.product?.attachments;
  if (!Array.isArray(attachments)) return [];
  return attachments
    .map((attachment, index) => ({ attachment, index }))
    .filter(({ attachment }) => attachment?.role === "supporting-material" && typeof attachment.name === "string" && attachment.name.trim())
    .map(({ attachment, index }) => ({
      id: `supporting-material:${index}:${encodeURIComponent(attachment.name)}`,
      label: attachment.name,
      kind: attachment.kind === "document" ? "document" : "supporting-material",
    }));
}

function deduplicateAssets(assets) {
  const seen = new Set();
  return assets.filter((asset) => {
    if (!isValidAsset(asset) || seen.has(asset.url)) return false;
    seen.add(asset.url);
    return true;
  });
}

function isValidAsset(asset) {
  const value = objectValue(asset);
  if (typeof value.filename !== "string" || !value.filename.trim() || typeof value.url !== "string") return false;
  return Boolean(parseOutputImageUrl(value.url));
}

function errorResponse(error) {
  if (error instanceof ProjectRequestError) return { status: error.status, payload: failure(error.code, error.message) };
  if (error instanceof ProjectRevisionConflictError) {
    return {
      status: 409,
      payload: {
        ...failure("REVISION_CONFLICT", "A newer project revision is already saved"),
        currentRevision: error.currentProject.revision,
        project: error.currentProject,
      },
    };
  }
  if (error instanceof ProjectRecoveryConflictError) {
    return { status: 409, payload: failure("CORRUPT_PROJECT_CHANGED", "손상된 편집본이 변경되었습니다. 다시 확인해 주세요.") };
  }
  if (error instanceof DetailPageDocumentValidationError) {
    return { status: 422, payload: failure("INVALID_DETAIL_PAGE_DOCUMENT", error.message) };
  }
  if (error instanceof ProjectStoreInvalidError) {
    return { status: 500, payload: failure("PROJECT_STORE_INVALID", error.message) };
  }
  if (error instanceof ProjectStoreWriteError) {
    return { status: 500, payload: failure("PROJECT_STORE_WRITE_FAILED", error.message) };
  }
  throw error;
}

function failure(code, message) {
  return { ok: false, error: { code, message } };
}

function objectValue(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

class ProjectRequestError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
