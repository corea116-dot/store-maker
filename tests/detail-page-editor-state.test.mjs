import assert from "node:assert/strict";
import test from "node:test";
import {
  createDetailPageEditorState,
  detailPageEditorReducer,
} from "../assets/detail-page-editor-state.js";

test("Given a loaded project When editor state is created Then server values are cloned and clean", () => {
  const payload = projectPayload();
  const state = createDetailPageEditorState(payload);

  assert.equal(state.projectId, "job-one");
  assert.equal(state.revision, 3);
  assert.equal(state.dirty, false);
  assert.equal(state.saveStatus, "saved");
  assert.equal(state.activeTab, "edit");
  state.document.sections[0].heading = "로컬 변경";
  assert.equal(payload.project.document.sections[0].heading, "히어로");
});

test("Given section fields When they are updated Then immutable local state becomes dirty without changing ids", () => {
  const initial = createDetailPageEditorState(projectPayload());
  const updated = detailPageEditorReducer(initial, {
    type: "update-section",
    sectionId: "hero-one",
    changes: { heading: "새 제목", body: "새 본문", bullets: ["첫째", "둘째"], layout: "split-right" },
  });

  assert.notEqual(updated, initial);
  assert.equal(initial.document.sections[0].heading, "히어로");
  assert.equal(updated.document.sections[0].id, "hero-one");
  assert.equal(updated.document.sections[0].heading, "새 제목");
  assert.deepEqual(updated.document.sections[0].bullets, ["첫째", "둘째"]);
  assert.equal(updated.document.sections[0].layout, "split-right");
  assert.equal(updated.dirty, true);
  assert.equal(updated.saveStatus, "dirty");
});

test("Given ordered sections When one is added and moved Then array order changes and every id stays stable", () => {
  const initial = createDetailPageEditorState(projectPayload());
  const added = detailPageEditorReducer(initial, {
    type: "add-section",
    afterSectionId: "hero-one",
    section: { id: "user-three", heading: "새 섹션" },
  });
  assert.deepEqual(added.document.sections.map(({ id }) => id), ["hero-one", "user-three", "benefit-two"]);
  assert.equal(added.document.sections[1].kind, "text");
  assert.equal(added.document.sections[1].source, "user");

  const moved = detailPageEditorReducer(added, { type: "move-section", sectionId: "user-three", direction: 1 });
  assert.deepEqual(moved.document.sections.map(({ id }) => id), ["hero-one", "benefit-two", "user-three"]);
  assert.equal(moved.focusSectionId, "user-three");
  assert.match(moved.notice, /3번째/u);
});

test("Given visible sections When hide or delete would remove the last visible section Then the reducer blocks it", () => {
  const initial = createDetailPageEditorState(projectPayload({
    sections: [section("hero-one", true), section("hidden-two", false)],
  }));
  const hiddenAttempt = detailPageEditorReducer(initial, { type: "toggle-section-visibility", sectionId: "hero-one" });
  assert.equal(hiddenAttempt.document.sections[0].visible, true);
  assert.match(hiddenAttempt.notice, /하나 이상/u);

  const deleteAttempt = detailPageEditorReducer(initial, { type: "delete-section", sectionId: "hero-one" });
  assert.equal(deleteAttempt.document.sections.length, 2);
  assert.match(deleteAttempt.notice, /하나 이상/u);

  const deleteHidden = detailPageEditorReducer(initial, { type: "delete-section", sectionId: "hidden-two" });
  assert.deepEqual(deleteHidden.document.sections.map(({ id }) => id), ["hero-one"]);
  assert.equal(deleteHidden.dirty, true);
});

