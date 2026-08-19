import { createDetailPageCandidateService } from "./detail-page-builder.mjs";
import { DetailPageBuilderRequestError } from "./detail-page-builder-contract.mjs";
import { DETAIL_PAGE_SECTION_REGISTRY } from "./detail-page-section-registry.mjs";

export function parseDetailPageBuilderPath(pathname) {
  if (pathname === "/api/detail-page-builder/registry") return { kind: "registry" };
  const match = pathname.match(/^\/api\/detail-page-projects\/([^/]+)\/builder-candidates(?:\/([^/]+)(?:\/(regenerate))?)?$/u);
  if (!match) return undefined;
  try {
    return {
      kind: match[3] === "regenerate" ? "regenerate" : match[2] ? "candidate" : "collection",
      projectId: decodeURIComponent(match[1]),
      ...(match[2] ? { candidateId: decodeURIComponent(match[2]) } : {}),
    };
  } catch (error) {
    return undefined;
  }
}

export function createDetailPageBuilderApi({ detailPageApi, runEngine, now, ttlMs }) {
  if (!detailPageApi || typeof detailPageApi.get !== "function") {
    throw new Error("Detail page builder API requires the detail page project API");
  }
  const candidates = createDetailPageCandidateService({
    getProject: async (projectId) => {
      const result = await detailPageApi.get(projectId);
      if (result.status !== 200 || !result.payload?.project) throw new DetailPageBuilderProjectError(result);
      return result.payload.project;
    },
    runEngine,
    now,
    ttlMs,
  });

  return {
    registry,
    start: (projectId, body) => respond(() => candidates.start(projectId, body), 202),
    get: (projectId, candidateId) => respond(() => candidates.get(projectId, candidateId), 200),
    cancel: (projectId, candidateId) => respond(() => candidates.cancel(projectId, candidateId), 200),
    regenerate: (projectId, candidateId, body) => respond(() => candidates.regenerate(projectId, candidateId, body), 202),
    close: () => candidates.close(),
  };

  function registry() {
    return {
      status: 200,
      payload: {
        ok: true,
        sectionTypes: DETAIL_PAGE_SECTION_REGISTRY.map((type) => ({
          key: type.key,
          labelKo: type.labelKo,
          description: type.description,
          defaultLayout: type.defaultLayout,
          allowedLayouts: [...type.allowedLayouts],
          editableFields: [...type.editableFields],
          evidencePolicy: type.evidencePolicy,
        })),
        templateCategories: ["beauty", "fashion", "food", "electronics", "default"],
      },
    };
  }
}

async function respond(operation, status) {
  try {
    const candidate = await operation();
    return { status, payload: { ok: true, candidate } };
  } catch (error) {
    if (error instanceof DetailPageBuilderProjectError) return error.result;
    if (error instanceof DetailPageBuilderRequestError) {
      const statusCode = error.code === "CANDIDATE_NOT_FOUND" ? 404 : error.code === "PROJECT_UNAVAILABLE" ? 404 : 422;
      return { status: statusCode, payload: failure(error.code, error.message) };
    }
    throw error;
  }
}

function failure(code, message) {
  return { ok: false, error: { code, message } };
}

class DetailPageBuilderProjectError extends Error {
  constructor(result) {
    super(result?.payload?.error?.message ?? "Detail page project is unavailable");
    this.result = result?.status && result?.payload
      ? result
      : { status: 404, payload: failure("NOT_FOUND", "Detail page project is unavailable") };
  }
}
