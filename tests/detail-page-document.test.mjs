import assert from "node:assert/strict";
import test from "node:test";
import {
  DetailPageDocumentValidationError,
  createDetailPageDocument,
  normalizeDetailPageDocument,
  renderDetailPageDocument,
} from "../lib/server/detail-page-document.mjs";

const source = {
  title: "휴대용 선풍기 상세페이지",
  productName: "휴대용 선풍기",
  markets: ["smartstore", "coupang"],
  markdown: [
    "# 여름을 바꾸는 휴대용 선풍기",
    "",
    "출근길에도 오래 가는 시원함",
    "",
    "## 불편함을 해결합니다",
    "붐비는 지하철에서도 조용하게 사용할 수 있습니다.",
    "- 3단 풍량",
    "- 저소음 모터",
    "",
    "## 핵심 기능",
    "한 손에 잡히는 가벼운 설계입니다.",
    "",
    "## 사용 방법",
    "버튼을 눌러 원하는 풍량을 선택하세요.",
  ].join("\n"),
  images: {
    files: [
      image("hero.png", "대표 hero 이미지"),
      image("feature.png", "핵심 기능 클로즈업"),
      image("mood.png", "감성 배경 무드"),
    ],
  },
};

test("Given generated Markdown and images When a document is created Then sections and assets are deterministic", () => {
  const document = createDetailPageDocument(source);

  assert.deepEqual(document, createDetailPageDocument(source));
  assert.equal(document.schemaVersion, 1);
  assert.equal(document.title, "여름을 바꾸는 휴대용 선풍기");
  assert.equal(document.productName, "휴대용 선풍기");
  assert.deepEqual(document.sections.map(({ kind }) => kind), ["hero", "problem", "feature", "usage", "image"]);
  assert.equal(new Set(document.sections.map(({ id }) => id)).size, document.sections.length);
  assert.equal(document.sections[0].image.filename, "hero.png");
  assert.equal(document.sections[0].layout, "full-bleed");
  assert.equal(document.sections[1].body, "붐비는 지하철에서도 조용하게 사용할 수 있습니다.");
  assert.deepEqual(document.sections[1].bullets, ["3단 풍량", "저소음 모터"]);
  assert.equal(document.sections[2].image.filename, "feature.png");
  assert.equal(document.sections[2].layout, "split-left");
  assert.equal(document.sections[4].image.filename, "mood.png");
  assert.equal(document.sections[4].source, "generated");
});

test("Given Markdown without section headings When a document is created Then one editable text section remains", () => {
  const document = createDetailPageDocument({
    title: "기본 제목",
    productName: "기본 상품",
    markets: ["smartstore"],
    markdown: "제목 없는 첫 줄\n둘째 줄",
  });

  assert.equal(document.title, "기본 제목");
  assert.equal(document.sections.length, 1);
  assert.equal(document.sections[0].kind, "text");
  assert.equal(document.sections[0].layout, "text-only");
  assert.equal(document.sections[0].body, "제목 없는 첫 줄\n둘째 줄");
});

test("Given a nested generated image with an encoded space When a document is created Then its safe path remains assignable", () => {
  const document = createDetailPageDocument({
    title: "중첩 이미지 상세페이지",
    productName: "중첩 이미지 상품",
    markets: ["smartstore"],
    markdown: "상세 설명",
    images: {
      files: [{
        filename: "nested/generated image.png",
        url: "/outputs/image-runs/12345678-1234-1234-1234-123456789abc/nested/generated%20image.png",
        purpose: "생성 이미지",
      }],
    },
  });

  assert.equal(document.sections.at(-1).image.filename, "generated image.png");
  assert.equal(document.sections.at(-1).image.url, "/outputs/image-runs/12345678-1234-1234-1234-123456789abc/nested/generated%20image.png");
});

