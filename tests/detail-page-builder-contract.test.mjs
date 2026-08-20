import assert from "node:assert/strict";
import test from "node:test";

import { applyCandidateToDocument } from "../assets/detail-page-builder-state.js";
import { createDetailPageCandidateService } from "../lib/server/detail-page-builder.mjs";
import { createDetailPageCandidatePromptInput } from "../lib/server/detail-page-builder-prompt.mjs";

const PROJECT_ID = "12345678-1234-4234-8234-123456789abc";

test("Given template and direct section requests When candidates are created Then they stay non-persistent and are editable before apply", async (t) => {
  let engineCalls = 0;
  const project = projectFixture();
  const service = createDetailPageCandidateService({
    getProject: async () => structuredClone(project),
    runEngine: async () => { engineCalls += 1; return { ok: true, output: "{}", logs: [] }; },
  });
  t.after(() => service.close());

  const template = await service.start(PROJECT_ID, { operation: "template", category: "electronics", selectedTemplateSectionIds: ["template-1-hero", "template-4-specifications"] });
  const direct = await service.start(PROJECT_ID, { operation: "add", source: "registry", typeKey: "comparison", afterSectionId: "hero" });

  assert.equal(template.status, "ready");
  assert.deepEqual(template.proposedSections.map(({ kind }) => kind), ["hero", "specifications"]);
  assert.equal(direct.status, "ready");
  assert.equal(direct.proposedSections[0].kind, "comparison");
  assert.equal(direct.baseRevision, 3);
  assert.equal(direct.targetSectionId, null);
  assert.equal(direct.afterSectionId, "hero");
  assert.equal(engineCalls, 0);
  assert.equal(project.revision, 3);
  assert.equal(project.document.sections.length, 2);
});

test("Given a partial regeneration request When the AI returns fields outside its allowed mode Then the candidate fails closed", async (t) => {
  const service = createDetailPageCandidateService({
    getProject: async () => projectFixture(),
    runEngine: async () => ({ ok: true, output: JSON.stringify({ heading: "새 문구", body: "새 본문", bullets: ["새 포인트"], layout: "full-bleed" }), logs: [] }),
  });
  t.after(() => service.close());

  const started = await service.start(PROJECT_ID, { operation: "regenerate", sectionId: "hero", mode: "copy", instruction: "짧고 분명하게" , engine: engineFixture() });
  const candidate = await waitForCandidate(service, started);

  assert.equal(candidate.status, "failed");
  assert.equal(candidate.error.code, "INVALID_CANDIDATE_OUTPUT");
  assert.deepEqual(candidate.allowedFields, ["heading", "body", "bullets"]);
});

test("Given an unverified reviews candidate When it is prepared Then it cannot be applied and it never invents review claims", async (t) => {
  const service = createDetailPageCandidateService({ getProject: async () => projectFixture() });
  t.after(() => service.close());

  const candidate = await service.start(PROJECT_ID, { operation: "add", source: "registry", typeKey: "reviews" });

  assert.equal(candidate.status, "ready");
  assert.equal(candidate.canApply, false);
  assert.equal(candidate.evidence.status, "needs-input");
  assert.equal(candidate.proposedSections[0].body, "");
  assert.deepEqual(candidate.proposedSections[0].bullets, []);
});

test("Given a factual candidate When metadata-only and extracted supporting material are supplied Then only the extracted source counts as evidence", async (t) => {
  const project = projectFixture();
  project.evidenceSources = [
    { id: "supporting-material:0:metadata.pdf", label: "metadata.pdf", kind: "document", available: false },
    { id: "supporting-material:1:reviews.csv", label: "reviews.csv", kind: "document", available: true, excerpt: "구매자 A: 사무실에서 조용하게 쓸 수 있었어요." },
  ];
  const service = createDetailPageCandidateService({ getProject: async () => structuredClone(project) });
  t.after(() => service.close());

  const fabricated = await service.start(PROJECT_ID, {
    operation: "add",
    source: "registry",
    typeKey: "reviews",
    evidenceRefs: ["운영자가 확인한 실제 후기 원본 #1"],
  });
  const verified = await service.start(PROJECT_ID, {
    operation: "add",
    source: "registry",
    typeKey: "reviews",
    evidenceRefs: ["supporting-material:1:reviews.csv"],
  });
  const metadataOnly = await service.start(PROJECT_ID, {
    operation: "add",
    source: "registry",
    typeKey: "reviews",
    evidenceRefs: ["supporting-material:0:metadata.pdf"],
  });

  assert.equal(fabricated.canApply, false);
  assert.equal(fabricated.evidence.status, "needs-input");
  assert.equal(metadataOnly.canApply, false);
  assert.equal(verified.canApply, true);
  assert.deepEqual(verified.evidence.refs, ["supporting-material:1:reviews.csv"]);
});

