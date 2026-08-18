import assert from "node:assert/strict";
import test from "node:test";

import { createDetailPageEditorController } from "../assets/detail-page-editor.js";

test("Given a failed save When another job opens Then the dirty project remains active", async (context) => {
  const browser = installBrowserStubs(context, async (url, options = {}) => {
    const projectId = String(url).split("/").at(-1);
    if (options.method === "PUT") return jsonResponse({ error: { message: "저장 실패" } }, 500);
    browser.reads.push(projectId);
    return jsonResponse(projectPayload(projectId));
  });
  const controller = createDetailPageEditorController();

  assert.ok(await controller.open(job("job-one")));
  controller.onEditedImage(editedImage(), { projectId: "job-one", sectionId: "hero-one", sourceUrl: sourceImageUrl("job-one") });
  const outcome = await controller.open(job("job-two"));

  assert.equal(outcome, "blocked");
  assert.deepEqual(browser.reads, ["job-one"]);
  assert.match(browser.container.innerHTML, /job-one 제목/u);
  assert.doesNotMatch(browser.container.innerHTML, /job-two 제목/u);
});

test("Given an image edit response When project or source identity changed Then the response is ignored", async (context) => {
  const browser = installBrowserStubs(context, async (url, options = {}) => {
    const projectId = String(url).split("/").at(-1);
    if (options.method === "PUT") {
      const body = JSON.parse(options.body);
      return jsonResponse(projectPayload(projectId, { revision: 2, document: body.document }));
    }
    return jsonResponse(projectPayload(projectId));
  });
  const controller = createDetailPageEditorController();

  assert.ok(await controller.open(job("job-one")));
  assert.ok(await controller.open(job("job-two")));
  const wrongProject = controller.onEditedImage(editedImage(), {
    projectId: "job-one",
    sectionId: "hero-one",
    sourceUrl: sourceImageUrl("job-one"),
  });
  const wrongSource = controller.onEditedImage(editedImage(), {
    projectId: "job-two",
    sectionId: "hero-one",
    sourceUrl: "/outputs/image-runs/12345678-1234-4234-8234-123456789abc/replaced.png",
  });
  await controller.flush();

  assert.equal(wrongProject, false);
  assert.equal(wrongSource, false);
  assert.doesNotMatch(browser.container.innerHTML, /edited\.png/u);
});

test("Given overlapping project reads When the older read finishes last Then only the latest job opens", async (context) => {
  const pending = new Map();
  const browser = installBrowserStubs(context, (url) => new Promise((resolve) => {
    pending.set(String(url).split("/").at(-1), resolve);
  }));
  const controller = createDetailPageEditorController();

  const firstOpen = controller.open(job("job-one"));
  const secondOpen = controller.open(job("job-two"));
  pending.get("job-two")(jsonResponse(projectPayload("job-two")));
  assert.ok(await secondOpen);
  pending.get("job-one")(jsonResponse(projectPayload("job-one")));
  assert.equal(await firstOpen, "stale");

  assert.match(browser.container.innerHTML, /job-two 제목/u);
  assert.doesNotMatch(browser.container.innerHTML, /job-one 제목/u);
});

function installBrowserStubs(context, fetchHandler) {
  const originals = {
    document: globalThis.document,
    window: globalThis.window,
    fetch: globalThis.fetch,
  };
  const container = { innerHTML: "" };
  const reads = [];
  globalThis.document = {
    addEventListener() {},
    querySelector(selector) { return selector === "#result-preview" ? container : null; },
    querySelectorAll() { return []; },
  };
  globalThis.window = { setTimeout };
  globalThis.fetch = fetchHandler;
  context.after(() => {
    globalThis.document = originals.document;
    globalThis.window = originals.window;
    globalThis.fetch = originals.fetch;
  });
  return { container, reads };
}

function job(id) {
  return { id, result: { result: { generationMode: "detail-page" } } };
}

function projectPayload(id, options = {}) {
  const document = options.document ?? {
    schemaVersion: 1,
    title: `${id} 상세페이지`,
    productName: `${id} 상품`,
    markets: ["smartstore"],
    sections: [{
      id: "hero-one",
      kind: "hero",
      layout: "split-left",
      visible: true,
      heading: `${id} 제목`,
      body: "본문",
      bullets: [],
      source: "generated",
      image: {
        id: `image-${id}`,
        url: sourceImageUrl(id),
        filename: `${id}.png`,
        alt: `${id} 이미지`,
        source: "generated",
      },
    }],
  };
  return {
    project: {
      schemaVersion: 1,
      id,
      sourceJobId: id,
      revision: options.revision ?? 1,
      createdAt: "2026-08-18T00:00:00.000Z",
      updatedAt: "2026-08-18T00:00:00.000Z",
      document,
    },
    preview: { title: document.title, html: `<article>${document.title}</article>` },
    exports: { markdown: `# ${document.title}`, html: `<article>${document.title}</article>`, json: {} },
    assets: [],
  };
}

function editedImage() {
  return {
    url: "/outputs/image-runs/12345678-1234-4234-8234-123456789abc/edited.png",
    filename: "edited.png",
    purpose: "수정본",
  };
}

function sourceImageUrl(id) {
  return `/outputs/image-runs/12345678-1234-4234-8234-123456789abc/${id}.png`;
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