test("Given a generated asset When attached and removed Then only the target section image changes", () => {
  const initial = createDetailPageEditorState(projectPayload());
  const image = {
    id: "image-new",
    url: "/outputs/image-runs/12345678-1234-4234-8234-123456789abc/product.png",
    filename: "product.png",
    alt: "상품 대표",
    source: "generated",
  };
  const attached = detailPageEditorReducer(initial, { type: "attach-image", sectionId: "benefit-two", image });
  assert.deepEqual(attached.document.sections[1].image, image);
  assert.equal(attached.document.sections[0].image, undefined);

  const removed = detailPageEditorReducer(attached, { type: "remove-image", sectionId: "benefit-two" });
  assert.equal(removed.document.sections[1].image, undefined);
});

test("Given save lifecycle actions When the server accepts or rejects Then local edits and revision semantics stay explicit", () => {
  const dirty = detailPageEditorReducer(createDetailPageEditorState(projectPayload()), {
    type: "update-section",
    sectionId: "hero-one",
    changes: { heading: "저장할 제목" },
  });
  const saving = detailPageEditorReducer(dirty, { type: "save-started" });
  assert.equal(saving.saveStatus, "saving");

  const failed = detailPageEditorReducer(saving, { type: "save-failed", message: "네트워크 실패" });
  assert.equal(failed.dirty, true);
  assert.equal(failed.saveStatus, "failed");
  assert.equal(failed.error, "네트워크 실패");

  const conflict = detailPageEditorReducer(dirty, {
    type: "save-conflict",
    project: projectPayload({ revision: 4 }).project,
  });
  assert.equal(conflict.document.sections[0].heading, "저장할 제목");
  assert.equal(conflict.revision, 3);
  assert.equal(conflict.conflict.project.revision, 4);
  assert.equal(conflict.saveStatus, "conflict");

  const overwrite = detailPageEditorReducer(conflict, { type: "overwrite-conflict" });
  assert.equal(overwrite.document.sections[0].heading, "저장할 제목");
  assert.equal(overwrite.revision, 4);
  assert.equal(overwrite.dirty, true);
  assert.equal(overwrite.saveStatus, "dirty");
  assert.equal(overwrite.conflict, undefined);

  const savedPayload = projectPayload({ revision: 4 });
  savedPayload.project.document.sections[0].heading = "저장할 제목";
  const saved = detailPageEditorReducer(saving, { type: "save-succeeded", payload: savedPayload });
  assert.equal(saved.revision, 4);
  assert.equal(saved.dirty, false);
  assert.equal(saved.saveStatus, "saved");
  assert.equal(saved.conflict, undefined);
});

test("Given server conflict state When reloaded Then the server project replaces local state and editing can resume", () => {
  const initial = createDetailPageEditorState(projectPayload());
  const serverPayload = projectPayload({ revision: 6 });
  serverPayload.project.document.sections[0].heading = "서버 최신 제목";
  const reloaded = detailPageEditorReducer(initial, { type: "load-project", payload: serverPayload });

  assert.equal(reloaded.revision, 6);
  assert.equal(reloaded.document.sections[0].heading, "서버 최신 제목");
  assert.equal(reloaded.dirty, false);
  assert.equal(reloaded.saveStatus, "saved");
});

function projectPayload(options = {}) {
  const document = {
    schemaVersion: 1,
    title: "테스트 상세페이지",
    productName: "테스트 상품",
    markets: ["smartstore"],
    sections: options.sections ?? [section("hero-one", true, "히어로", "hero"), section("benefit-two", true, "혜택", "benefit")],
  };
  return {
    project: {
      schemaVersion: 1,
      id: "job-one",
      sourceJobId: "job-one",
      revision: options.revision ?? 3,
      createdAt: "2026-08-18T00:00:00.000Z",
      updatedAt: "2026-08-18T00:01:00.000Z",
      document,
    },
    preview: { title: document.title, html: "<article>미리보기</article>" },
    exports: { markdown: "# 테스트", html: "<article>미리보기</article>", json: { project: { revision: options.revision ?? 3 } } },
    assets: [],
  };
}

function section(id, visible, heading = "섹션", kind = "text") {
  return { id, kind, layout: "text-only", visible, heading, body: "본문", bullets: [], source: "generated" };
}