test("Given extracted supporting material When an AI candidate prompt input is created Then only selected evidence sources are routed", () => {
  const project = projectFixture();
  project.evidenceSources = [
    { id: "selected", label: "reviews.csv", excerpt: "구매자 A: 소음이 적다고 평가했습니다." },
    { id: "unselected", label: "warranty.txt", excerpt: "선택되지 않은 원문" },
  ];

  const promptInput = createDetailPageCandidatePromptInput({
    operation: "add",
    mode: "add",
    allowedFields: ["type", "heading", "body", "bullets"],
    instruction: "후기 섹션을 만들어 주세요.",
    evidenceRefs: ["selected"],
  }, project);

  assert.deepEqual(promptInput.evidenceSources.map((source) => source.id), ["selected"]);
  assert.equal(promptInput.evidenceSources[0].excerpt, project.evidenceSources[0].excerpt);
});

test("Given an instruction candidate When the AI supplies an unsafe image reference Then the candidate fails before it can reach the editor", async (t) => {
  const service = createDetailPageCandidateService({
    getProject: async () => projectFixture(),
    runEngine: async () => ({
      ok: true,
      output: JSON.stringify({
        type: "free-image",
        heading: "이미지 섹션",
        body: "",
        bullets: [],
        layout: "full-bleed",
        image: { id: "unsafe-image", url: "/server.mjs", filename: "server.mjs", alt: "", source: "generated" },
      }),
      logs: [],
    }),
  });
  t.after(() => service.close());

  const started = await service.start(PROJECT_ID, {
    operation: "add",
    source: "instruction",
    instruction: "이미지 중심의 섹션을 만들어 주세요.",
    engine: engineFixture(),
  });
  const candidate = await waitForCandidate(service, started);

  assert.equal(candidate.status, "failed");
  assert.equal(candidate.error.code, "INVALID_CANDIDATE_OUTPUT");
  assert.deepEqual(candidate.proposedSections, []);
});

test("Given a staged image candidate When materialization fails Then it becomes non-applicable before its cleanup runs", async (t) => {
  let discarded = 0;
  const service = createDetailPageCandidateService({
    getProject: async () => projectFixture(),
    candidateAssets: {
      stage: async (_candidateId, image) => ({ assetId: "staged-image", imageId: image.id }),
      materialize: async () => { throw new Error("promotion failed"); },
      discard: async () => { discarded += 1; },
    },
    runEngine: async () => ({ ok: true, output: JSON.stringify(imageCandidateOutput()), logs: [] }),
  });
  t.after(() => service.close());

  const started = await service.start(PROJECT_ID, { operation: "add", source: "instruction", instruction: "이미지 섹션", engine: engineFixture() });
  const ready = await waitForCandidate(service, started);
  await assert.rejects(service.accept(PROJECT_ID, ready.candidateId), (error) => error?.code === "CANDIDATE_ASSETS_NOT_MATERIALIZED");
  await assert.rejects(service.materialize(PROJECT_ID, ready.candidateId), (error) => error?.code === "CANDIDATE_ASSET_MATERIALIZE_FAILED");
  const failed = await service.get(PROJECT_ID, ready.candidateId);

  assert.equal(failed.status, "failed");
  assert.equal(failed.canApply, false);
  assert.equal(failed.error.code, "CANDIDATE_ASSET_MATERIALIZE_FAILED");
  assert.equal(failed.cleanup.status, "complete");
  assert.equal(discarded, 1);
  await assert.rejects(service.materialize(PROJECT_ID, ready.candidateId), (error) => error?.code === "CANDIDATE_NOT_APPLICABLE");
});

