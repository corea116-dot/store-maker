import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildBrandKitSelection, canGenerateBrandKit, createBrandKitState, getBrandKitGenerationBlocker, getVisibleBrandControls, reduceBrandKitState } from "../assets/brand-kit-state.js";

const kit = (id, revision, defaults = {}) => ({
  id,
  revision,
  name: `키트 ${id}`,
  imagery: { background: `기본 배경 ${id}` },
  defaults: {
    adMoodPreset: "clean",
    imageStyle: "제품 단독컷",
    imageBackground: "흰 배경",
    ...defaults,
  },
});

const registry = ({ kits = [], defaultId = null, registryRevision = 1 } = {}) => ({
  registryRevision,
  defaultBrandKitId: defaultId,
  kits,
});

function reduce(state, ...events) {
  return events.reduce((value, event) => reduceBrandKitState(value, event), state);
}

test("Given loading or failed registry When a generation selection is built Then generation remains blocked", () => {
  const loading = createBrandKitState();
  const failed = reduce(loading, { type: "registry-failed", message: "offline" });

  assert.equal(canGenerateBrandKit(loading), false);
  assert.equal(buildBrandKitSelection(loading), null);
  assert.equal(failed.phase, "error");
  assert.equal(canGenerateBrandKit(failed), false);
  assert.equal(buildBrandKitSelection(failed), null);
});

test("Given ready registries When loaded Then only an explicit server default becomes selected", () => {
  const empty = reduce(createBrandKitState(), { type: "registry-loaded", registry: registry() });
  const oneWithoutDefault = reduce(createBrandKitState(), { type: "registry-loaded", registry: registry({ kits: [kit("one", 1)] }) });
  const selectedDefault = reduce(createBrandKitState(), { type: "registry-loaded", registry: registry({ kits: [kit("one", 1), kit("two", 4)], defaultId: "two", registryRevision: 9 }) });

  assert.deepEqual(empty.selection, { id: null, enabled: false, overrides: {} });
  assert.deepEqual(oneWithoutDefault.selection, { id: null, enabled: false, overrides: {} });
  assert.deepEqual(selectedDefault.selection, { id: "two", enabled: true, overrides: {} });
  assert.equal(selectedDefault.registryRevision, 9);
});

test("Given a selected kit When it is disabled Then its visible controls remain while the request is unbranded", () => {
  const state = reduce(createBrandKitState(),
    { type: "registry-loaded", registry: registry({ kits: [kit("one", 2)], defaultId: "one" }) },
    { type: "selection-enabled", enabled: false },
  );

  assert.deepEqual(getVisibleBrandControls(state), { adMoodPreset: "clean", imageStyle: "제품 단독컷", imageBackground: "흰 배경", imageCustomBackground: null });
  assert.deepEqual(buildBrandKitSelection(state), { enabled: false });
});

test("Given a selected kit When controls change and change back Then canonical actual overrides and reset are deterministic", () => {
  const initial = reduce(createBrandKitState(), { type: "registry-loaded", registry: registry({ kits: [kit("one", 2)], defaultId: "one" }) });
  const changed = reduce(initial,
    { type: "control-changed", field: "imageStyle", value: "소셜 광고컷" },
    { type: "control-changed", field: "adMoodPreset", value: "bold" },
    { type: "control-changed", field: "imageBackground", value: "스튜디오" },
  );
  const restored = reduce(changed,
    { type: "control-changed", field: "imageStyle", value: "제품 단독컷" },
    { type: "overrides-reset" },
  );

  assert.deepEqual(changed.selection.overrides, { adMoodPreset: "bold", imageStyle: "소셜 광고컷", imageBackground: "스튜디오" });
  assert.deepEqual(buildBrandKitSelection(changed), { enabled: true, id: "one", expectedRevision: 2, overrides: { adMoodPreset: "bold", imageStyle: "소셜 광고컷", imageBackground: "스튜디오" } });
  assert.deepEqual(restored.selection.overrides, {});
  assert.deepEqual(getVisibleBrandControls(restored), { adMoodPreset: "clean", imageStyle: "제품 단독컷", imageBackground: "흰 배경", imageCustomBackground: null });
});

