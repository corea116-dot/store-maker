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
  controller.onEditedImage(editedImage(), { projectId: "job-one", sectionId: "hero-one", sourceUrl: sourceImageUrl("job-one"), sessionId: controller.sessionId });
  const outcome = await controller.open(job("job-two"));

  assert.equal(outcome, "blocked");
  assert.deepEqual(browser.reads, ["job-one"]);
  assert.match(browser.container.innerHTML, /job-one 제목/u);
  assert.doesNotMatch(browser.container.innerHTML, /job-two 제목/u);
});

test("Given an in-flight save When the editor closes before PUT resolves Then the late response has no authority", { concurrency: false }, async (context) => {
  let releasePut;
  const payloads = [];
  const browser = installBrowserStubs(context, async (url, options = {}) => {
    const projectId = String(url).split("/").at(-1);
    if (options.method === "PUT") {
      return new Promise((resolve) => { releasePut = resolve; });
    }
    return jsonResponse(projectPayload(projectId));
  });
  const controller = createDetailPageEditorController({ onPayload(payload) { payloads.push(payload); } });

  assert.equal(await controller.open(job("job-one")), "opened");
  controller.onEditedImage(editedImage(), {
    projectId: "job-one",
    sectionId: "hero-one",
    sourceUrl: sourceImageUrl("job-one"),
    sessionId: controller.sessionId,
  });
  const pendingSave = controller.flush();
  await new Promise((resolve) => setImmediate(resolve));

  controller.close();
  browser.container.innerHTML = "";
  releasePut(jsonResponse(projectPayload("job-one", { revision: 2 })));
  await pendingSave;

  assert.equal(controller.active, false);
  assert.equal(browser.container.innerHTML, "");
  assert.equal(payloads.length, 1);
});

test("Given a failed save When the same job reopens Then its dirty project is not replaced", async (context) => {
  const browser = installBrowserStubs(context, async (url, options = {}) => {
    const projectId = String(url).split("/").at(-1);
    if (options.method === "PUT") return jsonResponse({ error: { message: "저장 실패" } }, 500);
    browser.reads.push(projectId);
    return jsonResponse(projectPayload(projectId));
  });
  const controller = createDetailPageEditorController();

  assert.equal(await controller.open(job("job-one")), "opened");
  controller.onEditedImage(editedImage(), {
    projectId: "job-one",
    sectionId: "hero-one",
    sourceUrl: sourceImageUrl("job-one"),
    sessionId: controller.sessionId,
  });
  const outcome = await controller.open(job("job-one"));

  assert.equal(outcome, "blocked");
  assert.deepEqual(browser.reads, ["job-one"]);
  assert.match(browser.container.innerHTML, /edited\.png/u);
});

test("Given a revision conflict When overwrite is explicit Then the local document saves against the latest revision", async (context) => {
  const writes = [];
  installBrowserStubs(context, async (url, options = {}) => {
    const projectId = String(url).split("/").at(-1);
    if (options.method !== "PUT") return jsonResponse(projectPayload(projectId));
    const body = JSON.parse(options.body);
    writes.push(body);
    if (writes.length === 1) {
      return jsonResponse({
        error: { code: "REVISION_CONFLICT", message: "최신 리비전이 있습니다." },
        project: projectPayload(projectId, { revision: 4 }).project,
      }, 409);
    }
    return jsonResponse(projectPayload(projectId, { revision: 5, document: body.document }));
  });
  const controller = createDetailPageEditorController();

  assert.equal(await controller.open(job("job-one")), "opened");
  controller.onEditedImage(editedImage(), {
    projectId: "job-one",
    sectionId: "hero-one",
    sourceUrl: sourceImageUrl("job-one"),
    sessionId: controller.sessionId,
  });
  assert.equal(await controller.flush(), false);
  assert.equal(await controller.overwriteLatest(), true);

  assert.deepEqual(writes.map(({ expectedRevision }) => expectedRevision), [1, 4]);
  assert.equal(writes[1].document.sections[0].image.filename, "edited.png");
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
    sessionId: controller.sessionId,
  });
  const wrongSource = controller.onEditedImage(editedImage(), {
    projectId: "job-two",
    sectionId: "hero-one",
    sourceUrl: "/outputs/image-runs/12345678-1234-4234-8234-123456789abc/replaced.png",
    sessionId: controller.sessionId,
  });
  await controller.flush();

  assert.equal(wrongProject, false);
  assert.equal(wrongSource, false);
  assert.doesNotMatch(browser.container.innerHTML, /edited\.png/u);
});

