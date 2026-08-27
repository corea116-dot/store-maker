import assert from "node:assert/strict";
import test from "node:test";
import { renderAdCreativeImage } from "../lib/server/ad-automation/creative-image.mjs";

test("Given an ad visual and generated image When its creative is rendered Then the photo and exact Korean headline are composed in one SVG", () => {
  const rendered = renderAdCreativeImage({
    ad: {
      id: "ad-01",
      headline: "달콤함, 상큼함, 과즙감까지 한 번에",
      visualBrief: "실제 골드키위 원물과 반으로 자른 단면을 자연광 아래 식탁 위에 배치",
    },
    image: {
      url: "/outputs/image-runs/76d0472a-5316-40ee-9224-65e8a65d34fe/product-main.png",
      brief: { ratio: "4:5" },
    },
    ratio: "1:1",
  });

  assert.match(rendered, /data-ad-creative-image/u);
  assert.match(rendered, /data-ad-creative-source="\/outputs\/image-runs\/76d0472a-5316-40ee-9224-65e8a65d34fe\/product-main\.png"/u);
  assert.match(rendered, /viewBox="0 0 1080 1350"/u);
  assert.match(rendered, /달콤함, 상큼함,/u);
  assert.match(rendered, /과즙감까지 한 번에/u);
  assert.match(rendered, /실제 골드키위 원물과 반으로 자른 단면/u);
});

test("Given an unsafe image URL or markup headline When its creative is rendered Then no unsafe source is rendered and copy remains escaped", () => {
  const blocked = renderAdCreativeImage({
    ad: { id: "ad-02", headline: "<script>alert(1)</script>", visualBrief: "안전한 장면" },
    image: { url: "https://example.com/untrusted.png" },
  });
  const escaped = renderAdCreativeImage({
    ad: { id: "ad-02", headline: "<script>alert(1)</script>", visualBrief: "안전한 장면" },
    image: { url: "/outputs/image-runs/76d0472a-5316-40ee-9224-65e8a65d34fe/product-main.png" },
  });

  assert.equal(blocked, "");
  assert.match(escaped, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
  assert.doesNotMatch(escaped, /<script>/u);
});

test("Given long Korean ad headlines When square portrait and landscape creatives are rendered Then every title line stays within the safe width", () => {
  const imageUrl = "/outputs/image-runs/76d0472a-5316-40ee-9224-65e8a65d34fe/product-main.png";
  for (const ratio of ["1:1", "4:5", "16:9"]) {
    const rendered = renderAdCreativeImage({
      ad: {
        id: `ad-${ratio}`,
        headline: "달콤함, 상큼함, 과즙감까지 한 번에",
        visualBrief: "골드키위 원물과 단면을 자연광 아래 식탁 위에 배치",
      },
      image: { url: imageUrl, brief: { ratio } },
      ratio,
    });
    const lines = [...rendered.matchAll(/<text[^>]*>([^<]*)<\/text>/gu)].map((match) => match[1]);

    assert.ok(lines.length >= 2, `${ratio} has wrapped title lines`);
    assert.ok(lines.every((line) => Array.from(line).length <= 12), `${ratio} title lines fit the Hangul safe width`);
  }
});