test("Given custom imagery When custom background changes Then it is required only while custom background is selected", () => {
  const initial = reduce(createBrandKitState(), { type: "registry-loaded", registry: registry({ kits: [kit("one", 2, { imageBackground: "사용자 지정" })], defaultId: "one" }) });
  const custom = reduce(initial, { type: "control-changed", field: "imageCustomBackground", value: "새 배경" });
  const nonCustom = reduce(custom, { type: "control-changed", field: "imageBackground", value: "책상 위" });

  assert.deepEqual(getVisibleBrandControls(initial), { adMoodPreset: "clean", imageStyle: "제품 단독컷", imageBackground: "사용자 지정", imageCustomBackground: "기본 배경 one" });
  assert.deepEqual(custom.selection.overrides, { imageCustomBackground: "새 배경" });
  assert.deepEqual(nonCustom.selection.overrides, { imageBackground: "책상 위" });
  assert.deepEqual(getVisibleBrandControls(nonCustom), { adMoodPreset: "clean", imageStyle: "제품 단독컷", imageBackground: "책상 위", imageCustomBackground: null });
});

test("Given a non-custom kit default When a user switches to custom background Then blank is blocked and trimmed text becomes a canonical override", () => {
  const initial = reduce(createBrandKitState(), { type: "registry-loaded", registry: registry({ kits: [kit("one", 2)], defaultId: "one" }) });
  const missing = reduce(initial, { type: "control-changed", field: "imageBackground", value: "사용자 지정" });
  const filled = reduce(missing, { type: "control-changed", field: "imageCustomBackground", value: "  따뜻한 창가  " });
  const nonCustom = reduce(filled, { type: "control-changed", field: "imageBackground", value: "스튜디오" });

  assert.deepEqual(getVisibleBrandControls(missing), { adMoodPreset: "clean", imageStyle: "제품 단독컷", imageBackground: "사용자 지정", imageCustomBackground: null });
  assert.equal(getBrandKitGenerationBlocker(missing), "custom-background-required");
  assert.equal(canGenerateBrandKit(missing), false);
  assert.equal(buildBrandKitSelection(missing), null);
  assert.deepEqual(getVisibleBrandControls(filled), { adMoodPreset: "clean", imageStyle: "제품 단독컷", imageBackground: "사용자 지정", imageCustomBackground: "따뜻한 창가" });
  assert.deepEqual(filled.selection.overrides, { imageBackground: "사용자 지정", imageCustomBackground: "따뜻한 창가" });
  assert.deepEqual(buildBrandKitSelection(filled), { enabled: true, id: "one", expectedRevision: 2, overrides: { imageBackground: "사용자 지정", imageCustomBackground: "따뜻한 창가" } });
  assert.deepEqual(nonCustom.selection.overrides, { imageBackground: "스튜디오" });
  assert.equal(getBrandKitGenerationBlocker(nonCustom), null);
});

test("Given a ready draft When only HTTP 202 arrives Then selection resets to the current explicit default", () => {
  const draft = reduce(createBrandKitState(),
    { type: "registry-loaded", registry: registry({ kits: [kit("one", 2), kit("two", 4)], defaultId: "one" }) },
    { type: "kit-selected", id: "two" },
    { type: "control-changed", field: "adMoodPreset", value: "bold" },
  );
  const failed = reduce(draft, { type: "generation-response", status: 409 });
  const validation = reduce(draft, { type: "generation-response", status: 422 });
  const network = reduce(draft, { type: "generation-response", status: "network-error" });
  const acceptedSelection = buildBrandKitSelection(draft);
  const accepted = reduce(draft, { type: "generation-response", status: 202, acceptedSelection });
  const noDefault = reduce(accepted,
    { type: "registry-response", operation: "default", registry: registry({ kits: [kit("one", 2), kit("two", 4)], defaultId: null, registryRevision: 2 }) },
    { type: "generation-response", status: 202, acceptedSelection: buildBrandKitSelection(accepted) },
  );

  assert.strictEqual(failed, draft);
  assert.strictEqual(validation, draft);
  assert.strictEqual(network, draft);
  assert.deepEqual(accepted.selection, { id: "one", enabled: true, overrides: {} });
  assert.deepEqual(noDefault.selection, { id: null, enabled: false, overrides: {} });
});

