import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { createDetailPageStarterSection, getCategoryTemplateDraft, normalizeDetailPageSectionKind } from "./detail-page-section-registry.mjs";
import { candidateEvidence, DetailPageBuilderRequestError, normalizeCandidatePatch, normalizeCandidateSection, parseBuilderRequest } from "./detail-page-builder-contract.mjs";
import { normalizeDetailPageDocument } from "./detail-page-document.mjs";
import { composeDetailPageCandidatePrompt } from "./detail-page-builder-prompt.mjs";

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const TERMINAL_RECORD_TTL_MS = 30 * 1000;
const CLEANUP_RETRY_MS = 1_000;
const MAX_CLEANUP_RETRY_MS = 60 * 1000;

export function createDetailPageCandidateService(options = {}) {
  const getProject = options.getProject;
  const runEngine = options.runEngine;
  const candidateAssets = options.candidateAssets;
  const now = options.now ?? (() => new Date());
  const ttlMs = positiveInteger(options.ttlMs, DEFAULT_TTL_MS);
  const terminalRecordTtlMs = positiveInteger(options.terminalRecordTtlMs, TERMINAL_RECORD_TTL_MS);
  const cleanupRetryMs = positiveInteger(options.cleanupRetryMs, CLEANUP_RETRY_MS);
  const candidates = new Map();

  if (typeof getProject !== "function") throw new Error("Detail page candidate service requires getProject");

  return {
    start,
    get,
    cancel,
    regenerate,
    materialize,
    accept,
    close,
  };

  async function start(projectId, body) {
    const project = await getRequiredProject(projectId);
    const request = parseBuilderRequest(body, project);
    const candidate = createCandidate(projectId, project.revision, request);
    const record = {
      candidate,
      controller: new AbortController(),
      timer: undefined,
      cleanupTimer: undefined,
      cleanupRetryTimer: undefined,
      materializedUrls: [],
      cleanupAttempts: 0,
      operation: Promise.resolve(),
      cancelRequested: false,
      baseDocument: structuredClone(project.document),
    };
    candidates.set(candidate.candidateId, record);
    record.timer = setTimeout(() => expire(record), ttlMs);
    if (request.operation === "template") {
      await runExclusive(record, () => prepareTemplate(record, request, project));
    } else if (request.operation === "add" && request.source === "registry") {
      await runExclusive(record, () => prepareDirectAdd(record, request, project));
    } else {
      void generate(record, request, project);
    }
    return snapshot(candidate);
  }

  async function get(projectId, candidateId) {
    const record = candidateFor(projectId, candidateId);
    return runExclusive(record, async () => {
      await staleIfProjectChanged(record);
      return snapshot(record.candidate);
    });
  }

  async function cancel(projectId, candidateId) {
    const record = candidateFor(projectId, candidateId);
    record.cancelRequested = true;
    record.controller.abort();
    return runExclusive(record, () => cancelRecord(record));
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
    return runExclusive(record, async () => {
      await staleIfProjectChanged(record);
      await rejectIfCancellationRequested(record);
      if (record.candidate.status !== "ready") {
        throw new DetailPageBuilderRequestError("CANDIDATE_NOT_APPLICABLE", "준비된 후보만 적용할 수 있습니다.");
      }
      if (!record.candidate.canApply) {
        throw new DetailPageBuilderRequestError("EVIDENCE_REQUIRED", "근거가 필요한 후보입니다. 확인 가능한 자료를 추가한 뒤 다시 생성해 주세요.");
      }
      if (record.candidate.materializedAt) return snapshot(record.candidate);
      if (record.candidate.stagedAssets.length === 0) {
        if (candidateImages(record.candidate).length === 0) return snapshot(record.candidate);
        await fail(record, "CANDIDATE_ASSET_UNAVAILABLE", "후보 이미지를 안전하게 보관하지 못했습니다.");
        throw new DetailPageBuilderRequestError("CANDIDATE_ASSET_UNAVAILABLE", "후보 이미지 보관소를 사용할 수 없습니다.");
      }
      if (!candidateAssets || typeof candidateAssets.materialize !== "function") {
        await fail(record, "CANDIDATE_ASSET_UNAVAILABLE", "후보 이미지 보관소를 사용할 수 없습니다.");
        throw new DetailPageBuilderRequestError("CANDIDATE_ASSET_UNAVAILABLE", "후보 이미지 보관소를 사용할 수 없습니다.");
      }
      try {
        const imagesById = new Map();
        for (const staged of record.candidate.stagedAssets) {
          const image = await candidateAssets.materialize(record.candidate.candidateId, staged.assetId);
          imagesById.set(staged.imageId, image);
          if (image?.url) record.materializedUrls.push(image.url);
          await rejectIfCancellationRequested(record);
        }
        const proposedSections = record.candidate.proposedSections.map((section) => replaceMaterializedImage(section, imagesById));
        const patch = record.candidate.patch?.changes?.image
          ? {
            ...record.candidate.patch,
            changes: {
              ...record.candidate.patch.changes,
              image: imagesById.get(record.candidate.patch.changes.image.id) ?? record.candidate.patch.changes.image,
            },
          }
          : record.candidate.patch;
        record.candidate.proposedSections = proposedSections;
        record.candidate.patch = patch;
        record.candidate.stagedAssets = [];
        record.candidate.materializedAt = now().toISOString();
        await candidateAssets.discardStaged?.(record.candidate.candidateId);
        await rejectIfCancellationRequested(record);
        return snapshot(record.candidate);
      } catch (error) {
        if (record.cancelRequested || record.closing) {
          await cancelRecord(record);
          throw new DetailPageBuilderRequestError("CANDIDATE_NOT_APPLICABLE", "취소된 후보는 적용할 수 없습니다.");
        }
        await fail(record, "CANDIDATE_ASSET_MATERIALIZE_FAILED", "후보 이미지를 적용 가능한 파일로 준비하지 못했습니다.");
        throw new DetailPageBuilderRequestError("CANDIDATE_ASSET_MATERIALIZE_FAILED", "후보 이미지를 적용 가능한 파일로 준비하지 못했습니다.");
      }
    });
  }

  async function accept(projectId, candidateId, body = {}) {
    const record = candidateFor(projectId, candidateId);
    return runExclusive(record, async () => {
      if (record.cancelRequested || record.closing || record.candidate.status !== "ready") {
        throw new DetailPageBuilderRequestError("CANDIDATE_NOT_APPLICABLE", "준비된 후보만 저장 완료로 확인할 수 있습니다.");
      }
      if (!record.candidate.canApply) {
        throw new DetailPageBuilderRequestError("EVIDENCE_REQUIRED", "근거가 필요한 후보입니다. 확인 가능한 자료를 추가한 뒤 다시 생성해 주세요.");
      }
      if (candidateImages(record.candidate).length > 0 && !record.candidate.materializedAt) {
        throw new DetailPageBuilderRequestError("CANDIDATE_ASSETS_NOT_MATERIALIZED", "후보 이미지를 먼저 적용 가능한 파일로 준비해야 합니다.");
      }
      const project = await getRequiredProject(projectId);
      if (project.revision !== record.candidate.baseRevision + 1) {
        throw new DetailPageBuilderRequestError("CANDIDATE_NOT_APPLIED", "후보를 적용한 편집본을 한 번 저장한 뒤 완료로 확인해 주세요.");
      }
      assertReceiptMatchesSavedDocument(record, body?.receipt, project);
      if (record.materializedUrls.length > 0 && !record.materializedUrls.every((url) => documentContainsImage(project.document, url))) {
        throw new DetailPageBuilderRequestError("CANDIDATE_NOT_APPLIED", "후보 이미지를 포함한 편집본이 아직 저장되지 않았습니다.");
      }
      record.candidate.status = "accepted";
      record.candidate.error = undefined;
      clearTimeout(record.timer);
      const cleaned = await discardCandidateAssets(record);
      if (cleaned) scheduleTerminalCleanup(record);
      return snapshot(record.candidate);
    });
  }

  async function close() {
    const records = [...candidates.values()];
    for (const record of records) {
      clearTimeout(record.timer);
      clearTimeout(record.cleanupTimer);
      clearTimeout(record.cleanupRetryTimer);
      record.closing = true;
      record.cancelRequested = true;
      record.controller.abort();
    }
    await Promise.all(records.map((record) => runExclusive(record, async () => {
      if (["running", "ready"].includes(record.candidate.status)) {
        record.candidate.status = "cancelled";
        record.candidate.error = undefined;
        record.candidate.canApply = false;
      }
      hideMaterializedCandidate(record);
      await discardCandidateAssets(record);
    })));
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
      cleanup: { status: "not-needed", attempts: 0 },
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
    await settle(record, candidateEvidence(record.candidate.proposedSections.map(({ kind }) => kind), request.evidenceRefs, project.evidenceSources));
  }

  async function prepareDirectAdd(record, request, project) {
    const section = createDetailPageStarterSection(request.typeKey, {
      id: `candidate-${randomUUID()}`,
      productName: project.document.productName,
      source: "user",
    });
    record.candidate.proposedSections = [section];
    await settle(record, candidateEvidence([section.kind], request.evidenceRefs, project.evidenceSources));
  }

  async function generate(record, request, project) {
    if (typeof runEngine !== "function") {
      await runExclusive(record, () => fail(record, "ENGINE_UNAVAILABLE", "AI 후보 생성 엔진을 사용할 수 없습니다."));
      return;
    }
    try {
      const prompt = composeDetailPageCandidatePrompt(request, project);
      const execution = await runEngine({ engine: request.engine, routing: { copy: "detail-page-builder" } }, prompt, { signal: record.controller.signal });
      await runExclusive(record, async () => {
        if (!isCurrent(record) || record.candidate.status !== "running" || record.controller.signal.aborted || execution?.aborted || record.cancelRequested || record.closing) return;
        if (!execution?.ok) {
          await fail(record, "ENGINE_FAILED", execution?.error || "AI 후보 생성에 실패했습니다.");
          return;
        }
        try {
          const output = parseJson(execution.output);
          if (request.operation === "regenerate") {
            const normalized = normalizeCandidatePatch(project, request.sectionId, request.mode, output);
            record.candidate.allowedFields = normalized.allowedFields;
            record.candidate.patch = { sectionId: request.sectionId, changes: normalized.patch };
            await settle(record, candidateEvidence([normalized.section.kind], request.evidenceRefs, project.evidenceSources));
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
          await settle(record, candidateEvidence([section.kind], request.evidenceRefs, project.evidenceSources));
        } catch (error) {
          const code = error instanceof DetailPageBuilderRequestError ? error.code : "INVALID_CANDIDATE_OUTPUT";
          await fail(record, code, error instanceof Error ? error.message : "AI 후보 응답을 처리할 수 없습니다.");
        }
      });
    } catch (error) {
      await runExclusive(record, async () => {
        if (!isCurrent(record) || record.candidate.status !== "running" || record.cancelRequested || record.closing) return;
        const code = error instanceof DetailPageBuilderRequestError ? error.code : "INVALID_CANDIDATE_OUTPUT";
        await fail(record, code, error instanceof Error ? error.message : "AI 후보 응답을 처리할 수 없습니다.");
      });
    }
  }

  async function staleIfProjectChanged(record) {
    if (!["running", "ready"].includes(record.candidate.status) || record.cancelRequested || record.closing) return;
    let project;
    try {
      project = await getRequiredProject(record.candidate.projectId);
    } catch (error) {
      await finishTerminal(record, "stale", { code: "CANDIDATE_STALE", message: "프로젝트를 확인할 수 없어 후보를 다시 만들어야 합니다." });
      return;
    }
    const targetExists = !record.candidate.targetSectionId || record.candidate.operation === "add" || project.document.sections.some((section) => section.id === record.candidate.targetSectionId);
    if (project.revision !== record.candidate.baseRevision || !targetExists) {
      await finishTerminal(record, "stale", { code: "CANDIDATE_STALE", message: "프로젝트 또는 대상 섹션이 변경되어 후보를 다시 만들어야 합니다." });
    }
  }

  function expire(record) {
    void runExclusive(record, () => expireRecord(record)).catch(() => {});
  }

  async function expireRecord(record) {
    if (!isCurrent(record) || !["running", "ready"].includes(record.candidate.status)) return;
    await finishTerminal(record, "expired", { code: "CANDIDATE_EXPIRED", message: "후보 유효 시간이 끝났습니다. 다시 생성해 주세요." });
  }

  async function settle(record, evidence) {
    try {
      await stageCandidateAssets(record);
    } catch (error) {
      await fail(record, "CANDIDATE_ASSET_STAGE_FAILED", "후보 이미지를 안전하게 보관하지 못했습니다.");
      return;
    }
    if (!isCurrent(record) || record.candidate.status !== "running" || record.cancelRequested || record.closing) return;
    record.candidate.status = "ready";
    record.candidate.evidence = evidence;
    record.candidate.canApply = evidence.status !== "needs-input";
  }

  async function fail(record, code, message) {
    await finishTerminal(record, "failed", { code, message });
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

  function runExclusive(record, operation) {
    const previous = record.operation ?? Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    record.operation = current.catch(() => {});
    return current;
  }

  async function cancelRecord(record) {
    clearTimeout(record.timer);
    if (["running", "ready"].includes(record.candidate.status)) {
      await finishTerminal(record, "cancelled", undefined);
    }
    return snapshot(record.candidate);
  }

  async function rejectIfCancellationRequested(record) {
    if (!record.cancelRequested && !record.closing) return;
    await cancelRecord(record);
    throw new DetailPageBuilderRequestError("CANDIDATE_NOT_APPLICABLE", "취소된 후보는 적용할 수 없습니다.");
  }

  async function finishTerminal(record, status, error) {
    record.controller.abort();
    record.candidate.status = status;
    record.candidate.error = error;
    record.candidate.canApply = false;
    hideMaterializedCandidate(record);
    const cleaned = await discardCandidateAssets(record);
    if (cleaned) scheduleTerminalCleanup(record);
  }

  function hideMaterializedCandidate(record) {
    const urls = new Set(record.materializedUrls);
    if (urls.size > 0) {
      record.candidate.proposedSections = record.candidate.proposedSections.map((section) => (
        urls.has(section.image?.url) ? { ...section, image: undefined } : section
      ));
      if (record.candidate.patch?.changes?.image && urls.has(record.candidate.patch.changes.image.url)) {
        const changes = { ...record.candidate.patch.changes };
        delete changes.image;
        record.candidate.patch = { ...record.candidate.patch, changes };
      }
    }
    delete record.candidate.materializedAt;
  }

  async function getRequiredProject(projectId) {
    const project = await getProject(projectId);
    if (!project) throw new DetailPageBuilderRequestError("PROJECT_UNAVAILABLE", "상세페이지 프로젝트를 찾을 수 없습니다.");
    return project;
  }

  async function stageCandidateAssets(record) {
    const images = candidateImages(record.candidate);
    if (images.length === 0) return;
    if (!candidateAssets || typeof candidateAssets.stage !== "function") {
      throw new DetailPageBuilderRequestError("CANDIDATE_ASSET_UNAVAILABLE", "후보 이미지 보관소를 사용할 수 없습니다.");
    }
    const stagedAssets = [];
    try {
      for (const image of images) stagedAssets.push(await candidateAssets.stage(record.candidate.candidateId, image));
      record.candidate.stagedAssets = stagedAssets;
    } catch (error) {
      record.candidate.stagedAssets = [];
      throw error;
    }
  }

  async function discardCandidateAssets(record) {
    record.candidate.stagedAssets = [];
    if (!candidateAssets) {
      completeCleanup(record);
      return true;
    }
    try {
      if (record.materializedUrls.length > 0) {
        const project = await getProject(record.candidate.projectId);
        if (project && record.materializedUrls.some((url) => documentContainsImage(project.document, url))) {
          if (typeof candidateAssets.release !== "function") throw new Error("Candidate assets cannot be released safely");
          await candidateAssets.release(record.candidate.candidateId);
          completeCleanup(record);
          return true;
        }
      }
      if (typeof candidateAssets.discard !== "function") throw new Error("Candidate assets cannot be discarded safely");
      await candidateAssets.discard(record.candidate.candidateId);
      completeCleanup(record);
      return true;
    } catch (error) {
      markCleanupFailure(record, error);
      return false;
    }
  }

  function scheduleTerminalCleanup(record) {
    clearTimeout(record.cleanupTimer);
    record.cleanupTimer = setTimeout(() => {
      if (!isCurrent(record) || ["running", "ready"].includes(record.candidate.status)) return;
      candidates.delete(record.candidate.candidateId);
    }, terminalRecordTtlMs);
  }

  function completeCleanup(record) {
    clearTimeout(record.cleanupRetryTimer);
    record.cleanupRetryTimer = undefined;
    record.materializedUrls = [];
    record.candidate.cleanup = { status: "complete", attempts: record.cleanupAttempts };
  }

  function markCleanupFailure(record, error) {
    if (record.closing) return;
    record.cleanupAttempts += 1;
    record.candidate.cleanup = {
      status: "pending",
      attempts: record.cleanupAttempts,
      message: error instanceof Error ? error.message : "후보 이미지 정리에 실패했습니다.",
    };
    clearTimeout(record.cleanupTimer);
    clearTimeout(record.cleanupRetryTimer);
    record.cleanupRetryTimer = setTimeout(() => {
      void runExclusive(record, async () => {
        if (!isCurrent(record) || record.candidate.cleanup?.status !== "pending") return;
        const cleaned = await discardCandidateAssets(record);
        if (cleaned) scheduleTerminalCleanup(record);
      }).catch(() => {});
    }, cleanupRetryDelay(record.cleanupAttempts, cleanupRetryMs));
  }
}

const RECEIPT_EDITABLE_FIELDS = ["heading", "body", "bullets", "layout"];

function assertReceiptMatchesSavedDocument(record, receipt, project) {
  const expectedDocument = documentFromReceipt(record, receipt, project.revision);
  if (!isDeepStrictEqual(project.document, expectedDocument)) {
    throw new DetailPageBuilderRequestError("CANDIDATE_NOT_APPLIED", "후보 적용 영수증과 저장된 상세페이지가 일치하지 않습니다.");
  }
}

function documentFromReceipt(record, receipt, savedRevision) {
  const candidate = record.candidate;
  if (!isRecord(receipt)
    || receipt.version !== 1
    || receipt.candidateId !== candidate.candidateId
    || receipt.requestToken !== candidate.requestToken
    || receipt.baseRevision !== candidate.baseRevision
    || receipt.savedRevision !== savedRevision
    || receipt.operation !== candidate.operation
    || !isRecord(receipt.application)) {
    throw invalidReceipt();
  }
  const document = candidate.operation === "regenerate"
    ? patchDocumentFromReceipt(record.baseDocument, candidate, receipt.application)
    : insertDocumentFromReceipt(record.baseDocument, candidate, receipt.application);
  try {
    return normalizeDetailPageDocument(document);
  } catch (error) {
    throw invalidReceipt();
  }
}

function insertDocumentFromReceipt(baseDocument, candidate, application) {
  if (application.type !== "insert" || !Array.isArray(application.proposals)
    || application.proposals.length === 0 || application.proposals.length > candidate.proposedSections.length) {
    throw invalidReceipt();
  }
  const proposalsById = new Map(candidate.proposedSections.map((section, index) => [section.id, { section, index }]));
  const usedSectionIds = new Set(baseDocument.sections.map((section) => section.id));
  const accepted = [];
  let previousIndex = -1;
  for (const receiptProposal of application.proposals) {
    if (!isRecord(receiptProposal) || !validReceiptSectionId(receiptProposal.sectionId) || usedSectionIds.has(receiptProposal.sectionId)) {
      throw invalidReceipt();
    }
    const proposal = proposalsById.get(receiptProposal.proposalId);
    if (!proposal || proposal.index <= previousIndex || !hasExactKeys(receiptProposal.editable, RECEIPT_EDITABLE_FIELDS)) {
      throw invalidReceipt();
    }
    previousIndex = proposal.index;
    usedSectionIds.add(receiptProposal.sectionId);
    const section = acceptedReceiptSection(proposal.section, receiptProposal.sectionId);
    for (const field of RECEIPT_EDITABLE_FIELDS) section[field] = structuredClone(receiptProposal.editable[field]);
    accepted.push(section);
  }
  const afterIndex = baseDocument.sections.findIndex((section) => section.id === candidate.afterSectionId);
  if (candidate.afterSectionId && afterIndex < 0) throw invalidReceipt();
  const sections = structuredClone(baseDocument.sections);
  sections.splice(afterIndex < 0 ? sections.length : afterIndex + 1, 0, ...accepted);
  return { ...structuredClone(baseDocument), schemaVersion: 2, sections };
}

function patchDocumentFromReceipt(baseDocument, candidate, application) {
  const targetSectionId = candidate.targetSectionId ?? candidate.patch?.sectionId;
  const expectedChanges = candidate.patch?.changes;
  if (application.type !== "patch" || application.sectionId !== targetSectionId || !isRecord(expectedChanges)
    || !hasExactKeys(application.changes, Object.keys(expectedChanges))) {
    throw invalidReceipt();
  }
  const allowedFields = new Set(candidate.allowedFields);
  if (Object.keys(expectedChanges).some((field) => PROTECTED_RECEIPT_FIELDS.has(field) || !allowedFields.has(field))) {
    throw invalidReceipt();
  }
  const targetIndex = baseDocument.sections.findIndex((section) => section.id === targetSectionId);
  if (targetIndex < 0) throw invalidReceipt();
  const sections = structuredClone(baseDocument.sections);
  sections[targetIndex] = { ...sections[targetIndex] };
  for (const field of Object.keys(expectedChanges)) sections[targetIndex][field] = structuredClone(application.changes[field]);
  return { ...structuredClone(baseDocument), schemaVersion: 2, sections };
}

function acceptedReceiptSection(proposal, sectionId) {
  const section = structuredClone(proposal);
  section.id = sectionId;
  if (section.image && typeof section.image === "object") section.image = { ...section.image, id: `image-${sectionId}` };
  return section;
}

function validReceiptSectionId(value) {
  return typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 120;
}

function hasExactKeys(value, keys) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function invalidReceipt() {
  return new DetailPageBuilderRequestError("INVALID_CANDIDATE_RECEIPT", "후보 적용 영수증을 확인할 수 없습니다.");
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const PROTECTED_RECEIPT_FIELDS = new Set(["id", "visible", "source"]);

function documentContainsImage(document, url) {
  return document?.sections?.some((section) => section.image?.url === url) ?? false;
}

function replaceMaterializedImage(section, imagesById) {
  if (!section.image) return section;
  const image = imagesById.get(section.image.id);
  return image ? { ...section, image } : section;
}

function candidateImages(candidate) {
  return [
    ...candidate.proposedSections.map((section) => section.image),
    candidate.patch?.changes?.image,
  ].filter(Boolean);
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

function cleanupRetryDelay(attempts, baseDelayMs) {
  return Math.min(baseDelayMs * (2 ** Math.min(Math.max(attempts - 1, 0), 6)), MAX_CLEANUP_RETRY_MS);
}
