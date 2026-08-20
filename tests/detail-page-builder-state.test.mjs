import assert from "node:assert/strict";
import test from "node:test";

import { applyCandidateToDocument, candidateMatchesCurrentAuthority, createDetailPageBuilderState, detailPageBuilderReducer } from "../assets/detail-page-builder-state.js";

const authority = Object.freeze({
  candidateId: "candidate-one",
  requestToken: "request-one",
  projectId: "project-one",
  revision: 3,
  sessionId: 7,
  documentVersion: 11,
});

test("Given a ready template candidate When selected proposals are applied Then candidate IDs stay outside the saved document", () => {
  const document = documentFixture();
  const candidate = candidateFixture({
    operation: "template",
    afterSectionId: "hero",
    proposedSections: [section("candidate-hero", "hero", "후보 히어로"), section("candidate-faq", "faq", "후보 FAQ")],
  });
  const result = applyCandidateToDocument(document, candidate, authority, authority, {
    selectedProposalIds: ["candidate-faq"],
    createId: sequence("accepted"),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(document.sections.map(({ id }) => id), ["hero", "benefits"]);
  assert.deepEqual(result.document.sections.map(({ id }) => id), ["hero", "section-ai-accepted-1", "benefits"]);
  assert.equal(result.document.sections[1].heading, "후보 FAQ");
  assert.notEqual(result.document.sections[1].id, candidate.proposedSections[1].id);
  assert.equal(result.selectedSectionId, "section-ai-accepted-1");
  assert.deepEqual(result.application, {
    type: "insert",
    proposals: [{
      proposalId: "candidate-faq",
      sectionId: "section-ai-accepted-1",
      editable: { heading: "후보 FAQ", body: "본문", bullets: [], layout: "text-only" },
    }],
  });
});

test("Given a copy-only regeneration candidate When it is applied Then protected section fields and out-of-mode fields remain unchanged", () => {
  const document = documentFixture();
  const candidate = candidateFixture({
    operation: "regenerate",
    targetSectionId: "hero",
    mode: "copy",
    allowedFields: ["heading", "body", "bullets"],
    patch: {
      sectionId: "hero",
      changes: {
        heading: "새로운 제목",
        body: "새로운 본문",
        bullets: ["첫 번째"],
        layout: "full-bleed",
        id: "tampered-id",
        visible: false,
        source: "user",
      },
    },
  });
  const result = applyCandidateToDocument(document, candidate, authority, authority);

  assert.equal(result.ok, true);
  assert.equal(result.document.sections[0].id, "hero");
  assert.equal(result.document.sections[0].visible, true);
  assert.equal(result.document.sections[0].source, "generated");
  assert.equal(result.document.sections[0].layout, "text-only");
  assert.equal(result.document.sections[0].heading, "새로운 제목");
  assert.deepEqual(result.document.sections[0].bullets, ["첫 번째"]);
  assert.deepEqual(result.application, {
    type: "patch",
    sectionId: "hero",
    changes: { heading: "새로운 제목", body: "새로운 본문", bullets: ["첫 번째"] },
  });
});

test("Given a stale, blocked, or unmaterialized candidate When it is checked Then it cannot mutate the local document", () => {
  const document = documentFixture();
  const ready = candidateFixture({ proposedSections: [section("candidate-one", "benefits", "후보 장점")] });
  assert.equal(candidateMatchesCurrentAuthority(ready, authority, { ...authority, sessionId: 8 }), false);
  assert.equal(applyCandidateToDocument(document, ready, authority, { ...authority, sessionId: 8 }).code, "CANDIDATE_STALE");

  const blocked = { ...ready, canApply: false };
  assert.equal(applyCandidateToDocument(document, blocked, authority, authority).code, "EVIDENCE_REQUIRED");

  const staged = { ...ready, stagedAssets: [{ assetId: "private-asset" }] };
  assert.equal(applyCandidateToDocument(document, staged, authority, authority).code, "CANDIDATE_ASSETS_NOT_MATERIALIZED");

  const unmaterializedImage = {
    ...ready,
    proposedSections: [imageSection("candidate-image", "후보 이미지")],
    stagedAssets: [],
  };
  assert.equal(applyCandidateToDocument(document, unmaterializedImage, authority, authority).code, "CANDIDATE_ASSETS_NOT_MATERIALIZED");
  assert.deepEqual(document.sections.map(({ id }) => id), ["hero", "benefits"]);
});

test("Given a template that would exceed the section limit When it is applied Then the editor refuses it before save", () => {
  const document = documentFixture({ sections: Array.from({ length: 60 }, (_, index) => section(`section-${index + 1}`, "free-text", `섹션 ${index + 1}`)) });
  const candidate = candidateFixture({ proposedSections: [section("candidate-one", "benefits", "후보 장점")] });
  const result = applyCandidateToDocument(document, candidate, authority, authority);

  assert.equal(result.ok, false);
  assert.equal(result.code, "SECTION_LIMIT");
});

test("Given a copy patch proposal When one visible field changes Then untouched patch fields remain proposed", () => {
  const candidate = candidateFixture({
    operation: "regenerate",
    mode: "copy",
    allowedFields: ["heading", "body", "bullets"],
    patch: { sectionId: "hero", changes: { heading: "AI 제목", body: "AI 본문", bullets: ["AI 포인트"] } },
  });
  const ready = detailPageBuilderReducer(createDetailPageBuilderState(), { type: "candidate-received", candidate, authority });
  const edited = detailPageBuilderReducer(ready, { type: "edit-patch", changes: { heading: "판매자 수정 제목" } });

  assert.deepEqual(edited.candidate.patch.changes, {
    heading: "판매자 수정 제목",
    body: "AI 본문",
    bullets: ["AI 포인트"],
  });
});

function candidateFixture(overrides = {}) {
  return {
    candidateId: authority.candidateId,
    requestToken: authority.requestToken,
    projectId: authority.projectId,
    baseRevision: authority.revision,
    operation: "add",
    targetSectionId: null,
    afterSectionId: null,
    mode: null,
    status: "ready",
    canApply: true,
    allowedFields: [],
    proposedSections: [],
    stagedAssets: [],
    ...overrides,
  };
}

function documentFixture(overrides = {}) {
  return {
    schemaVersion: 2,
    title: "테스트 상세페이지",
    productName: "테스트 상품",
    markets: ["smartstore"],
    sections: [section("hero", "hero", "기존 히어로"), section("benefits", "benefits", "기존 장점")],
    ...overrides,
  };
}

function section(id, kind, heading) {
  return { id, kind, layout: "text-only", visible: true, heading, body: "본문", bullets: [], source: "generated" };
}

function imageSection(id, heading) {
  return {
    ...section(id, "free-image", heading),
    layout: "full-bleed",
    image: {
      id: "candidate-image",
      url: "/outputs/image-runs/12345678-1234-4234-8234-123456789abd/private.png",
      filename: "private.png",
      alt: "후보",
      source: "generated",
    },
  };
}

function sequence(prefix) {
  let index = 0;
  return () => `${prefix}-${++index}`;
}