test("Given an accepted request When the local selection changes before reconciliation Then the next draft is preserved", () => {
  const submitted = reduce(createBrandKitState(),
    { type: "registry-loaded", registry: registry({ kits: [kit("one", 2), kit("two", 4)], defaultId: "one" }) },
    { type: "kit-selected", id: "two" },
    { type: "control-changed", field: "adMoodPreset", value: "bold" },
  );
  const acceptedSelection = buildBrandKitSelection(submitted);
  const edited = reduce(submitted, { type: "control-changed", field: "adMoodPreset", value: "premium" });
  const reconciled = reduce(edited, { type: "generation-response", status: 202, acceptedSelection, acceptedDraft: submitted.selection });

  assert.deepEqual(reconciled.selection, { id: "two", enabled: true, overrides: { adMoodPreset: "premium" } });
});

test("Given an accepted disabled selection When its hidden draft changes Then reconciliation preserves that next draft", () => {
  const submitted = reduce(createBrandKitState(),
    { type: "registry-loaded", registry: registry({ kits: [kit("one", 2), kit("two", 4)], defaultId: "one" }) },
    { type: "kit-selected", id: "two" },
    { type: "selection-enabled", enabled: false },
  );
  const edited = reduce(submitted,
    { type: "selection-enabled", enabled: true },
    { type: "control-changed", field: "adMoodPreset", value: "premium" },
    { type: "selection-enabled", enabled: false },
  );
  const reconciled = reduce(edited, { type: "generation-response", status: 202, acceptedSelection: { enabled: false }, acceptedDraft: submitted.selection });

  assert.deepEqual(reconciled.selection, { id: "two", enabled: false, overrides: { adMoodPreset: "premium" } });
});

test("Given a stale selected ID When a registry response removes it Then explicit reselect state replaces silent fallback", () => {
  const initial = reduce(createBrandKitState(),
    { type: "registry-loaded", registry: registry({ kits: [kit("one", 1), kit("two", 1)], defaultId: "one" }) },
    { type: "kit-selected", id: "two" },
  );
  const stale = reduce(initial, { type: "registry-response", operation: "delete", registry: registry({ kits: [kit("one", 1)], defaultId: "one", registryRevision: 2 }) });

  assert.deepEqual(stale.selection, { id: null, enabled: false, overrides: {} });
  assert.equal(stale.selectionIssue, "selected-kit-missing");
});