test("Given a materializing image candidate When cancellation is requested Then promotion finishes before cleanup without returning an applicable candidate", async (t) => {
  let resolvePromotion;
  let promotionStarted;
  let discarded = 0;
  const startedPromotion = new Promise((resolve) => { promotionStarted = resolve; });
  const service = createDetailPageCandidateService({
    getProject: async () => projectFixture(),
    candidateAssets: {
      stage: async (_candidateId, image) => ({ assetId: "staged-image", imageId: image.id }),
      materialize: async () => {
        promotionStarted();
        return new Promise((resolve) => { resolvePromotion = resolve; });
      },
      discard: async () => { discarded += 1; },
      discardStaged: async () => {},
    },
    runEngine: async () => ({ ok: true, output: JSON.stringify(imageCandidateOutput()), logs: [] }),
  });
  t.after(() => service.close());

  const started = await service.start(PROJECT_ID, { operation: "add", source: "instruction", instruction: "이미지 섹션", engine: engineFixture() });
  const ready = await waitForCandidate(service, started);
  const materializing = service.materialize(PROJECT_ID, ready.candidateId);
  await startedPromotion;
  const cancelling = service.cancel(PROJECT_ID, ready.candidateId);
  resolvePromotion({
    ...imageCandidateOutput().image,
    url: "/outputs/image-runs/12345678-1234-4234-8234-123456789abd/promoted.png",
  });

  await assert.rejects(materializing, (error) => error?.code === "CANDIDATE_NOT_APPLICABLE");
  const cancelled = await cancelling;
  const current = await service.get(PROJECT_ID, ready.candidateId);

  assert.equal(cancelled.status, "cancelled");
  assert.equal(current.status, "cancelled");
  assert.equal(Object.hasOwn(current, "materializedAt"), false);
  assert.notEqual(current.proposedSections[0].image?.url, "/outputs/image-runs/12345678-1234-4234-8234-123456789abd/promoted.png");
  assert.equal(discarded, 1);
});

test("Given blocked or stale candidates When acceptance is called Then the server requires evidence and exactly one persisted revision", async (t) => {
  const project = projectFixture();
  const service = createDetailPageCandidateService({ getProject: async () => structuredClone(project) });
  t.after(() => service.close());

  const blocked = await service.start(PROJECT_ID, { operation: "add", source: "registry", typeKey: "reviews" });
  await assert.rejects(service.accept(PROJECT_ID, blocked.candidateId), (error) => error?.code === "EVIDENCE_REQUIRED");

  const ready = await service.start(PROJECT_ID, { operation: "add", source: "registry", typeKey: "benefits" });
  await assert.rejects(service.accept(PROJECT_ID, ready.candidateId), (error) => error?.code === "CANDIDATE_NOT_APPLIED");
  project.revision = ready.baseRevision + 2;
  await assert.rejects(service.accept(PROJECT_ID, ready.candidateId), (error) => error?.code === "CANDIDATE_NOT_APPLIED");
  const application = applyCandidate(project, ready, { editable: { layout: "split-right" } });
  project.revision = ready.baseRevision + 1;
  project.document = application.document;

  assert.equal((await service.accept(PROJECT_ID, ready.candidateId, { receipt: application.receipt })).status, "accepted");
});

