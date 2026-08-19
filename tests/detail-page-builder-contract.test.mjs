import assert from "node:assert/strict";
import test from "node:test";

import { createDetailPageCandidateService } from "../lib/server/detail-page-builder.mjs";

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

async function waitForCandidate(service, candidate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const current = await service.get(PROJECT_ID, candidate.candidateId);
    if (current.status !== "running") return current;
    await new Promise((resolve) => setImmediate(resolve));
  }
  return service.get(PROJECT_ID, candidate.candidateId);
}