test("Given canonical response registries When create update duplicate default and delete arrive Then state reconciles without dirty-dialog loss", () => {
  const open = reduce(createBrandKitState(),
    { type: "registry-loaded", registry: registry({ kits: [kit("one", 1)], defaultId: "one" }) },
    { type: "dialog-opened", draft: { id: "one", revision: 1, name: "local draft" } },
    { type: "dialog-draft-changed", draft: { id: "one", revision: 1, name: "local unsaved" } },
  );
  const created = reduce(open, { type: "registry-response", operation: "create", registry: registry({ kits: [kit("one", 1), kit("two", 1)], defaultId: "one", registryRevision: 2 }) });
  const updated = reduce(created, { type: "registry-response", operation: "update", registry: registry({ kits: [kit("one", 2), kit("two", 1)], defaultId: "one", registryRevision: 3 }) });
  const duplicated = reduce(updated, { type: "registry-response", operation: "duplicate", registry: registry({ kits: [kit("one", 2), kit("two", 1), kit("three", 1)], defaultId: "one", registryRevision: 4 }) });
  const defaulted = reduce(duplicated, { type: "registry-response", operation: "default", registry: registry({ kits: [kit("one", 2), kit("two", 1), kit("three", 1)], defaultId: "three", registryRevision: 5 }) });
  const deleted = reduce(defaulted, { type: "registry-response", operation: "delete", registry: registry({ kits: [kit("one", 2), kit("three", 1)], defaultId: "three", registryRevision: 6 }) });

  assert.equal(created.kits.length, 2);
  assert.equal(updated.kits.find((entry) => entry.id === "one").revision, 2);
  assert.equal(duplicated.kits.length, 3);
  assert.equal(defaulted.defaultId, "three");
  assert.equal(deleted.kits.length, 2);
  assert.deepEqual(deleted.dialog.draft, { id: "one", revision: 1, name: "local unsaved" });
});

test("Given dialog failures When validation conflict or network errors arrive Then local draft and server conflict copy remain separate", () => {
  const open = reduce(createBrandKitState(), { type: "dialog-opened", draft: { id: "one", revision: 1, name: "local" } });
  const validation = reduce(open, { type: "dialog-validation-failed", fields: { name: "required" } });
  const conflict = reduce(validation, { type: "dialog-conflict", current: { id: "one", revision: 2, name: "server" } });
  const network = reduce(conflict, { type: "dialog-network-failed", message: "offline" });

  assert.deepEqual(validation.dialog.draft, { id: "one", revision: 1, name: "local" });
  assert.deepEqual(validation.dialog.fieldErrors, { name: "required" });
  assert.deepEqual(conflict.dialog.conflict, { id: "one", revision: 2, name: "server" });
  assert.deepEqual(network.dialog.draft, { id: "one", revision: 1, name: "local" });
  assert.equal(network.dialog.status, "network-error");
});

test("Given accepted reset state When regenerate or image edit build a request Then both use current visible state rather than an old request", () => {
  const initial = reduce(createBrandKitState(),
    { type: "registry-loaded", registry: registry({ kits: [kit("one", 2), kit("two", 4)], defaultId: "one" }) },
    { type: "kit-selected", id: "two" },
    { type: "generation-response", status: 202, acceptedSelection: { enabled: true, id: "two", expectedRevision: 4, overrides: {} } },
  );

  assert.deepEqual(buildBrandKitSelection(initial, { kind: "regenerate", oldSnapshot: { id: "two" } }), { enabled: true, id: "one", expectedRevision: 2, overrides: {} });
  assert.deepEqual(buildBrandKitSelection(initial, { kind: "image-edit", oldRequest: { brandKitSelection: { id: "two" } } }), { enabled: true, id: "one", expectedRevision: 2, overrides: {} });
});

test("Given reducer inputs When callers mutate their old values Then state and payload stay deterministic and module has no browser globals", async () => {
  const source = await readFile(new URL("../assets/brand-kit-state.js", import.meta.url), "utf8");
  const incoming = registry({ kits: [kit("one", 2)], defaultId: "one" });
  const state = reduce(createBrandKitState(), { type: "registry-loaded", registry: incoming });
  const malformed = reduce(state, { type: "control-changed", field: "adMoodPreset", value: { unexpected: "body" } });
  incoming.kits[0].defaults.adMoodPreset = "tampered";
  const payload = buildBrandKitSelection(state);

  assert.equal(getVisibleBrandControls(state).adMoodPreset, "clean");
  assert.strictEqual(malformed, state);
  assert.deepEqual(payload, { enabled: true, id: "one", expectedRevision: 2, overrides: {} });
  assert.equal(/\b(?:document|window|localStorage|sessionStorage|fetch|setTimeout|setInterval)\b/u.test(source), false);
});