test("Given an edited library asset When it is assigned and reloaded Then its edited source survives controller payloads", async (context) => {
  const writes = [];
  const payloads = [];
  let savedPayload;
  const browser = installBrowserStubs(context, async (url, options = {}) => {
    const projectId = String(url).split("/").at(-1);
    if (options.method === "PUT") {
      const body = JSON.parse(options.body);
      writes.push(body);
      savedPayload = projectPayload(projectId, { revision: 2, document: body.document, assets: [editedAsset()] });
      return jsonResponse(savedPayload);
    }
    return jsonResponse(savedPayload ?? projectPayload(projectId, { assets: [editedAsset()] }));
  });
  const controller = createDetailPageEditorController({ onPayload(payload) { payloads.push(payload); } });

  controller.bind();
  assert.equal(await controller.open(job("job-one")), "opened");
  browser.picker.dataset.sectionId = "hero-one";
  browser.dispatchClick({
    dataset: { assetIndex: "0" },
    closest() { return this; },
    hasAttribute(name) { return name === "data-detail-asset"; },
  });

  assert.equal(await controller.flush(), true);
  assert.equal(writes[0].document.sections[0].image.source, "edited");
  assert.equal(await controller.reloadLatest(), "reloaded");
  assert.equal(payloads.at(-1).project.document.sections[0].image.source, "edited");
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

test("Given a detail image edit is pending When an ad result opens Then the old editor authority is revoked", async (context) => {
  installBrowserStubs(context, async (url) => jsonResponse(projectPayload(String(url).split("/").at(-1))));
  const controller = createDetailPageEditorController();

  assert.equal(await controller.open(job("job-one")), "opened");
  const sessionId = controller.sessionId;
  const outcome = await controller.open(adJob("ad-job"));
  const accepted = controller.onEditedImage(editedImage(), {
    projectId: "job-one",
    sectionId: "hero-one",
    sourceUrl: sourceImageUrl("job-one"),
    sessionId,
  });

  assert.equal(outcome, "unsupported");
  assert.equal(controller.active, false);
  assert.equal(accepted, false);
});

test("Given overlapping reloads When the older response finishes last Then only the newest project is applied", async (context) => {
  const pendingReloads = [];
  const payloads = [];
  let readCount = 0;
  const browser = installBrowserStubs(context, async () => {
    readCount += 1;
    if (readCount === 1) return jsonResponse(projectPayload("job-one"));
    return new Promise((resolve) => pendingReloads.push(resolve));
  });
  const controller = createDetailPageEditorController({
    onPayload(payload) { payloads.push(payload.project.document.sections[0].heading); },
  });
  assert.equal(await controller.open(job("job-one")), "opened");

  const olderReload = controller.reloadLatest();
  const newerReload = controller.reloadLatest();
  pendingReloads[1](jsonResponse(projectPayload("job-one", { heading: "최신 서버 제목", revision: 3 })));
  assert.equal(await newerReload, "reloaded");
  pendingReloads[0](jsonResponse(projectPayload("job-one", { heading: "오래된 서버 제목", revision: 2 })));

  assert.equal(await olderReload, "stale");
  assert.match(browser.container.innerHTML, /최신 서버 제목/u);
  assert.doesNotMatch(browser.container.innerHTML, /오래된 서버 제목/u);
  assert.deepEqual(payloads, ["job-one 제목", "최신 서버 제목"]);
});

function installBrowserStubs(context, fetchHandler) {
  const originals = {
    document: globalThis.document,
    window: globalThis.window,
    fetch: globalThis.fetch,
  };
  const container = { innerHTML: "", dataset: {}, addEventListener() {}, querySelectorAll() { return []; } };
  const toast = { textContent: "", classList: { add() {}, remove() {} } };
  const picker = { dataset: {}, classList: { add() {}, remove() {} }, setAttribute() {}, removeAttribute() {}, querySelector() { return null; } };
  let clickHandler;
  const reads = [];
  globalThis.document = {
    addEventListener(type, handler) { if (type === "click") clickHandler = handler; },
    querySelector(selector) {
      if (selector === "#result-preview") return container;
      if (selector === "#toast") return toast;
      if (selector === "#detail-page-image-picker") return picker;
      return null;
    },
    querySelectorAll() { return []; },
  };
  globalThis.window = { setTimeout };
  globalThis.fetch = fetchHandler;
  context.after(() => {
    globalThis.document = originals.document;
    globalThis.window = originals.window;
    globalThis.fetch = originals.fetch;
  });
  return { container, reads, picker, dispatchClick(target) { return clickHandler({ target }); } };
}

function job(id) {
  return { id, result: { result: { generationMode: "detail-page" } } };
}

function adJob(id) {
  return { id, result: { result: { generationMode: "ad-set" } } };
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
      heading: options.heading ?? `${id} 제목`,
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
    assets: options.assets ?? [],
  };
}

function editedImage() {
  return {
    url: "/outputs/image-runs/12345678-1234-4234-8234-123456789abc/edited.png",
    filename: "edited.png",
    purpose: "수정본",
  };
}

function editedAsset() {
  return { ...editedImage(), source: "edited" };
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
