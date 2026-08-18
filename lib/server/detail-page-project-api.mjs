import {
  createDetailPageDocument,
  DetailPageDocumentValidationError,
  normalizeDetailPageDocument,
  renderDetailPageDocument,
} from "./detail-page-document.mjs";
import {
  ProjectRevisionConflictError,
  ProjectStoreInvalidError,
  ProjectStoreWriteError,
} from "./detail-page-projects.mjs";

export function parseDetailPageProjectPath(pathname) {
  const match = pathname.match(/^\/api\/detail-page-projects\/([^/]+)$/u);
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch (error) {
    return undefined;
  }
}

export async function getDetailPageProjectResponse(id, dependencies) {
  try {
    const { job, project } = await ensureProject(id, dependencies);
    return successResponse(project, job);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function putDetailPageProjectResponse(id, body, dependencies) {
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

async function ensureProject(id, { jobs, projects }) {
  const job = await jobs.get(id);
  if (!job) throw new ProjectRequestError(404, "NOT_FOUND", "Generation job not found");
  if (job.status !== "completed") throw new ProjectRequestError(409, "JOB_NOT_COMPLETE", "Generation job is not complete");
  const generated = job.result?.result;
  if (generated?.generationMode === "ad-set") {
    throw new ProjectRequestError(422, "UNSUPPORTED_GENERATION_MODE", "Ad-set jobs do not have a detail page project");
  }
  let project = await projects.get(id);
  if (!project) {
    const document = generated?.detailPageDocument
      ? normalizeDetailPageDocument(generated.detailPageDocument)
      : createLegacyDocument(job);
    project = await projects.create(id, document);
  }
  return { job, project };
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
    .filter((image) => image?.source === "edited");
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
      assets: Array.isArray(generated.images?.files) ? generated.images.files : [],
    },
  };
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
