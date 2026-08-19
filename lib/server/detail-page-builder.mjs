import { randomUUID } from "node:crypto";
import { createDetailPageStarterSection, getCategoryTemplateDraft, normalizeDetailPageSectionKind } from "./detail-page-section-registry.mjs";
import { candidateEvidence, DetailPageBuilderRequestError, normalizeCandidatePatch, normalizeCandidateSection, parseBuilderRequest } from "./detail-page-builder-contract.mjs";
import { composeDetailPageCandidatePrompt } from "./detail-page-builder-prompt.mjs";

const DEFAULT_TTL_MS = 10 * 60 * 1000;

export function createDetailPageCandidateService(options = {}) {
  const getProject = options.getProject;
  const runEngine = options.runEngine;
  const candidateAssets = options.candidateAssets;
  const now = options.now ?? (() => new Date());
  const ttlMs = positiveInteger(options.ttlMs, DEFAULT_TTL_MS);
  const candidates = new Map();

  if (typeof getProject !== "function") throw new Error("Detail page candidate service requires getProject");

  return {
    start,
    get,
    cancel,
    regenerate,
    materialize,
    close,
  };

  async function start(projectId, body) {
    const project = await getRequiredProject(projectId);
    const request = parseBuilderRequest(body, project);
    const candidate = createCandidate(projectId, project.revision, request);
    const record = { candidate, controller: new AbortController(), timer: undefined };
    candidates.set(candidate.candidateId, record);
    record.timer = setTimeout(() => expire(record), ttlMs);
    if (request.operation === "template") {
      await prepareTemplate(record, request, project);
    } else if (request.operation === "add" && request.source === "registry") {
      await prepareDirectAdd(record, request, project);
    } else {
      void generate(record, request, project);
    }
    return snapshot(candidate);
  }

  async function get(projectId, candidateId) {
    const record = candidateFor(projectId, candidateId);
    await staleIfProjectChanged(record);
    return snapshot(record.candidate);
  }

  async function cancel(projectId, candidateId) {
    const record = candidateFor(projectId, candidateId);
    if (["running", "ready"].includes(record.candidate.status)) {
      record.controller.abort();
      record.candidate.status = "cancelled";
      record.candidate.error = undefined;
      await discardCandidateAssets(record);
    }
    clearTimeout(record.timer);
    return snapshot(record.candidate);
  }

  async function regenerate(projectId, candidateId, body = {}) {
    const previous = candidateFor(projectId, candidateId);
    await cancel(projectId, candidateId);
    const previousCandidate = previous.candidate;
    return start(projectId, {
      ...body,
      operation: previousCandidate.operation,
      sectionId: previousCandidate.targetSectionId,
      mode: previousCandidate.mode,
      afterSectionId: previousCandidate.afterSectionId,
    });
  }

  async function materialize(projectId, candidateId) {
    const record = candidateFor(projectId, candidateId);
    await staleIfProjectChanged(record);
    if (record.candidate.status !== "ready") {
      throw new DetailPageBuilderRequestError("CANDIDATE_NOT_APPLICABLE", "준비된 후보만 적용할 수 있습니다.");
    }
    if (!record.candidate.canApply) {
      throw new DetailPageBuilderRequestError("EVIDENCE_REQUIRED", "근거가 필요한 후보입니다. 확인 가능한 자료를 추가한 뒤 다시 생성해 주세요.");
    }
    if (record.candidate.materializedAt || record.candidate.stagedAssets.length === 0) return snapshot(record.candidate);
    if (!candidateAssets || typeof candidateAssets.materialize !== "function") {
      throw new DetailPageBuilderRequestError("CANDIDATE_ASSET_UNAVAILABLE", "후보 이미지 보관소를 사용할 수 없습니다.");
    }
    try {
      const imagesById = new Map();
      for (const staged of record.candidate.stagedAssets) {
        imagesById.set(staged.imageId, await candidateAssets.materialize(record.candidate.candidateId, staged.assetId));
      }
      record.candidate.proposedSections = record.candidate.proposedSections.map((section) => replaceMaterializedImage(section, imagesById));
      if (record.candidate.patch?.changes?.image) {
        record.candidate.patch = {
          ...record.candidate.patch,
          changes: {
            ...record.candidate.patch.changes,
            image: imagesById.get(record.candidate.patch.changes.image.id) ?? record.candidate.patch.changes.image,
          },
        };
      }
      record.candidate.stagedAssets = [];
      record.candidate.materializedAt = now().toISOString();
      await candidateAssets.discard(record.candidate.candidateId);
      return snapshot(record.candidate);
    } catch (error) {
      throw new DetailPageBuilderRequestError("CANDIDATE_ASSET_MATERIALIZE_FAILED", "후보 이미지를 적용 가능한 파일로 준비하지 못했습니다.");
    }
  }

  async function close() {
    for (const record of candidates.values()) {
      clearTimeout(record.timer);
      record.controller.abort();
      if (record.candidate.status === "running") record.candidate.status = "cancelled";
    }
    await Promise.all([...candidates.values()].map((record) => discardCandidateAssets(record)));
    candidates.clear();
    await candidateAssets?.close?.();
  }

  function createCandidate(projectId, baseRevision, request) {
    const timestamp = now().toISOString();
    const candidate = {
      candidateId: randomUUID(),
      requestToken: randomUUID(),
      projectId,
      baseRevision,
      operation: request.operation,
      mode: request.mode ?? null,
      targetSectionId: request.sectionId ?? null,
      afterSectionId: request.afterSectionId ?? null,
      status: "running",
      allowedFields: request.allowedFields ?? [],
      proposedSections: [],
      patch: undefined,
      evidence: { status: "not-applicable", refs: [], warnings: [] },
      canApply: false,
      stagedAssets: [],
      createdAt: timestamp,
      expiresAt: new Date(now().getTime() + ttlMs).toISOString(),
    };
    return candidate;
  }

  async function prepareTemplate(record, request, project) {
    const draft = getCategoryTemplateDraft(request.category, project.document.productName);
    const selected = request.selectedTemplateSectionIds.length > 0
      ? draft.sections.filter((section) => request.selectedTemplateSectionIds.includes(section.id))
      : draft.sections;
    if (selected.length === 0) return fail(record, "INVALID_BUILDER_REQUEST", "선택한 템플릿 섹션을 찾을 수 없습니다.");
    record.candidate.proposedSections = selected.map((section) => ({ ...section, id: `candidate-${randomUUID()}` }));
    await settle(record, candidateEvidence(record.candidate.proposedSections.map(({ kind }) => kind), request.evidenceRefs));
  }

  async function prepareDirectAdd(record, request, project) {
    const section = createDetailPageStarterSection(request.typeKey, {
      id: `candidate-${randomUUID()}`,
      productName: project.document.productName,
      source: "user",
    });
    record.candidate.proposedSections = [section];
    await settle(record, candidateEvidence([section.kind], request.evidenceRefs));
  }

  async function generate(record, request, project) {
    if (typeof runEngine !== "function") return fail(record, "ENGINE_UNAVAILABLE", "AI 후보 생성 엔진을 사용할 수 없습니다.");
    try {
      const prompt = composeDetailPageCandidatePrompt(request, project);
      const execution = await runEngine({ engine: request.engine, routing: { copy: "detail-page-builder" } }, prompt, { signal: record.controller.signal });
      if (!isCurrent(record) || record.candidate.status !== "running") return;
      if (record.controller.signal.aborted || execution?.aborted) return;
      if (!execution?.ok) return fail(record, "ENGINE_FAILED", execution?.error || "AI 후보 생성에 실패했습니다.");
      const output = parseJson(execution.output);
      if (request.operation === "regenerate") {
        const normalized = normalizeCandidatePatch(project, request.sectionId, request.mode, output);
        record.candidate.allowedFields = normalized.allowedFields;
        record.candidate.patch = { sectionId: request.sectionId, changes: normalized.patch };
        await settle(record, candidateEvidence([normalized.section.kind], request.evidenceRefs));
        return;
      }
      const typeKey = normalizeDetailPageSectionKind(output.type);
      if (!typeKey) throw new DetailPageBuilderRequestError("INVALID_CANDIDATE_OUTPUT", "AI 후보의 섹션 유형이 올바르지 않습니다.");
      const allowed = new Set(["type", "heading", "body", "bullets", "layout", "image"]);
      const unexpected = Object.keys(output).filter((key) => !allowed.has(key));
      if (unexpected.length) throw new DetailPageBuilderRequestError("INVALID_CANDIDATE_OUTPUT", `허용되지 않은 AI 후보 필드: ${unexpected.join(", ")}`);
      const section = normalizeCandidateSection(project, createDetailPageStarterSection(typeKey, {
        id: `candidate-${randomUUID()}`,
        productName: project.document.productName,
        source: "generated",
        heading: output.heading,
        body: output.body,
        bullets: output.bullets,
        layout: output.layout,
        image: output.image,
      }));
      record.candidate.proposedSections = [section];
      await settle(record, candidateEvidence([section.kind], request.evidenceRefs));
    } catch (error) {
      if (!isCurrent(record) || record.candidate.status !== "running") return;
      const code = error instanceof DetailPageBuilderRequestError ? error.code : "INVALID_CANDIDATE_OUTPUT";
      fail(record, code, error instanceof Error ? error.message : "AI 후보 응답을 처리할 수 없습니다.");
    }
  }

  async function staleIfProjectChanged(record) {
    if (!["running", "ready"].includes(record.candidate.status)) return;
    let project;
    try {
      project = await getRequiredProject(record.candidate.projectId);
    } catch (error) {
      record.controller.abort();
      record.candidate.status = "stale";
      await discardCandidateAssets(record);
      return;
    }
    const targetExists = !record.candidate.targetSectionId || record.candidate.operation === "add" || project.document.sections.some((section) => section.id === record.candidate.targetSectionId);
    if (project.revision !== record.candidate.baseRevision || !targetExists) {
      record.controller.abort();
      record.candidate.status = "stale";
      record.candidate.error = { code: "CANDIDATE_STALE", message: "프로젝트 또는 대상 섹션이 변경되어 후보를 다시 만들어야 합니다." };
      await discardCandidateAssets(record);
    }
  }

  function expire(record) {
    if (!isCurrent(record) || !["running", "ready"].includes(record.candidate.status)) return;
    record.controller.abort();
    record.candidate.status = "expired";
    record.candidate.error = { code: "CANDIDATE_EXPIRED", message: "후보 유효 시간이 끝났습니다. 다시 생성해 주세요." };
    void discardCandidateAssets(record);
  }

  async function settle(record, evidence) {
    try {
      await stageCandidateAssets(record);
    } catch (error) {
      fail(record, "CANDIDATE_ASSET_STAGE_FAILED", "후보 이미지를 안전하게 보관하지 못했습니다.");
      return;
    }
    record.candidate.status = "ready";
    record.candidate.evidence = evidence;
    record.candidate.canApply = evidence.status !== "needs-input";
  }

  function fail(record, code, message) {
    record.candidate.status = "failed";
    record.candidate.error = { code, message };
    record.candidate.canApply = false;
  }

  function candidateFor(projectId, candidateId) {
    const record = candidates.get(candidateId);
    if (!record || record.candidate.projectId !== projectId) {
      throw new DetailPageBuilderRequestError("CANDIDATE_NOT_FOUND", "상세페이지 후보를 찾을 수 없습니다.");
    }
    return record;
  }

  function isCurrent(record) {
    return candidates.get(record.candidate.candidateId) === record;
  }

  async function getRequiredProject(projectId) {
    const project = await getProject(projectId);
    if (!project) throw new DetailPageBuilderRequestError("PROJECT_UNAVAILABLE", "상세페이지 프로젝트를 찾을 수 없습니다.");
    return project;
  }

  async function stageCandidateAssets(record) {
    if (!candidateAssets || typeof candidateAssets.stage !== "function") return;
    const images = [
      ...record.candidate.proposedSections.map((section) => section.image),
      record.candidate.patch?.changes?.image,
    ].filter(Boolean);
    if (images.length === 0) return;
    const stagedAssets = [];
    try {
      for (const image of images) stagedAssets.push(await candidateAssets.stage(record.candidate.candidateId, image));
      record.candidate.stagedAssets = stagedAssets;
    } catch (error) {
      await candidateAssets.discard(record.candidate.candidateId).catch(() => {});
      record.candidate.stagedAssets = [];
      throw error;
    }
  }

  async function discardCandidateAssets(record) {
    record.candidate.stagedAssets = [];
    if (candidateAssets?.discard) await candidateAssets.discard(record.candidate.candidateId).catch(() => {});
  }
}

function replaceMaterializedImage(section, imagesById) {
  if (!section.image) return section;
  const image = imagesById.get(section.image.id);
  return image ? { ...section, image } : section;
}

function parseJson(value) {
  if (typeof value !== "string" || value.length > 100_000) throw new DetailPageBuilderRequestError("INVALID_CANDIDATE_OUTPUT", "AI 후보가 JSON 객체를 반환하지 않았습니다.");
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not-object");
    return parsed;
  } catch (error) {
    throw new DetailPageBuilderRequestError("INVALID_CANDIDATE_OUTPUT", "AI 후보는 JSON 객체만 반환해야 합니다.");
  }
}

function snapshot(candidate) {
  return structuredClone(candidate);
}

function positiveInteger(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
