import assert from "node:assert/strict";
import test from "node:test";

import {
  DETAIL_PAGE_SECTION_REGISTRY,
  getCategoryTemplateDraft,
} from "../lib/server/detail-page-section-registry.mjs";
import {
  DetailPageDocumentValidationError,
  migrateDetailPageDocument,
  normalizeDetailPageDocument,
} from "../lib/server/detail-page-schema.mjs";

const imageUrl = "/outputs/image-runs/12345678-1234-4234-8234-123456789abc/product.png";

test("Given the advanced builder registry When types and templates are listed Then all 19 canonical section types are unique and editable", () => {
  const keys = DETAIL_PAGE_SECTION_REGISTRY.map(({ key }) => key);

  assert.equal(keys.length, 19);
  assert.equal(new Set(keys).size, 19);
  assert.deepEqual(keys, [
    "hero", "problem", "benefits", "features", "usage", "specifications", "reviews", "faq", "cta",
    "comparison", "before-after", "components", "proof", "ingredients", "warranty", "free-text", "free-image", "steps", "media",
  ]);
  for (const entry of DETAIL_PAGE_SECTION_REGISTRY) {
    assert.equal(typeof entry.labelKo, "string");
    assert.ok(entry.labelKo.length > 0);
    assert.ok(Array.isArray(entry.allowedLayouts));
    assert.ok(entry.allowedLayouts.includes(entry.defaultLayout));
    assert.ok(Array.isArray(entry.editableFields));
  }

  const draft = getCategoryTemplateDraft("beauty", "테스트 상품");
  assert.ok(draft.sections.length >= 3);
  assert.ok(draft.sections.every((section) => keys.includes(section.kind)));
});

test("Given a valid schema v1 document When normalized Then the canonical v2 document preserves order, visibility, and image data", () => {
  const legacy = v1Document({
    sections: [
      section({ id: "hero", kind: "hero", heading: "첫 화면", image: image() }),
      section({ id: "benefit", kind: "benefit", visible: false, heading: "장점" }),
      section({ id: "spec", kind: "spec", heading: "사양" }),
    ],
  });

  const normalized = normalizeDetailPageDocument(legacy);

  assert.equal(normalized.schemaVersion, 2);
  assert.deepEqual(normalized.sections.map(({ id, kind, visible }) => ({ id, kind, visible })), [
    { id: "hero", kind: "hero", visible: true },
    { id: "benefit", kind: "benefits", visible: false },
    { id: "spec", kind: "specifications", visible: true },
  ]);
  assert.deepEqual(normalized.sections[0].image, image());
  assert.equal(legacy.schemaVersion, 1);
  assert.equal(legacy.sections[1].kind, "benefit");
});

test("Given stored legacy sections with unknown or partially corrupt fields When migrated Then they safely fall back without writing the project", () => {
  const legacy = v1Document({
    sections: [
      { id: "unknown", kind: "future-widget", visible: "wrong", heading: 42, body: null, bullets: "wrong", source: "remote", layout: "masonry", image: { url: "/assets/unsafe.png" } },
      section({ id: "healthy", kind: "feature", heading: "보존할 기능" }),
    ],
  });

  const { document, report } = migrateDetailPageDocument(legacy);

  assert.equal(document.schemaVersion, 2);
  assert.deepEqual(document.sections.map(({ id, kind, heading, visible }) => ({ id, kind, heading, visible })), [
    { id: "unknown", kind: "free-text", heading: "", visible: true },
    { id: "healthy", kind: "features", heading: "보존할 기능", visible: true },
  ]);
  assert.equal(document.sections[0].image, undefined);
  assert.ok(report.warnings.some((warning) => warning.code === "UNKNOWN_SECTION_KIND" && warning.originalKind === "future-widget"));
  assert.ok(report.warnings.some((warning) => warning.code === "SECTION_FIELD_FALLBACK"));
  assert.equal(legacy.sections[0].kind, "future-widget");
});

test("Given an unsafe or wholly corrupt document When migration is requested Then the boundary still rejects it", () => {
  assert.throws(
    () => normalizeDetailPageDocument(v1Document({ sections: [section({ image: { ...image(), url: "/outputs/image-runs/12345678-1234-4234-8234-123456789abc/%2e%2e/secret.png" } })] })),
    DetailPageDocumentValidationError,
  );
  assert.throws(() => migrateDetailPageDocument({ schemaVersion: 1, sections: "not-an-array" }), DetailPageDocumentValidationError);
});

function v1Document(overrides = {}) {
  return {
    schemaVersion: 1,
    title: "테스트 상세페이지",
    productName: "테스트 상품",
    markets: ["smartstore"],
    sections: [section()],
    ...overrides,
  };
}

function section(overrides = {}) {
  return {
    id: "section-one",
    kind: "text",
    layout: "text-only",
    visible: true,
    heading: "섹션 제목",
    body: "섹션 본문",
    bullets: [],
    source: "generated",
    ...overrides,
  };
}

function image() {
  return {
    id: "image-one",
    url: imageUrl,
    filename: "product.png",
    alt: "상품 대표",
    source: "generated",
  };
}
