import assert from "node:assert/strict";
import test from "node:test";

import { createDetailPageBuilderController } from "../assets/detail-page-builder.js";

const projectId = "12345678-1234-4234-8234-123456789abc";

test("Given a direct candidate When it is only reviewed Then the controller never asks the project API to persist it", async (context) => {
  const api = installApiStubs(context, () => candidateFixture());
  let applied = 0;
  const builder = createDetailPageBuilderController({
    getContext: () => contextFixture(),
    onApply() { applied += 1; return { ok: true }; },
  });

  const candidate = await builder.startDirect("faq", { afterSectionId: "hero" });

  assert.equal(candidate.status, "ready");
  assert.equal(applied, 0);
  assert.equal(api.calls.filter((call) => call.method === "PUT").length, 0);
  assert.equal(api.calls.filter((call) => call.url.includes("builder-candidates")).length, 1);
  assert.equal(builder.state.selectedProposalIds.length, 1);
});

test("Given a ready candidate with a staged image When apply is explicit Then materialization precedes the local apply callback", async (context) => {
  const ordered = [];
  installApiStubs(context, (url) => {
    if (url.endsWith("/materialize")) {
      ordered.push("materialize");
      return candidateFixture({ materializedAt: "2026-08-19T00:00:00.000Z", stagedAssets: [], proposedSections: [section("candidate-image", "AI 이미지", "/outputs/image-runs/12345678-1234-4234-8234-123456789abd/promoted.png")] });
    }
    return candidateFixture({ stagedAssets: [{ assetId: "private-image" }], proposedSections: [section("candidate-image", "AI 이미지", "/outputs/image-runs/12345678-1234-4234-8234-123456789abd/private.png")] });
  });
  const builder = createDetailPageBuilderController({
    getContext: () => contextFixture(),
    onApply(candidate) { ordered.push(`apply:${candidate.proposedSections[0].image.url}`); return { ok: true }; },
  });

  await builder.startDirect("free-image");
  const result = await builder.apply();

  assert.equal(result.ok, true);
  assert.deepEqual(ordered, ["materialize", "apply:/outputs/image-runs/12345678-1234-4234-8234-123456789abd/promoted.png"]);
  assert.equal(builder.state.candidate, undefined);
});

test("Given a materialized candidate When the local apply callback rejects it Then the controller asks the server to discard promoted assets", async (context) => {
  const api = installApiStubs(context, (url) => {
    if (url.endsWith("/materialize")) {
      return candidateFixture({ materializedAt: "2026-08-19T00:00:00.000Z", stagedAssets: [], proposedSections: [section("candidate-image", "AI 이미지", "/outputs/image-runs/12345678-1234-4234-8234-123456789abd/promoted.png")] });
    }
    return candidateFixture({ stagedAssets: [{ assetId: "private-image" }], proposedSections: [section("candidate-image", "AI 이미지", "/outputs/image-runs/12345678-1234-4234-8234-123456789abd/private.png")] });
  });
  const builder = createDetailPageBuilderController({
    getContext: () => contextFixture(),
    onApply() { return { ok: false, message: "저장 충돌" }; },
  });

  await builder.startDirect("free-image");
  const result = await builder.apply();

  assert.equal(result.ok, false);
  assert.ok(api.calls.some((call) => call.method === "DELETE" && call.url.includes("builder-candidates")));
});

test("Given an image candidate without materialization proof When apply is requested Then the controller asks the server to materialize and never applies the original image", async (context) => {
  const api = installApiStubs(context, (url) => {
    if (url.endsWith("/materialize")) throw new Error("candidate image promotion failed");
    return candidateFixture({
      stagedAssets: [],
      proposedSections: [section("candidate-image", "AI 이미지", "/outputs/image-runs/12345678-1234-4234-8234-123456789abd/private.png")],
    });
  });
  let applied = 0;
  const builder = createDetailPageBuilderController({
    getContext: () => contextFixture(),
    onApply() { applied += 1; return { ok: true }; },
  });

  await builder.startDirect("free-image");
  const result = await builder.apply();

  assert.equal(result.ok, false);
  assert.equal(applied, 0);
  assert.ok(api.calls.some((call) => call.url.endsWith("/materialize")));
});