test("Given text or copy candidates When an unrelated revision is saved Then their candidate receipts cannot acknowledge it", async (t) => {
  const project = projectFixture();
  const service = createDetailPageCandidateService({
    getProject: async () => structuredClone(project),
    runEngine: async () => ({ ok: true, output: JSON.stringify({ heading: "AI 제목", body: "AI 본문", bullets: ["AI 포인트"] }), logs: [] }),
  });
  t.after(() => service.close());

  const textCandidate = await service.start(PROJECT_ID, { operation: "add", source: "registry", typeKey: "benefits", afterSectionId: "hero" });
  const textApplication = applyCandidate(project, textCandidate, { editable: { heading: "판매자 제목", layout: "split-right" } });
  project.document = structuredClone(project.document);
  project.document.sections[0].heading = "무관한 저장";
  project.revision = textCandidate.baseRevision + 1;
  await assert.rejects(
    service.accept(PROJECT_ID, textCandidate.candidateId, { receipt: textApplication.receipt }),
    (error) => error?.code === "CANDIDATE_NOT_APPLIED",
  );
  project.document = textApplication.document;
  assert.equal((await service.accept(PROJECT_ID, textCandidate.candidateId, { receipt: textApplication.receipt })).status, "accepted");

  const copyCandidate = await waitForCandidate(service, await service.start(PROJECT_ID, {
    operation: "regenerate",
    sectionId: "hero",
    mode: "copy",
    instruction: "더 선명하게",
    engine: engineFixture(),
  }));
  const copyApplication = applyCandidate(project, copyCandidate, { patch: { heading: "판매자 수정 제목" } });
  project.document = structuredClone(project.document);
  project.document.sections.find((section) => section.id === "benefits").body = "무관한 두 번째 저장";
  project.revision = copyCandidate.baseRevision + 1;
  await assert.rejects(
    service.accept(PROJECT_ID, copyCandidate.candidateId, { receipt: copyApplication.receipt }),
    (error) => error?.code === "CANDIDATE_NOT_APPLIED",
  );
  project.document = copyApplication.document;
  assert.equal((await service.accept(PROJECT_ID, copyCandidate.candidateId, { receipt: copyApplication.receipt })).status, "accepted");
});

test("Given candidate cleanup fails transiently When the retry succeeds Then the API keeps the pending cleanup state until it is reconciled", async (t) => {
  let discardAttempts = 0;
  const service = createDetailPageCandidateService({
    getProject: async () => projectFixture(),
    cleanupRetryMs: 1,
    candidateAssets: {
      stage: async (_candidateId, image) => ({ assetId: "staged-image", imageId: image.id }),
      materialize: async () => { throw new Error("promotion failed"); },
      discard: async () => {
        discardAttempts += 1;
        if (discardAttempts === 1) throw new Error("temporary cleanup failure");
      },
    },
    runEngine: async () => ({ ok: true, output: JSON.stringify(imageCandidateOutput()), logs: [] }),
  });
  t.after(() => service.close());

  const started = await service.start(PROJECT_ID, { operation: "add", source: "instruction", instruction: "이미지 섹션", engine: engineFixture() });
  const ready = await waitForCandidate(service, started);
  await assert.rejects(service.materialize(PROJECT_ID, ready.candidateId));
  const pending = await service.get(PROJECT_ID, ready.candidateId);
  assert.equal(pending.cleanup.status, "pending");

  await new Promise((resolve) => setTimeout(resolve, 20));
  const reconciled = await service.get(PROJECT_ID, ready.candidateId);
  assert.equal(reconciled.cleanup.status, "complete");
  assert.equal(discardAttempts, 2);
});

test("Given cleanup keeps failing When retries pass the old terminal threshold Then the candidate remains available for reconciliation", async (t) => {
  let discardAttempts = 0;
  const service = createDetailPageCandidateService({
    getProject: async () => projectFixture(),
    cleanupRetryMs: 1,
    terminalRecordTtlMs: 1,
    candidateAssets: {
      stage: async (_candidateId, image) => ({ assetId: "staged-image", imageId: image.id }),
      materialize: async () => { throw new Error("promotion failed"); },
      discard: async () => {
        discardAttempts += 1;
        throw new Error("persistent cleanup failure");
      },
    },
    runEngine: async () => ({ ok: true, output: JSON.stringify(imageCandidateOutput()), logs: [] }),
  });
  t.after(() => service.close());

  const started = await service.start(PROJECT_ID, { operation: "add", source: "instruction", instruction: "이미지 섹션", engine: engineFixture() });
  const ready = await waitForCandidate(service, started);
  await assert.rejects(service.materialize(PROJECT_ID, ready.candidateId));
  await new Promise((resolve) => setTimeout(resolve, 30));
  const pending = await service.get(PROJECT_ID, ready.candidateId);

  assert.equal(pending.status, "failed");
  assert.equal(pending.cleanup.status, "pending");
  assert.ok(pending.cleanup.attempts >= 3);
  assert.ok(discardAttempts >= 3);
});