test("Given untrusted document text When it is normalized and rendered Then controls are removed and HTML is escaped", () => {
  const document = validDocument({
    title: "  안전한\u0000 제목  ",
    sections: [{
      ...section("hero"),
      heading: "<img src=x onerror=alert(1)>",
      body: "첫 줄\n<script>alert('x')</script>",
      bullets: ["<b>강조</b>"],
      image: {
        id: "image-safe",
        url: "/outputs/image-runs/12345678-1234-1234-1234-123456789abc/safe.png",
        filename: "safe.png",
        alt: "\"대표\" <사진>",
        source: "generated",
      },
    }],
  });

  const normalized = normalizeDetailPageDocument(document);
  const rendered = renderDetailPageDocument(normalized);

  assert.equal(normalized.title, "안전한 제목");
  assert.doesNotMatch(rendered.html, /<script>|<img src=x/u);
  assert.match(rendered.html, /&lt;script&gt;alert\(&#39;x&#39;\)&lt;\/script&gt;/u);
  assert.match(rendered.html, /&lt;img src=x onerror=alert\(1\)&gt;/u);
  assert.match(rendered.markdown, /# 안전한 제목/u);
  assert.match(rendered.markdown, /- <b>강조<\/b>/u);
  assert.match(rendered.markdown, /!\["대표" <사진>\]\(\/outputs\/image-runs\//u);
});

test("Given hidden sections When exports are rendered Then only visible ordered sections appear", () => {
  const document = validDocument({
    sections: [
      { ...section("benefit", "visible-one"), heading: "먼저" },
      { ...section("feature", "hidden"), visible: false, heading: "숨김" },
      { ...section("cta", "visible-two"), heading: "마지막" },
    ],
  });

  const rendered = renderDetailPageDocument(normalizeDetailPageDocument(document));

  assert.ok(rendered.markdown.indexOf("## 먼저") < rendered.markdown.indexOf("## 마지막"));
  assert.doesNotMatch(rendered.markdown, /숨김/u);
  assert.doesNotMatch(rendered.html, /숨김/u);
  assert.match(rendered.html, /data-section-id="visible-one"/u);
  assert.match(rendered.html, /data-section-id="visible-two"/u);
});

test("Given invalid documents When normalized Then the boundary rejects unsafe or ambiguous state", () => {
  const cases = [
    ["no sections", validDocument({ sections: [] }), /1 and 60 sections/u],
    ["all hidden", validDocument({ sections: [{ ...section(), visible: false }] }), /visible section/u],
    ["duplicate ids", validDocument({ sections: [section("text", "same"), section("text", "same")] }), /unique/u],
    ["invalid kind", validDocument({ sections: [{ ...section(), kind: "video" }] }), /kind/u],
    ["invalid layout", validDocument({ sections: [{ ...section(), layout: "masonry" }] }), /layout/u],
    ["invalid source", validDocument({ sections: [{ ...section(), source: "remote" }] }), /source/u],
    ["long heading", validDocument({ sections: [{ ...section(), heading: "가".repeat(201) }] }), /heading/u],
    ["too many bullets", validDocument({ sections: [{ ...section(), bullets: Array.from({ length: 31 }, () => "항목") }] }), /bullets/u],
    ["unsafe image path", validDocument({ sections: [{ ...section(), image: { id: "bad", url: "/assets/bad.png", filename: "bad.png", alt: "bad", source: "generated" } }] }), /image.url/u],
    ["encoded traversal", validDocument({ sections: [{ ...section(), image: { id: "bad", url: "/outputs/image-runs/12345678-1234-1234-1234-123456789abc/%2e%2e/secret.png", filename: "secret.png", alt: "bad", source: "generated" } }] }), /image.url/u],
    ["encoded slash", validDocument({ sections: [{ ...section(), image: { id: "bad", url: "/outputs/image-runs/12345678-1234-1234-1234-123456789abc/nested%2fsecret.png", filename: "secret.png", alt: "bad", source: "generated" } }] }), /image.url/u],
    ["encoded backslash", validDocument({ sections: [{ ...section(), image: { id: "bad", url: "/outputs/image-runs/12345678-1234-1234-1234-123456789abc/nested/%5csecret.png", filename: "secret.png", alt: "bad", source: "generated" } }] }), /image.url/u],
  ];

  for (const [label, document, expected] of cases) {
    assert.throws(
      () => normalizeDetailPageDocument(document),
      (error) => error instanceof DetailPageDocumentValidationError && expected.test(error.message),
      label,
    );
  }
});

function image(filename, purpose) {
  return {
    id: filename,
    filename,
    url: `/outputs/image-runs/12345678-1234-1234-1234-123456789abc/${filename}`,
    purpose,
  };
}

function section(kind = "text", id = "section-one") {
  return {
    id,
    kind,
    layout: "text-only",
    visible: true,
    heading: "섹션 제목",
    body: "섹션 본문",
    bullets: [],
    source: "user",
  };
}

function validDocument(overrides = {}) {
  return {
    schemaVersion: 1,
    title: "상세페이지",
    productName: "상품",
    markets: ["smartstore"],
    sections: [section()],
    ...overrides,
  };
}