test("Given a saved materialized candidate When the acceptance acknowledgement fails Then the controller asks the server to reconcile its promoted assets", async (context) => {
  const api = installApiStubs(context, (url) => {
    if (url.endsWith("/materialize")) {
      return candidateFixture({ materializedAt: "2026-08-19T00:00:00.000Z", stagedAssets: [], proposedSections: [section("candidate-image", "AI 이미지", "/outputs/image-runs/12345678-1234-4234-8234-123456789abd/promoted.png")] });
    }
    if (url.endsWith("/accept")) throw new Error("acknowledgement unavailable");
    return candidateFixture({ stagedAssets: [{ assetId: "private-image" }], proposedSections: [section("candidate-image", "AI 이미지", "/outputs/image-runs/12345678-1234-4234-8234-123456789abd/private.png")] });
  });
  const builder = createDetailPageBuilderController({
    getContext: () => contextFixture(),
    onApply() { return { ok: true }; },
  });

  await builder.startDirect("free-image");
  const result = await builder.apply();

  assert.equal(result.ok, true);
  assert.ok(api.calls.some((call) => call.method === "DELETE" && call.url.includes("builder-candidates")));
});

test("Given an in-flight candidate request When the editor document version changes Then the late response has no apply authority", async (context) => {
  let resolveStart;
  let documentVersion = 4;
  installApiStubs(context, () => new Promise((resolve) => { resolveStart = resolve; }));
  let applied = 0;
  const builder = createDetailPageBuilderController({
    getContext: () => contextFixture({ documentVersion }),
    onApply() { applied += 1; return { ok: true }; },
  });

  const pending = builder.startDirect("faq");
  documentVersion = 5;
  resolveStart(candidateFixture());

  assert.equal(await pending, "stale");
  assert.equal(builder.state.candidate, undefined);
  assert.equal(applied, 0);
});

function installApiStubs(context, responseFor) {
  const originals = { document: globalThis.document, fetch: globalThis.fetch };
  const calls = [];
  globalThis.document = { querySelector() { return undefined; } };
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method ?? "GET", body: options.body });
    const candidate = await responseFor(String(url), options);
    return jsonResponse({ ok: true, candidate });
  };
  context.after(() => {
    globalThis.document = originals.document;
    globalThis.fetch = originals.fetch;
  });
  return { calls };
}

function candidateFixture(overrides = {}) {
  return {
    candidateId: "candidate-one",
    requestToken: "request-one",
    projectId,
    baseRevision: 3,
    operation: "add",
    targetSectionId: null,
    afterSectionId: null,
    mode: null,
    status: "ready",
    canApply: true,
    allowedFields: [],
    proposedSections: [section("candidate-faq", "후보 FAQ")],
    stagedAssets: [],
    evidence: { status: "not-applicable", refs: [], warnings: [] },
    ...overrides,
  };
}

function section(id, heading, imageUrl) {
  return {
    id,
    kind: imageUrl ? "free-image" : "faq",
    layout: imageUrl ? "full-bleed" : "text-only",
    visible: true,
    heading,
    body: "후보 본문",
    bullets: [],
    source: "generated",
    ...(imageUrl ? { image: { id: "candidate-image", url: imageUrl, filename: "candidate.png", alt: "후보 이미지", source: "generated" } } : {}),
  };
}

function contextFixture(overrides = {}) {
  return { projectId, revision: 3, sessionId: 9, documentVersion: 4, ...overrides };
}

function jsonResponse(payload) {
  return { ok: true, status: 200, async json() { return payload; } };
}