test("Given a delayed regeneration When it is cancelled or its base revision changes Then a late result has no authority", async (t) => {
  let release;
  const project = projectFixture();
  const service = createDetailPageCandidateService({
    getProject: async () => structuredClone(project),
    runEngine: async () => new Promise((resolve) => { release = resolve; }),
  });
  t.after(() => service.close());

  const pending = await service.start(PROJECT_ID, { operation: "regenerate", sectionId: "hero", mode: "copy", instruction: "다시", engine: engineFixture() });
  assert.equal(pending.status, "running");
  assert.equal((await service.cancel(PROJECT_ID, pending.candidateId)).status, "cancelled");
  release({ ok: true, output: JSON.stringify({ heading: "늦은 결과", body: "본문", bullets: [] }), logs: [] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await service.get(PROJECT_ID, pending.candidateId)).status, "cancelled");

  const direct = await service.start(PROJECT_ID, { operation: "add", source: "registry", typeKey: "benefits" });
  project.revision = 4;
  assert.equal((await service.get(PROJECT_ID, direct.candidateId)).status, "stale");
});

test("Given a candidate retry When the request body tries to replace its operation authority Then the original target and mode remain authoritative", async (t) => {
  const service = createDetailPageCandidateService({ getProject: async () => projectFixture() });
  t.after(() => service.close());

  const direct = await service.start(PROJECT_ID, { operation: "add", source: "registry", typeKey: "faq", afterSectionId: "hero" });
  const retried = await service.regenerate(PROJECT_ID, direct.candidateId, {
    operation: "regenerate",
    source: "registry",
    typeKey: "comparison",
    sectionId: "benefits",
    mode: "whole",
    afterSectionId: "benefits",
  });

  assert.equal(retried.operation, "add");
  assert.equal(retried.targetSectionId, null);
  assert.equal(retried.afterSectionId, "hero");
  assert.equal(retried.mode, null);
  assert.equal(retried.proposedSections[0].kind, "comparison");
});

function projectFixture() {
  return {
    id: PROJECT_ID,
    revision: 3,
    document: {
      schemaVersion: 2,
      title: "테스트 상세페이지",
      productName: "테스트 상품",
      markets: ["smartstore"],
      sections: [
        { id: "hero", kind: "hero", layout: "full-bleed", visible: true, heading: "기존 히어로", body: "기존 본문", bullets: [], source: "generated" },
        { id: "benefits", kind: "benefits", layout: "text-only", visible: true, heading: "기존 장점", body: "기존 장점 본문", bullets: ["기존 포인트"], source: "generated" },
      ],
    },
  };
}

function engineFixture() {
  return {
    engineId: "custom",
    mode: "local-cli",
    command: "./scripts/mock-engine.mjs",
    promptTransport: "stdin",
    timeoutMs: 1000,
  };
}

function imageCandidateOutput() {
  return {
    type: "free-image",
    heading: "AI 이미지 후보",
    body: "",
    bullets: [],
    layout: "full-bleed",
    image: {
      id: "candidate-image",
      url: "/outputs/image-runs/12345678-1234-4234-8234-123456789abd/candidate.png",
      filename: "candidate.png",
      alt: "후보 이미지",
      source: "generated",
    },
  };
}

function applyCandidate(project, candidate, options = {}) {
  const authority = {
    candidateId: candidate.candidateId,
    requestToken: candidate.requestToken,
    projectId: candidate.projectId,
    revision: candidate.baseRevision,
    sessionId: 1,
    documentVersion: 1,
  };
  const localCandidate = structuredClone(candidate);
  if (options.editable) {
    for (const [key, value] of Object.entries(options.editable)) localCandidate.proposedSections[0][key] = value;
  }
  if (options.patch) {
    for (const [key, value] of Object.entries(options.patch)) localCandidate.patch.changes[key] = value;
  }
  const result = applyCandidateToDocument(project.document, localCandidate, authority, authority);
  assert.equal(result.ok, true);
  return {
    document: result.document,
    receipt: {
      version: 1,
      candidateId: candidate.candidateId,
      requestToken: candidate.requestToken,
      baseRevision: candidate.baseRevision,
      savedRevision: candidate.baseRevision + 1,
      operation: candidate.operation,
      application: result.application,
    },
  };
}

async function waitForCandidate(service, candidate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const current = await service.get(PROJECT_ID, candidate.candidateId);
    if (current.status !== "running") return current;
    await new Promise((resolve) => setImmediate(resolve));
  }
  return service.get(PROJECT_ID, candidate.candidateId);
}
