import {
  acceptDetailPageBuilderCandidate,
  cancelDetailPageBuilderCandidate,
  createDetailPageBuilderCandidate,
  getDetailPageBuilderCandidate,
  getDetailPageBuilderRegistry,
  materializeDetailPageBuilderCandidate,
  regenerateDetailPageBuilderCandidate,
} from "./detail-page-builder-api.js";
import {
  candidateMatchesCurrentAuthority,
  createCandidateAuthority,
  createDetailPageBuilderState,
  detailPageBuilderReducer,
} from "./detail-page-builder-state.js";

const candidatePollDelayMs = 350;

export function createDetailPageBuilderController(options = {}) {
  let state = createDetailPageBuilderState();
  let requestVersion = 0;
  let pollTimer;
  let registryPromise;
  let lastRequest;

  return {
    get state() { return state; },
    loadRegistry,
    setCategory: (category) => reduce({ type: "set-category", category }),
    setPane: (pane) => reduce({ type: "set-pane", pane }),
    setLibraryOpen: (open) => reduce({ type: "set-library-open", open }),
    toggleProposal: (proposalId) => reduce({ type: "toggle-proposal", proposalId }),
    editProposal: (proposalId, changes) => reduce({ type: "edit-proposal", proposalId, changes }),
    editPatch: (changes) => reduce({ type: "edit-patch", changes }),
    startTemplate,
    startDirect,
    startInstruction,
    startRegenerate,
    retry,
    apply,
    discard,
    invalidate,
    refresh,
  };

  function reduce(action) {
    const previous = state;
    state = detailPageBuilderReducer(state, action);
    if (state !== previous) options.onStateChange?.(state);
    return state;
  }

  async function loadRegistry() {
    if (registryPromise) return registryPromise;
    registryPromise = getDetailPageBuilderRegistry()
      .then((payload) => {
        reduce({ type: "set-registry", registry: payload });
        return state.registry;
      })
      .catch(() => state.registry)
      .finally(() => { registryPromise = undefined; });
    return registryPromise;
  }

  function startTemplate(input = {}) {
    const category = input.category ?? state.category;
    return start({
      operation: "template",
      category,
      selectedTemplateSectionIds: input.selectedTemplateSectionIds ?? [],
      instruction: input.instruction ?? "",
      evidenceRefs: input.evidenceRefs ?? [],
    });
  }

  function startDirect(typeKey, optionsValue = {}) {
    return start({
      operation: "add",
      source: "registry",
      typeKey,
      afterSectionId: optionsValue.afterSectionId,
      evidenceRefs: optionsValue.evidenceRefs ?? [],
    });
  }

  function startInstruction(instruction, optionsValue = {}) {
    return start({
      operation: "add",
      source: "instruction",
      instruction,
      afterSectionId: optionsValue.afterSectionId,
      evidenceRefs: optionsValue.evidenceRefs ?? [],
    }, { requiresEngine: true });
  }

  function startRegenerate(sectionId, mode, instruction = "", optionsValue = {}) {
    return start({
      operation: "regenerate",
      sectionId,
      mode,
      instruction,
      evidenceRefs: optionsValue.evidenceRefs ?? [],
    }, { requiresEngine: true });
  }

  async function start(body, config = {}) {
    const context = currentContext();
    if (!context) return fail("상세페이지를 연 뒤 AI 후보를 만들 수 있습니다.");
    const engine = config.requiresEngine ? options.getEngine?.() : undefined;
    if (config.requiresEngine && !engine) return fail("AI 후보 생성에 사용할 엔진 설정을 찾을 수 없습니다.");
    const request = { ...body, ...(engine ? { engine } : {}) };
    const version = ++requestVersion;
    clearPoll();
    reduce({ type: "candidate-started", authority: { ...context } });
    try {
      const payload = await createDetailPageBuilderCandidate(context.projectId, request);
      if (version !== requestVersion || !sameContext(context, currentContext())) return "stale";
      const candidate = payload.candidate;
      const authority = createCandidateAuthority(candidate, context);
      if (!candidateMatchesCurrentAuthority(candidate, authority, context)) return "stale";
      lastRequest = request;
      reduce({ type: "candidate-received", candidate, authority });
      if (candidate.status === "running") schedulePoll(version);
      return candidate;
    } catch (error) {
      if (version !== requestVersion || !sameContext(context, currentContext())) return "stale";
      return fail(error?.message ?? "AI 후보를 만들지 못했습니다.");
    }
  }

  async function refresh() {
    const candidate = state.candidate;
    const authority = state.authority;
    const context = currentContext();
    if (!candidate || !authority || !candidateMatchesCurrentAuthority(candidate, authority, context)) return "stale";
    const version = requestVersion;
    try {
      const payload = await getDetailPageBuilderCandidate(context.projectId, candidate.candidateId);
      if (version !== requestVersion || !sameContext(context, currentContext())) return "stale";
      const next = payload.candidate;
      if (next.candidateId !== authority.candidateId || next.requestToken !== authority.requestToken || !candidateMatchesCurrentAuthority(next, authority, context)) return "stale";
      reduce({ type: "candidate-received", candidate: next, authority });
      if (next.status === "running") schedulePoll(version);
      return next;
    } catch (error) {
      if (version !== requestVersion || !sameContext(context, currentContext())) return "stale";
      return fail(error?.message ?? "AI 후보 상태를 확인하지 못했습니다.");
    }
  }

  async function retry(optionsValue = {}) {
    const candidate = state.candidate;
    const authority = state.authority;
    const context = currentContext();
    if (!candidate || !authority || !candidateMatchesCurrentAuthority(candidate, authority, context)) return "stale";
    const version = ++requestVersion;
    clearPoll();
    reduce({ type: "candidate-started", authority });
    try {
      const request = {
        ...(lastRequest ?? {}),
        ...(typeof optionsValue.instruction === "string" ? { instruction: optionsValue.instruction } : {}),
        ...(Array.isArray(optionsValue.evidenceRefs) ? { evidenceRefs: optionsValue.evidenceRefs } : {}),
      };
      const payload = await regenerateDetailPageBuilderCandidate(context.projectId, candidate.candidateId, request);
      if (version !== requestVersion || !sameContext(context, currentContext())) return "stale";
      const next = payload.candidate;
      const nextAuthority = createCandidateAuthority(next, context);
      if (!candidateMatchesCurrentAuthority(next, nextAuthority, context)) return "stale";
      reduce({ type: "candidate-received", candidate: next, authority: nextAuthority });
      if (next.status === "running") schedulePoll(version);
      return next;
    } catch (error) {
      if (version !== requestVersion || !sameContext(context, currentContext())) return "stale";
      return fail(error?.message ?? "AI 후보를 다시 만들지 못했습니다.");
    }
  }

  async function apply() {
    let candidate = state.candidate;
    let authority = state.authority;
    const context = currentContext();
    if (!candidate || !authority || !candidateMatchesCurrentAuthority(candidate, authority, context)) return fail("문서가 변경되어 이 후보를 적용할 수 없습니다. 다시 만들어 주세요.");
    const version = requestVersion;
    if ((candidateHasImages(candidate) && !candidate.materializedAt) || (Array.isArray(candidate.stagedAssets) && candidate.stagedAssets.length > 0)) {
      const selectedProposalIds = [...state.selectedProposalIds];
      reduce({ type: "candidate-materializing" });
      try {
        const payload = await materializeDetailPageBuilderCandidate(context.projectId, candidate.candidateId);
        if (version !== requestVersion || !sameContext(context, currentContext())) {
          void cancelDetailPageBuilderCandidate(context.projectId, candidate.candidateId).catch(() => {});
          return "stale";
        }
        candidate = payload.candidate;
        if (candidate.candidateId !== authority.candidateId || candidate.requestToken !== authority.requestToken || !candidateMatchesCurrentAuthority(candidate, authority, context)) {
          void cancelDetailPageBuilderCandidate(context.projectId, candidate.candidateId).catch(() => {});
          return "stale";
        }
        reduce({ type: "candidate-received", candidate, authority, selectedProposalIds });
      } catch (error) {
        if (version !== requestVersion || !sameContext(context, currentContext())) return "stale";
        return fail(error?.message ?? "후보 이미지를 적용 가능한 파일로 준비하지 못했습니다.");
      }
    }
    const result = await options.onApply?.(candidate, authority, [...state.selectedProposalIds]);
    if (!result?.ok) {
      void cancelDetailPageBuilderCandidate(context.projectId, candidate.candidateId).catch(() => {});
      return fail(result?.message ?? "후보를 문서에 적용하지 못했습니다.");
    }
    requestVersion += 1;
    clearPoll();
    try {
      await acceptDetailPageBuilderCandidate(context.projectId, candidate.candidateId);
      reduce({ type: "candidate-cleared", notice: "후보를 편집 문서에 적용하고 저장했습니다." });
    } catch (error) {
      void cancelDetailPageBuilderCandidate(context.projectId, candidate.candidateId).catch(() => {});
      reduce({ type: "candidate-cleared", notice: "후보를 문서에 저장했습니다. 이미지 정리 확인은 서버에서 안전하게 마무리합니다." });
    }
    return result;
  }

  function discard(notice = "후보를 닫았습니다.") {
    const candidate = state.candidate;
    const context = currentContext();
    requestVersion += 1;
    clearPoll();
    reduce({ type: "candidate-cleared", notice });
    if (candidate?.candidateId && context?.projectId === candidate.projectId && ["running", "ready"].includes(candidate.status)) {
      void cancelDetailPageBuilderCandidate(context.projectId, candidate.candidateId).catch(() => {});
    }
  }

  function candidateHasImages(candidate) {
    return [
      ...(candidate?.proposedSections ?? []).map((section) => section?.image),
      candidate?.patch?.changes?.image,
    ].some(Boolean);
  }

  function invalidate(notice = "문서가 변경되어 기존 AI 후보를 닫았습니다.") {
    if (!state.candidate) return;
    discard(notice);
  }

  function schedulePoll(version) {
    clearPoll();
    pollTimer = setTimeout(async () => {
      if (version !== requestVersion) return;
      const result = await refresh();
      if (result?.status === "running" && version === requestVersion) schedulePoll(version);
    }, candidatePollDelayMs);
  }

  function clearPoll() {
    clearTimeout(pollTimer);
    pollTimer = undefined;
  }

  function currentContext() {
    const context = options.getContext?.();
    if (!context?.projectId || !Number.isSafeInteger(context.revision) || !Number.isSafeInteger(context.sessionId) || !Number.isSafeInteger(context.documentVersion)) return undefined;
    return { projectId: context.projectId, revision: context.revision, sessionId: context.sessionId, documentVersion: context.documentVersion };
  }

  function fail(message) {
    reduce({ type: "candidate-failed", message });
    return { ok: false, message };
  }
}

function sameContext(left, right) {
  return Boolean(left && right)
    && left.projectId === right.projectId
    && left.revision === right.revision
    && left.sessionId === right.sessionId
    && left.documentVersion === right.documentVersion;
}
