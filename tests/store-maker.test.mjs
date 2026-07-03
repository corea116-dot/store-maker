import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer as createNodeServer, request as requestHttp } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createServer } from "../server.mjs";
import { imageStyleOptions, maxImageCount } from "../assets/image-options.js";

const canonicalCopyAngleIds = [
  "problem-solution",
  "before-after",
  "benefit-stack",
  "social-proof",
  "expert-rationale",
  "comparison",
  "ingredient-material",
  "lifestyle-scene",
  "speed-convenience",
  "risk-reversal",
  "offer-value",
  "premium-origin",
  "how-to-use",
  "seasonal-context",
  "objection-handling",
  "authority-ranking",
];

test("Given product details When custom CLI generation runs Then prompt reaches stdin and export payload is populated", async (t) => {
  const app = createServer();
  const address = await listen(app);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());

  const command = `${process.execPath} scripts/mock-engine.mjs`;
  const preflight = await postJson(`${baseUrl}/api/preflight`, {
    mode: "local-cli",
    engineId: "custom",
    command,
    model: "mock",
    reasoning: "CLI 기본값"
  });

  assert.equal(preflight.ok, true);
  assert.equal(preflight.status, "available");

  const generated = await postJson(`${baseUrl}/api/generate`, {
    engine: {
      mode: "local-cli",
      engineId: "custom",
      command,
      model: "mock",
      reasoning: "CLI 기본값",
      promptTransport: "stdin"
    },
    product: {
      name: "저소음 한글 키보드",
      description: "사무실과 재택근무용, 낮은 키압, 오래 쓰는 배터리",
      requirements: "스마트스토어와 쿠팡 문체를 분리하고 금지어는 의료 효과",
      requiredInclusions: "KC 인증번호 ABC-123과 1년 무상 A/S 문구는 반드시 포함",
      materials: ["desk-shot.png", "battery-spec.pdf"]
    },
    markets: ["smartstore", "coupang"]
  });

  assert.equal(generated.ok, true);
  assert.match(generated.prompt, /저소음 한글 키보드/);
  assert.match(generated.prompt, /KC 인증번호 ABC-123과 1년 무상 A\/S 문구는 반드시 포함/);
  assert.match(generated.prompt, /desk-shot\.png/);
  assert.match(generated.prompt, /smartstore, coupang/);
  assert.match(generated.result.markdown, /저소음 한글 키보드 상세페이지 초안/);
  assert.equal(generated.exports.json.product.name, "저소음 한글 키보드");
  assert.equal(generated.exports.json.product.requiredInclusions, "KC 인증번호 ABC-123과 1년 무상 A/S 문구는 반드시 포함");
  assert.ok(generated.logs.some((log) => log.message.includes("prompt delivered")));
});

test("Given ad-set mode with brand URL When generation runs Then Brand DNA, selected angles, five ads, and safe exports are returned", async (t) => {
  const app = createServer();
  const address = await listen(app);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());

  const generated = await postJson(`${baseUrl}/api/engines/invoke`, {
    generationMode: "ad-set",
    brand: {
      url: "https://brand.example/products/keyboards?draft=one&noise=two#hero"
    },
    adAutomation: {
      moodPreset: "bold"
    },
    engine: {
      mode: "local-cli",
      engineId: "custom",
      command: `${process.execPath} scripts/mock-engine.mjs`,
      model: "mock",
      promptTransport: "stdin"
    },
    product: {
      name: "저소음 한글 키보드",
      description: "사무실과 재택근무용 저소음 키보드, 오래 쓰는 배터리, 한글 각인 키캡",
      requirements: "브랜드 톤은 차분하지만 첫 화면은 강하게. 과장된 순위 표현은 피하고 실사용 장면을 강조",
      attachments: [{
        name: "keyboard-product.png",
        type: "image/png",
        size: 68,
        kind: "image",
        previewDataUrl: "data:image/png;base64,iVBORw0KGgo="
      }]
    },
    markets: ["smartstore", "coupang"]
  });
  const serialized = JSON.stringify(generated);

  assert.equal(generated.ok, true);
  assert.equal(generated.result.generationMode, "ad-set");
  assert.equal(generated.result.brandDna.source.brandUrl, "https://brand.example/products/keyboards");
  assert.equal(generated.result.brandDna.source.snapshotStatus, "skipped");
  assert.equal(Object.keys(generated.result.brandDna.layers).length, 6);
  assert.deepEqual(generated.result.adAutomation.availableAngles.map((angle) => angle.id), canonicalCopyAngleIds);
  assert.equal(generated.result.adAutomation.recommendedAngles.length, 5);
  assert.equal(generated.result.adAutomation.angleSelection.recommendedAngleIds.length, 5);
  assert.equal(generated.result.adAutomation.angleSelection.scores.length, 16);
  assert.ok(generated.result.adAutomation.angleSelection.recommendedAngleIds.every((id) => canonicalCopyAngleIds.includes(id)));
  const authorityScore = generated.result.adAutomation.angleSelection.scores.find((score) => score.angleId === "authority-ranking");
  assert.ok(authorityScore?.score < 30, "authority-ranking should be down-ranked without ranking evidence");
  assert.match(authorityScore?.reasons?.join(" ") ?? "", /근거|낮게/u);
  assert.ok(!generated.result.adAutomation.angleSelection.recommendedAngleIds.includes("authority-ranking"));
  assert.equal(generated.result.adSet.ads.length, 5);
  assert.equal(generated.result.adSet.items.length, 5);
  assert.equal(generated.result.adSet.ads[0].moodPreset, "bold");
  assert.match(generated.prompt, /광고 세트|Brand DNA|16개 카피 앵글/u);
  assert.match(generated.result.html, /광고 결과 갤러리/u);
  assert.match(generated.exports.markdown, /Brand DNA/u);
  assert.equal(generated.exports.json.generationMode, "ad-set");
  assert.equal(generated.exports.json.brandDna.source.brandUrl, "https://brand.example/products/keyboards");
  assert.deepEqual(generated.exports.json.adAutomation.availableAngles.map((angle) => angle.id), canonicalCopyAngleIds);
  assert.equal(generated.exports.json.adSet.ads.length, 5);
  assert.equal(generated.exports.json.adSet.items.length, 5);
  assert.doesNotMatch(serialized, /draft=one|noise=two|#hero|data:image/u);
  assert.ok(generated.logs.some((log) => log.title === "brand url sanitized"));
  assert.ok(generated.logs.some((log) => log.title === "angles selected"));
  assert.ok(generated.logs.some((log) => log.title === "ad gallery ready"));
  assert.ok(generated.logs.some((log) => log.title === "ad automation ready"));
});

test("Given malformed brand URL When ad-set generation runs Then fallback Brand DNA is returned without echoing the raw URL", async (t) => {
  const app = createServer();
  const address = await listen(app);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());

  const generated = await postJson(`${baseUrl}/api/generate`, {
    generationMode: "ad-set",
    brand: {
      url: "not a usable brand url"
    },
    adAutomation: {
      moodPreset: "editorial"
    },
    engine: {
      mode: "local-cli",
      engineId: "custom",
      command: `${process.execPath} scripts/mock-engine.mjs`,
      model: "mock"
    },
    product: {
      name: "휴대용 원목 받침대",
      description: "노트북과 태블릿을 함께 올리는 접이식 받침대",
      requirements: "소재감과 휴대성을 강조하고 안전한 표현만 사용"
    },
    markets: ["smartstore"]
  });
  const serialized = JSON.stringify(generated);

  assert.equal(generated.ok, true);
  assert.equal(generated.result.brandDna.source.brandUrl, null);
  assert.equal(generated.result.brandDna.source.urlSafety.status, "invalid");
  assert.equal(generated.result.brandDna.source.urlSafety.safeForFutureFetch, false);
  assert.ok(generated.result.brandDna.warnings.some((warning) => /URL|주소/u.test(warning)));
  assert.equal(generated.result.adSet.ads.length, 5);
  assert.doesNotMatch(serialized, /not a usable brand url/u);
});

test("Given BYOK provider When ad-set generation runs Then provider receives sanitized task context without secrets", async (t) => {
  const app = createServer();
  const appAddress = await listen(app);
  let providerBody;
  const provider = createNodeServer((request, response) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => {
      providerBody = JSON.parse(raw);
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({
        brandDna: {
          layers: {
            coreIdentity: {
              label: "핵심 정체성",
              summary: "엔진이 반영한 구조화 Brand DNA",
              evidence: ["provider JSON"],
              confidence: 0.88
            }
          }
        },
        adSet: {
          items: [{
            angleId: "before-after",
            angleLabel: "전후 변화",
            moodPreset: "clean",
            headline: "엔진 제공 헤드라인",
            primaryText: "엔진 제공 본문",
            cta: "엔진 CTA",
            visualBrief: "엔진 제공 비주얼 브리프",
            complianceNote: "엔진 제공 안전 문구"
          }]
        }
      }));
    });
  });
  const providerAddress = await listen(provider);
  const baseUrl = `http://127.0.0.1:${appAddress.port}`;
  t.after(() => app.close());
  t.after(() => provider.close());

  const generated = await postJson(`${baseUrl}/api/generate`, {
    generationMode: "ad-set",
    brand: {
      url: "https://brand.example/collections/desk?draft=one"
    },
    adAutomation: {
      moodPreset: "clean"
    },
    engine: {
      mode: "byok-http",
      engineId: "byok",
      byokProvider: `http://127.0.0.1:${providerAddress.port}/generate`,
      model: "provider-model",
      apiKey: "byok-ad-provider-secret",
      timeoutMs: 1000
    },
    product: {
      name: "데스크 케이블 정리함",
      description: "책상 위 충전선과 멀티탭을 정리하는 수납함",
      requirements: "깔끔한 전후 비교와 설치 쉬움을 강조"
    },
    markets: ["smartstore"]
  });

  assert.equal(generated.ok, true);
  assert.equal(providerBody.task, "ad-set");
  assert.equal(providerBody.generationMode, "ad-set");
  assert.equal(providerBody.brand.url, "https://brand.example/collections/desk");
  assert.equal(providerBody.adAutomation.moodPreset, "clean");
  assert.equal(providerBody.adAutomation.recommendedAngleIds.length, 5);
  assert.equal(providerBody.adAutomation.recommendedAngles, undefined);
  assert.equal(generated.result.brandDna.layers.coreIdentity.summary, "엔진이 반영한 구조화 Brand DNA");
  assert.equal(generated.result.adSet.items[0].headline, "엔진 제공 헤드라인");
  assert.equal(generated.result.adSet.ads[0].headline, "엔진 제공 헤드라인");
  assert.doesNotMatch(JSON.stringify(providerBody), /draft=one|byok-ad-provider-secret|apiKey/u);
});

test("Given private and unspecified brand URLs When ad-set generation runs Then future fetch is marked unsafe", async (t) => {
  const app = createServer();
  const address = await listen(app);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());

  for (const brandUrl of ["http://0.0.0.0/x", "http://[::]/x", "http://[fd00::1]/x", "http://[fe80::1]/x", "http://[::ffff:127.0.0.1]/x"]) {
    const generated = await postJson(`${baseUrl}/api/generate`, {
      generationMode: "ad-set",
      brand: { url: brandUrl },
      adAutomation: { moodPreset: "clean" },
      engine: {
        mode: "local-cli",
        engineId: "custom",
        command: `${process.execPath} scripts/mock-engine.mjs`,
        model: "mock"
      },
      product: {
        name: "IPv6 안전 검증 상품",
        description: "브랜드 URL 안전 경계 검증용 상품",
        requirements: "사설 주소는 향후 자동 가져오기 대상이 아니어야 함"
      },
      markets: ["smartstore"]
    });

    assert.equal(generated.ok, true);
    assert.equal(generated.result.brandDna.source.urlSafety.status, "unsafe-for-future-fetch");
    assert.equal(generated.result.brandDna.source.urlSafety.safeForFutureFetch, false);
  }
});


test("Given ranking terms only in caution wording When ad-set generation runs Then authority-ranking is down-ranked", async (t) => {
  const app = createServer();
  const address = await listen(app);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());

  const generated = await postJson(`${baseUrl}/api/generate`, {
    generationMode: "ad-set",
    brand: { url: "https://brand.example/safe-claims" },
    adAutomation: { moodPreset: "clean" },
    engine: {
      mode: "local-cli",
      engineId: "custom",
      command: `${process.execPath} scripts/mock-engine.mjs`,
      model: "mock"
    },
    product: {
      name: "검증형 데스크 램프",
      description: "책상 위에서 쓰는 조도 조절 램프",
      requirements: "과장된 1위 표현과 인증 주장은 금지. 랭킹 근거 없음. 실제 사용 장면과 설치 편의만 강조"
    },
    markets: ["smartstore"]
  });
  const authorityScore = generated.result.adAutomation.angleSelection.scores.find((score) => score.angleId === "authority-ranking");

  assert.equal(generated.ok, true);
  assert.ok(authorityScore?.score < 30, "authority-ranking should stay low when ranking terms are only cautions");
  assert.match(authorityScore?.reasons?.join(" ") ?? "", /금지|근거 없음|낮게/u);
  assert.ok(!generated.result.adAutomation.angleSelection.recommendedAngleIds.includes("authority-ranking"));
});

test("Given ad-set mode with ImageGen enabled When generation runs Then image prompt includes Brand DNA and five ad visual briefs", async (t) => {
  const app = createServer();
  const address = await listen(app);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());

  const generated = await postJson(`${baseUrl}/api/generate`, {
    generationMode: "ad-set",
    brand: { url: "https://brand.example/desk" },
    adAutomation: { moodPreset: "editorial" },
    engine: {
      mode: "local-cli",
      engineId: "custom",
      command: `${process.execPath} scripts/mock-engine.mjs`,
      model: "mock"
    },
    imageGeneration: {
      provider: "codex-imagegen",
      command: "./scripts/fake-codex-imagegen.mjs",
      count: 1,
      ratio: "1:1",
      style: "상세페이지 배너",
      background: "스튜디오",
      useReference: false,
      timeoutMs: 2000
    },
    product: {
      name: "에디토리얼 데스크 램프",
      description: "책상 위에서 쓰는 조도 조절 램프",
      requirements: "분위기와 사용 장면을 강조"
    },
    markets: ["smartstore"]
  });
  t.after(() => rm(new URL(`../${generated.result.images.outputDir}/`, import.meta.url), { recursive: true, force: true }));

  assert.equal(generated.ok, true);
  assert.match(generated.result.images.prompt, /Brand DNA/u);
  assert.match(generated.result.images.prompt, /광고 비주얼 브리프 5개/u);
  assert.match(generated.result.images.prompt, /ad-01/u);
  assert.match(generated.result.images.prompt, /ad-05/u);
});

test("Given invoke alias without generationMode When generation runs Then detail-page behavior remains the default", async (t) => {
  const app = createServer();
  const address = await listen(app);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());

  const generated = await postJson(`${baseUrl}/api/engines/invoke`, {
    engine: {
      mode: "local-cli",
      engineId: "custom",
      command: `${process.execPath} scripts/mock-engine.mjs`,
      model: "mock"
    },
    product: {
      name: "기본 상세페이지 회귀 상품",
      description: "기존 상세페이지 생성 기본값 확인",
      requirements: "광고 세트 필드가 없어도 상세페이지로 동작"
    },
    markets: ["smartstore"]
  });

  assert.equal(generated.ok, true);
  assert.match(generated.result.title, /상세페이지/u);
  assert.equal(generated.exports.json.generationMode, undefined);
  assert.equal(generated.exports.json.brandDna, undefined);
  assert.equal(generated.exports.json.adSet, undefined);
});

test("Given Codex CLI adapter When generation runs Then final message file is captured", async (t) => {
  const app = createServer();
  const address = await listen(app);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());

  const command = "./scripts/fake-codex.mjs";
  const preflight = await postJson(`${baseUrl}/api/preflight`, {
    mode: "local-cli",
    engineId: "codex",
    command
  });

  assert.equal(preflight.ok, true);
  assert.equal(preflight.status, "available");

  const generated = await postJson(`${baseUrl}/api/generate`, {
    engine: {
      mode: "local-cli",
      engineId: "codex",
      command,
      model: "CLI config",
      timeoutMs: 1_000
    },
    routing: { category: "codex", copy: "codex", image: "codex", market: "codex" },
    product: {
      name: "저소음 한글 키보드",
      description: "사무실과 재택근무용, 낮은 키압, 오래 쓰는 배터리",
      requirements: "스마트스토어와 쿠팡 문체를 분리"
    },
    markets: ["smartstore", "coupang"]
  });

  assert.equal(generated.ok, true);
  assert.match(generated.result.markdown, /Codex adapter: final message file captured/);
  assert.match(generated.result.markdown, /저소음 한글 키보드/);
  assert.ok(generated.logs.some((log) => /Codex CLI/.test(log.message) && /output-last-message/.test(log.message)));
  assert.ok(generated.logs.some((log) => /prompt delivered via stdin/.test(log.message)));
  assert.doesNotMatch(JSON.stringify(generated.logs), /\/var\/|\/Users\/b\./u);
});

test("Given custom prompt transport settings When generation runs Then prompt is delivered by configured channel", async (t) => {
  const app = createServer();
  const address = await listen(app);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());

  for (const promptTransport of ["last-arg", "prompt-file"]) {
    const generated = await postJson(`${baseUrl}/api/generate`, {
      engine: {
        mode: "local-cli",
        engineId: "custom",
        command: `${process.execPath} scripts/prompt-probe-engine.mjs --mode ${promptTransport}`,
        model: "mock",
        promptTransport
      },
      product: {
        name: `전달 방식 ${promptTransport}`,
        description: "프롬프트 전달 채널 검증",
        requirements: "상품명과 마켓이 실제 프롬프트로 전달되어야 함"
      },
      markets: ["smartstore"]
    });

    assert.equal(generated.ok, true);
    assert.match(generated.result.markdown, new RegExp(`전달 방식 ${promptTransport}`));
    assert.ok(generated.logs.some((log) => log.message.includes(`prompt delivered via ${promptTransport}`)));
  }
});

test("Given inline secret and local path CLI args When generation runs Then logs and exports redact them", async (t) => {
  const app = createServer();
  const address = await listen(app);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());

  const generated = await postJson(`${baseUrl}/api/generate`, {
    engine: {
      mode: "local-cli",
      engineId: "custom",
      command: `${process.execPath} scripts/mock-engine.mjs`,
      model: "mock",
      extraArgs: "--api-key=sk-test-inline-secret --token=plain-secret-token --config=/Users/b./Desktop/private/config.json"
    },
    product: {
      name: "저소음 한글 키보드",
      description: "사무실용 키보드",
      requirements: "민감한 CLI 인자 redaction 검증"
    },
    markets: ["smartstore"]
  });
  const serialized = JSON.stringify(generated);

  assert.equal(generated.ok, true);
  assert.doesNotMatch(serialized, /sk-test-inline-secret|plain-secret-token|\/Users\/b\.|private\/config/u);
  assert.match(serialized, /--api-key=\[redacted\]/);
  assert.match(serialized, /--token=\[redacted\]/);
  assert.match(serialized, /--config=\[path-redacted\]/);
});

test("Given attached product files When generation runs Then prompt includes safe attachment metadata", async (t) => {
  const app = createServer();
  const address = await listen(app);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());

  const generated = await postJson(`${baseUrl}/api/generate`, {
    engine: {
      mode: "local-cli",
      engineId: "custom",
      command: `${process.execPath} scripts/mock-engine.mjs`,
      model: "mock"
    },
    product: {
      name: "저소음 한글 키보드",
      description: "사무실용 키보드",
      requirements: "첨부된 촬영 자료를 반영",
      attachments: [
        {
          name: "desk-shot.png",
          type: "image/png",
          size: 68,
          kind: "image",
          previewDataUrl: "data:image/png;base64,iVBORw0KGgo="
        },
        {
          name: "battery-spec.txt",
          type: "text/plain",
          size: 34,
          kind: "image",
          textPreview: "배터리 24개월 사용 가능"
        }
      ]
    },
    markets: ["smartstore"]
  });

  assert.equal(generated.ok, true);
  assert.match(generated.prompt, /desk-shot\.png/);
  assert.match(generated.prompt, /image\/png/);
  assert.match(generated.prompt, /68 bytes/);
  assert.match(generated.prompt, /battery-spec\.txt/);
  assert.match(generated.prompt, /배터리 24개월 사용 가능/);
  assert.equal(generated.exports.json.product.attachments[0].name, "desk-shot.png");
  assert.equal(generated.exports.json.product.attachments[1].kind, "text");
});

test("Given Codex CLI ImageGen enabled with reference attachment When generation runs Then output image files are returned and exported", async (t) => {
  const app = createServer();
  const address = await listen(app);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());

  const generated = await postJson(`${baseUrl}/api/generate`, {
    engine: {
      mode: "local-cli",
      engineId: "custom",
      command: `${process.execPath} scripts/mock-engine.mjs`,
      model: "mock"
    },
    imageGeneration: {
      provider: "codex-imagegen",
      command: "./scripts/fake-codex-imagegen.mjs",
      extraArgs: "--api-key=sk-imagegen-inline-secret --config=/Users/b./Desktop/private/imagegen.json",
      count: 1,
      ratio: "1:1",
      style: "제품 단독컷",
      background: "흰 배경",
      useReference: true,
      timeoutMs: 2000
    },
    product: {
      name: "저소음 한글 키보드",
      description: "사무실용 키보드",
      requirements: "첨부된 상품 사진을 참고해서 대표 이미지를 생성",
      attachments: [{
        name: "/Users/b./Desktop/private/desk-shot.png",
        type: "image/png",
        size: 68,
        kind: "image",
        previewDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
      }]
    },
    markets: ["smartstore", "coupang"]
  });
  t.after(() => rm(new URL(`../${generated.result.images.outputDir}/`, import.meta.url), { recursive: true, force: true }));
  t.after(() => rm(new URL(`../outputs/uploads/${generated.result.images.runId}/`, import.meta.url), { recursive: true, force: true }));

  const serialized = JSON.stringify(generated);
  assert.equal(generated.ok, true);
  assert.equal(generated.result.images.provider, "codex-imagegen");
  assert.equal(generated.result.images.files.length, 1);
  assert.match(generated.result.images.prompt, /\$imagegen/);
  assert.match(generated.result.images.prompt, /저소음 한글 키보드/);
  assert.match(generated.result.images.prompt, /OUTPUT_DIR:/);
  assert.equal(generated.result.images.referenceFiles[0].name, "desk-shot.png");
  assert.match(generated.result.markdown, /3\. 이미지 생성\/촬영 프롬프트/);
  assert.match(generated.exports.markdown, /outputs\/image-runs\/.+product-main\.png/);
  assert.equal(generated.exports.json.result.images.files[0].filename, "product-main.png");
  assert.doesNotMatch(serialized, /data:image|\/Users\/b\.|private\/desk-shot|sk-imagegen-inline-secret|private\/imagegen/u);
  assert.ok(generated.logs.some((log) => /Codex CLI ImageGen/.test(log.message) && /--image/.test(log.message)));
  assert.ok(generated.logs.some((log) => log.title === "image generation completed"));

  const imageResponse = await fetch(`${baseUrl}${generated.result.images.files[0].url}`);
  assert.equal(imageResponse.status, 200);
  assert.equal(imageResponse.headers.get("content-type"), "image/png");
});

test("Given fake Codex ImageGen creates four files When imageCount is four Then preview payload exports all four images", async (t) => {
  const app = createServer();
  const address = await listen(app);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());

  const generated = await generateWithImageCount(t, baseUrl, { imageCount: 4 });

  assert.equal(generated.ok, true);
  assert.equal(generated.result.images.requestedImageCount, 4);
  assert.equal(generated.result.images.generatedImageCount, 4);
  assert.equal(generated.result.images.files.length, 4);
  assert.equal(generated.result.images.images.length, 4);
  assert.equal(generated.result.images.quality?.level, "placeholder");
  assert.equal(generated.result.images.quality?.isTestProvider, true);
  assert.equal(generated.result.images.quality?.placeholderCount, 4);
  assert.ok(generated.result.images.files.every((file) => file.isPlaceholder === true));
  assert.match(generated.result.html, /요청 4개\s*\/\s*생성 4개/u);
  assert.match(generated.result.html, /테스트 이미지/u);
  assert.match(generated.result.html, /실제 상품 사진이 아닌 테스트용 플레이스홀더/u);
  assert.match(generated.result.images.prompt, /정확히 4개의 독립 이미지 파일/u);
  assert.match(generated.result.images.prompt, /콜라주|그리드/u);
  assert.equal(generated.exports.json.requestedImageCount, 4);
  assert.equal(generated.exports.json.generatedImageCount, 4);
  assert.equal(generated.exports.json.images.length, 4);
  assert.equal(generated.exports.json.result.images.quality.placeholderCount, 4);
  assert.deepEqual(generated.exports.json.images.map((file) => file.filename), [
    "product-main.png",
    "product-main-02.png",
    "product-main-03.png",
    "product-main-04.png",
  ]);
});

test("Given imageCount seven When fake ImageGen runs Then seven files are returned and exported", async (t) => {
  const app = createServer();
  const address = await listen(app);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());

  const generated = await generateWithImageCount(t, baseUrl, { imageCount: 7 });

  assert.equal(generated.ok, true);
  assert.equal(generated.result.images.requestedImageCount, 7);
  assert.equal(generated.result.images.generatedImageCount, 7);
  assert.equal(generated.result.images.files.length, 7);
  assert.equal(generated.exports.json.requestedImageCount, 7);
  assert.equal(generated.exports.json.generatedImageCount, 7);
  assert.equal(generated.exports.json.images.length, 7);
  assert.match(generated.exports.json.imagePrompt, /REQUESTED_IMAGE_COUNT: 7/u);
  assert.match(generated.exports.markdown, /요청 7개 \/ 생성 7개/u);
});

test("Given imageCount ten with automatic style diversity When fake ImageGen runs Then ten styled briefs and files are exported", async (t) => {
  const app = createServer();
  const address = await listen(app);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());

  const generated = await generateWithImageCount(t, baseUrl, {
    imageCount: 10,
    style: "자동 다양화",
  });

  const imageBriefs = generated.result.images.imageBriefs;
  const exportedImages = generated.exports.json.images;
  assert.equal(generated.ok, true);
  assert.equal(generated.result.images.requestedImageCount, 10);
  assert.equal(generated.result.images.generatedImageCount, 10);
  assert.equal(generated.result.images.files.length, 10);
  assert.equal(imageBriefs.length, 10);
  assert.equal(exportedImages.length, 10);
  assert.ok(new Set(imageBriefs.map((brief) => brief.style)).size >= 8, "auto diversity should assign varied styles");
  assert.ok(new Set(imageBriefs.map((brief) => brief.purpose)).size >= 8, "auto diversity should assign varied purposes");
  assert.ok(imageBriefs.every((brief, index) => brief.index === index + 1));
  assert.ok(imageBriefs.every((brief) => brief.ratio === "1:1" && brief.visualPrompt.includes(brief.style)));
  assert.ok(exportedImages.every((image, index) => image.style === imageBriefs[index].style));
  assert.ok(exportedImages.every((image) => image.brief?.visualPrompt && image.brief?.purpose));
  assert.match(generated.result.images.prompt, /imageBriefs/u);
  assert.match(generated.result.images.prompt, /소셜 광고컷|프리미엄 클로즈업|정보형 인포그래픽/u);
  assert.match(generated.exports.markdown, /스타일: .*자동 다양화|제품 단독컷|라이프스타일컷/u);
  assert.match(generated.result.html, /요청 10개\s*\/\s*생성 10개/u);
});

test("Given mixed image mood counts When fake ImageGen runs Then same and varied mood briefs are exported", async (t) => {
  const app = createServer();
  const address = await listen(app);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());

  const generated = await generateWithImageCount(t, baseUrl, {
    imageCount: 5,
    moodMode: "mixed",
    sameMoodCount: 2,
    variedMoodCount: 3,
    style: "제품 단독컷",
  });

  const imageBriefs = generated.result.images.imageBriefs;
  assert.equal(generated.ok, true);
  assert.equal(generated.result.images.requestedImageCount, 5);
  assert.equal(generated.result.images.sameMoodCount, 2);
  assert.equal(generated.result.images.variedMoodCount, 3);
  assert.equal(generated.exports.json.imageGeneration.moodMode, "mixed");
  assert.equal(generated.exports.json.imageGeneration.sameMoodCount, 2);
  assert.equal(generated.exports.json.imageGeneration.variedMoodCount, 3);
  assert.equal(imageBriefs.filter((brief) => brief.moodGroup === "same").length, 2);
  assert.equal(imageBriefs.filter((brief) => brief.moodGroup === "varied").length, 3);
  assert.ok(imageBriefs.slice(0, 2).every((brief) => brief.style === "제품 단독컷"));
  assert.ok(new Set(imageBriefs.slice(2).map((brief) => brief.style)).size >= 3);
  assert.match(generated.result.images.prompt, /동일한 무드 결과: 2개/u);
  assert.match(generated.result.images.prompt, /다른 무드 결과: 3개/u);
  assert.match(generated.exports.markdown, /동일한 무드 2개 \/ 다른 무드 3개/u);
  assert.match(generated.result.html, /동일한 무드 2개 \/ 다른 무드 3개/u);
});

test("Given generated image output When image edit is requested Then one edited image is generated from the selected source", async (t) => {
  const app = createServer();
  const address = await listen(app);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());

  const generated = await generateWithImageCount(t, baseUrl, { imageCount: 1 });
  const source = generated.result.images.files[0];
  const editBody = imageGenerationBody({ imageCount: 1 });
  editBody.imageEdit = {
    instruction: "키캡 각인을 더 선명하게 보여주고 배경은 흰색으로 유지",
    source: {
      url: source.url,
      filename: source.filename,
      relativePath: source.relativePath,
      style: source.style,
      purpose: source.purpose,
      type: source.mimeType,
    },
  };
  const edited = await postJson(`${baseUrl}/api/images/edit`, editBody);
  t.after(() => cleanupImageOutputsFromPayload(edited));

  assert.equal(edited.ok, true);
  assert.equal(edited.images.generatedImageCount, 1);
  assert.equal(edited.images.referenceFiles[0].name, source.filename);
  assert.match(edited.images.prompt, /개별 이미지 추가 수정/u);
  assert.match(edited.images.prompt, /키캡 각인을 더 선명하게/u);
  assert.match(edited.image.url, /^\/outputs\/image-runs\/.+product-main\.png/u);
  assert.ok(edited.logs.some((log) => log.title === "image edit completed"));
});

test("Given imageCount twenty When fake ImageGen runs Then twenty is accepted and included in the contract", async (t) => {
  const app = createServer();
  const address = await listen(app);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());

  const generated = await generateWithImageCount(t, baseUrl, { imageCount: 20 });

  assert.equal(generated.ok, true);
  assert.equal(generated.result.images.files.length, 20);
  assert.equal(generated.exports.json.requestedImageCount, 20);
  assert.equal(generated.exports.json.generatedImageCount, 20);
  assert.equal(generated.result.images.imageBriefs.length, 20);
  assert.match(generated.result.images.prompt, /imageBriefs/u);
  assert.match(generated.result.images.prompt, /REQUESTED_IMAGE_COUNT: 20/u);
  assert.match(generated.result.images.prompt, /product-main-20\.png/u);
});

test("Given invalid imageCount values When generation is requested Then the server rejects them", async (t) => {
  const app = createServer();
  const address = await listen(app);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());

  const nullWithLegacyCount = imageGenerationBody({ imageCount: null });
  nullWithLegacyCount.imageGeneration.count = 7;
  const invalidCases = [
    { label: "0", body: imageGenerationBody({ imageCount: 0 }) },
    { label: "-1", body: imageGenerationBody({ imageCount: -1 }) },
    { label: "21", body: imageGenerationBody({ imageCount: 21 }) },
    { label: "string", body: imageGenerationBody({ imageCount: "7" }) },
    { label: "null", body: imageGenerationBody({ imageCount: null }) },
    { label: "null-with-legacy-count", body: nullWithLegacyCount },
  ];

  for (const { label, body } of invalidCases) {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: await jsonHeaders(baseUrl),
      body: JSON.stringify(body),
    });
    const payload = await response.json();

    assert.equal(response.status, 422, `${label} should be rejected`);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, "VALIDATION_ERROR");
    assert.match(payload.error.message, /imageCount|1~20|1-20/u);
  }
});

test("Given fake ImageGen makes fewer than requested even after retry When generation runs Then it fails with N/M diagnostics", async (t) => {
  const app = createServer();
  const address = await listen(app);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());

  const response = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: await jsonHeaders(baseUrl),
    body: JSON.stringify(imageGenerationBody({
      imageCount: 4,
      command: "./scripts/fake-codex-imagegen.mjs --cap-output-images 2",
    })),
  });
  const payload = await response.json();
  t.after(() => cleanupImageOutputsFromPayload(payload));

  assert.equal(response.status, 422);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "IMAGEGEN_FAILED");
  assert.match(payload.error.message, /4개 요청, 2개 생성/u);
  assert.ok(payload.logs.some((log) => /4개 요청, 2개 생성/u.test(log.message)));
  assert.ok(payload.logs.some((log) => log.title === "image generation retry requested"));
});

test("Given fake ImageGen makes one file for imageCount ten When generation runs Then it fails instead of reporting success", async (t) => {
  const app = createServer();
  const address = await listen(app);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());

  const response = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: await jsonHeaders(baseUrl),
    body: JSON.stringify(imageGenerationBody({
      imageCount: 10,
      command: "./scripts/fake-codex-imagegen.mjs --cap-output-images 1",
    })),
  });
  const payload = await response.json();
  t.after(() => cleanupImageOutputsFromPayload(payload));

  assert.equal(response.status, 422);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "IMAGEGEN_FAILED");
  assert.match(payload.error.message, /10개 요청, 1개 생성/u);
  assert.ok(payload.logs.some((log) => /10개 요청, 1개 생성/u.test(log.message)));
});

test("Given Codex CLI ImageGen leaves output in Codex generated_images When generation runs Then Store Maker imports it", async (t) => {
  const codexHome = await mkdtemp(join(tmpdir(), "store-maker-codex-home-"));
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome;
  t.after(() => {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
  });
  t.after(() => rm(codexHome, { recursive: true, force: true }));

  const app = createServer();
  const address = await listen(app);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());

  const generated = await postJson(`${baseUrl}/api/generate`, {
    engine: {
      mode: "local-cli",
      engineId: "custom",
      command: `${process.execPath} scripts/mock-engine.mjs`,
      model: "mock"
    },
    imageGeneration: {
      provider: "codex-imagegen",
      command: "./scripts/fake-codex-imagegen.mjs --write-codex-home-output --no-manifest",
      imageCount: 4,
      ratio: "1:1",
      style: "제품 단독컷",
      background: "흰 배경",
      useReference: false,
      timeoutMs: 2000
    },
    product: {
      name: "저소음 한글 키보드",
      description: "사무실용 키보드",
      requirements: "Codex 기본 이미지 저장소에 남은 결과를 앱 output으로 가져오기"
    },
    markets: ["smartstore"]
  });
  t.after(() => rm(new URL(`../${generated.result.images.outputDir}/`, import.meta.url), { recursive: true, force: true }));

  const serialized = JSON.stringify(generated);
  assert.equal(generated.ok, true);
  assert.equal(generated.result.images.files[0].filename, "product-main.png");
  assert.equal(generated.result.images.files.length, 4);
  assert.equal(generated.exports.json.generatedImageCount, 4);
  assert.equal(generated.result.images.manifest?.fallback, true);
  assert.ok(generated.logs.some((log) => log.title === "image output imported"));
  assert.ok(generated.logs.some((log) => log.title === "fallback manifest created"));
  assert.doesNotMatch(serialized, /\/var\/|\/Users\/b\./u);

  const imageResponse = await fetch(`${baseUrl}${generated.result.images.files[0].url}`);
  assert.equal(imageResponse.status, 200);
  assert.equal(imageResponse.headers.get("content-type"), "image/png");
});

test("Given Codex CLI ImageGen duplicates image bytes When 10 images are requested Then Store Maker repairs duplicate slots", async (t) => {
  const app = createServer();
  const address = await listen(app);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());

  const generated = await generateWithImageCount(t, baseUrl, {
    imageCount: 10,
    command: "./scripts/fake-codex-imagegen.mjs --duplicate-first-pass",
    timeoutMs: 5000,
    style: "자동 다양화",
  });
  const hashes = await payloadImageHashes(generated);

  assert.equal(generated.ok, true);
  assert.equal(generated.result.images.files.length, 10);
  assert.equal(new Set(hashes).size, 10, "Store Maker must not return byte-identical images as a successful 10-image result");
  assert.ok(generated.logs.some((log) => log.title === "duplicate image repair requested"));
});

test("Given streaming generation endpoint When 10 duplicate-prone images are requested Then final NDJSON result stays usable", async (t) => {
  const app = createServer();
  const address = await listen(app);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());

  const response = await fetch(`${baseUrl}/api/generate-stream`, {
    method: "POST",
    headers: await jsonHeaders(baseUrl),
    body: JSON.stringify(imageGenerationBody({
      imageCount: 10,
      command: "./scripts/fake-codex-imagegen.mjs --duplicate-first-pass",
      timeoutMs: 5000,
      style: "자동 다양화",
    })),
  });
  const events = (await response.text()).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const final = events.find((event) => event.type === "result")?.result;
  t.after(() => cleanupImageOutputsFromPayload(final));
  const hashes = await payloadImageHashes(final);

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /application\/x-ndjson/u);
  assert.equal(events[0]?.type, "status");
  assert.equal(final?.ok, true);
  assert.equal(final.result.images.files.length, 10);
  assert.equal(new Set(hashes).size, 10);
  assert.ok(final.logs.some((log) => log.title === "duplicate image repair requested"));
});

test("Given generation job API When generation completes Then result can be reopened from history", async (t) => {
  const app = createServer();
  const address = await listen(app);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());

  const started = await postJson(`${baseUrl}/api/generate-jobs`, imageGenerationBody({
    imageCount: 4,
    command: "./scripts/fake-codex-imagegen.mjs",
    timeoutMs: 3000,
  }));
  assert.equal(started.ok, true);
  assert.match(started.job.id, /^[0-9a-f-]+$/u);
  assert.ok(["queued", "running"].includes(started.job.status));

  const completed = await waitForJob(baseUrl, started.job.id, (job) => job.status === "completed", 10_000);
  t.after(() => cleanupImageOutputsFromPayload(completed.result));
  assert.equal(completed.result.ok, true);
  assert.equal(completed.result.result.images.files.length, 4);

  const history = await getJson(`${baseUrl}/api/generate-jobs`);
  const listed = history.jobs.find((job) => job.id === started.job.id);
  assert.equal(listed?.status, "completed");
  assert.equal(listed?.hasResult, true);
  assert.equal(listed?.result, undefined);

  const reopened = await getJson(`${baseUrl}/api/generate-jobs/${started.job.id}`);
  assert.equal(reopened.job.result.result.images.files.length, 4);
  assert.ok(reopened.job.logs.some((log) => log.title === "job completed"));

  const deleted = await postJson(`${baseUrl}/api/generate-jobs/${started.job.id}/delete`, {});
  assert.equal(deleted.ok, true);
  assert.equal(deleted.jobs.some((job) => job.id === started.job.id), false);

  const reopenedAfterDelete = await fetch(`${baseUrl}/api/generate-jobs/${started.job.id}`, {
    headers: await jsonHeaders(baseUrl),
  });
  const reopenedAfterDeletePayload = await reopenedAfterDelete.json();
  assert.equal(reopenedAfterDelete.status, 404);
  assert.equal(reopenedAfterDeletePayload.error.code, "NOT_FOUND");

  const blocked = await fetch(`${baseUrl}/api/generate-jobs`);
  const blockedPayload = await blocked.json();
  assert.equal(blocked.status, 403);
  assert.equal(blockedPayload.error.code, "FORBIDDEN");
});

test("Given running generation job When cancel is requested Then job reaches cancelled without waiting for timeout", async (t) => {
  const app = createServer();
  const address = await listen(app);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());

  const started = await postJson(`${baseUrl}/api/generate-jobs`, imageGenerationBody({
    imageCount: 1,
    command: "./scripts/fake-codex-imagegen.mjs --no-image-output --hang-after-output",
    timeoutMs: 20_000,
  }));
  await waitForJob(baseUrl, started.job.id, (job) => job.status === "running", 3_000);

  const cancelled = await postJson(`${baseUrl}/api/generate-jobs/${started.job.id}/cancel`, {});
  assert.ok(["cancelling", "cancelled"].includes(cancelled.job.status));

  const terminal = await waitForJob(baseUrl, started.job.id, (job) => job.status === "cancelled", 5_000);
  assert.equal(terminal.error.code, "CANCELLED");
  assert.equal(terminal.result.ok, false);
  assert.equal(terminal.result.error.code, "CANCELLED");
  assert.ok(terminal.logs.some((log) => /cancel/i.test(log.title)));
});

test("Given Codex CLI ImageGen produces no files When generation runs Then request fails instead of reporting success", async (t) => {
  const app = createServer();
  const address = await listen(app);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());

  const response = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: await jsonHeaders(baseUrl),
    body: JSON.stringify({
      engine: {
        mode: "local-cli",
        engineId: "custom",
        command: `${process.execPath} scripts/mock-engine.mjs`,
        model: "mock"
      },
      imageGeneration: {
        provider: "codex-imagegen",
        command: "./scripts/fake-codex-imagegen.mjs --no-image-output",
        count: 1,
        ratio: "4:5",
        style: "상세페이지 배너",
        background: "스튜디오",
        useReference: false,
        timeoutMs: 2000
      },
      product: {
        name: "저소음 한글 키보드",
        description: "사무실용 키보드",
        requirements: "생성 이미지를 결과에 포함"
      },
      markets: ["smartstore"]
    })
  });
  const payload = await response.json();

  assert.equal(response.status, 422);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "IMAGEGEN_FAILED");
  assert.match(payload.error.message, /output file|이미지 파일/i);
  assert.ok(payload.logs.some((log) => log.title === "image generation failed"));
});

test("Given Codex CLI ImageGen times out with zero files When generation runs Then diagnostics explain the zero-output state", async (t) => {
  const app = createServer();
  const address = await listen(app);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());

  const response = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: await jsonHeaders(baseUrl),
    body: JSON.stringify({
      engine: {
        mode: "local-cli",
        engineId: "custom",
        command: `${process.execPath} scripts/mock-engine.mjs`,
        model: "mock"
      },
      imageGeneration: {
        provider: "codex-imagegen",
        command: "./scripts/fake-codex-imagegen.mjs --no-image-output --hang-after-output",
        count: 1,
        ratio: "4:5",
        style: "상세페이지 배너",
        background: "스튜디오",
        useReference: false,
        timeoutMs: 500
      },
      product: {
        name: "저소음 한글 키보드",
        description: "사무실용 키보드",
        requirements: "이미지 생성이 0개로 끝나는 timeout 진단"
      },
      markets: ["smartstore"]
    })
  });
  const payload = await response.json();
  const serialized = JSON.stringify(payload);

  assert.equal(response.status, 422);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "IMAGEGEN_FAILED");
  assert.match(payload.error.message, /timed out after 500ms/u);
  assert.match(payload.error.message, /0 image file\(s\), manifest=missing/u);
  assert.match(payload.error.message, /prompt 전달=stdin/u);
  assert.match(payload.error.message, /image inputs=0/u);
  assert.match(payload.error.message, /last-message=fake codex imagegen completed/u);
  assert.doesNotMatch(payload.error.message, /로그인 상태/u);
  assert.doesNotMatch(serialized, /\/var\/|\/Users\/b\./u);
});

test("Given Codex CLI ImageGen writes files then keeps running When generation runs Then output contract completes the request", async (t) => {
  const app = createServer();
  const address = await listen(app);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());

  const generated = await postJson(`${baseUrl}/api/generate`, {
    engine: {
      mode: "local-cli",
      engineId: "custom",
      command: `${process.execPath} scripts/mock-engine.mjs`,
      model: "mock"
    },
    imageGeneration: {
      provider: "codex-imagegen",
      command: "./scripts/fake-codex-imagegen.mjs --ask-for-approval never exec --hang-after-output",
      count: 1,
      ratio: "1:1",
      style: "제품 단독컷",
      background: "흰 배경",
      useReference: false,
      timeoutMs: 5000
    },
    product: {
      name: "저소음 한글 키보드",
      description: "사무실용 키보드",
      requirements: "이미지 생성 후 CLI가 종료되지 않아도 output contract로 완료"
    },
    markets: ["smartstore"]
  });
  t.after(() => rm(new URL(`../${generated.result.images.outputDir}/`, import.meta.url), { recursive: true, force: true }));

  const serialized = JSON.stringify(generated);
  assert.equal(generated.ok, true);
  assert.equal(generated.result.images.files[0].filename, "product-main.png");
  assert.ok(generated.logs.some((log) => log.title === "image output detected"));
  assert.doesNotMatch(serialized, /timed out after/u);
  assert.doesNotMatch(serialized, /\/var\/|\/Users\/b\./u);
});

test("Given Codex CLI ImageGen times out after writing images without manifest When generation runs Then fallback manifest recovers the output", async (t) => {
  const app = createServer();
  const address = await listen(app);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());

  const generated = await postJson(`${baseUrl}/api/generate`, {
    engine: {
      mode: "local-cli",
      engineId: "custom",
      command: `${process.execPath} scripts/mock-engine.mjs`,
      model: "mock"
    },
    imageGeneration: {
      provider: "codex-imagegen",
      command: "./scripts/fake-codex-imagegen.mjs exec --no-manifest --hang-after-output",
      imageCount: 10,
      ratio: "1:1",
      style: "제품 단독컷",
      background: "흰 배경",
      useReference: false,
      timeoutMs: 1500
    },
    product: {
      name: "저소음 한글 키보드",
      description: "사무실용 키보드",
      requirements: "이미지는 생성됐지만 manifest가 없는 timeout을 자동 복구"
    },
    markets: ["smartstore"]
  });
  t.after(() => rm(new URL(`../${generated.result.images.outputDir}/`, import.meta.url), { recursive: true, force: true }));

  const serialized = JSON.stringify(generated);
  assert.equal(generated.ok, true);
  assert.equal(generated.result.images.files[0].filename, "product-main.png");
  assert.equal(generated.result.images.files.length, 10);
  assert.equal(generated.exports.json.generatedImageCount, 10);
  assert.equal(generated.result.images.manifest?.fallback, true);
  assert.equal(generated.result.images.manifest?.files?.[0]?.filename, "product-main.png");
  assert.equal(generated.result.images.manifest?.files?.length, 10);
  assert.ok(generated.logs.some((log) => log.title === "image output recovered"));
  assert.match(serialized, /fallback manifest|자동 복구|manifest/i);
  assert.doesNotMatch(serialized, /IMAGEGEN_FAILED|timed out after|\/var\/|\/Users\/b\./u);
});

test("Given unsupported attachment file When generation runs Then request is rejected", async (t) => {
  const app = createServer();
  const address = await listen(app);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());

  const response = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: await jsonHeaders(baseUrl),
    body: JSON.stringify({
      engine: {
        mode: "local-cli",
        engineId: "custom",
        command: `${process.execPath} scripts/mock-engine.mjs`
      },
      product: {
        name: "저소음 한글 키보드",
        description: "사무실용 키보드",
        requirements: "첨부 검증",
        attachments: [{ name: "payload.exe", type: "application/x-msdownload", size: 10 }]
      },
      markets: ["smartstore"]
    })
  });
  const payload = await response.json();

  assert.equal(response.status, 422);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "VALIDATION_ERROR");
  assert.match(payload.error.message, /unsupported attachment/i);
});

test("Given mismatched attachment extension and MIME When generation runs Then request is rejected", async (t) => {
  const app = createServer();
  const address = await listen(app);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());

  const response = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: await jsonHeaders(baseUrl),
    body: JSON.stringify({
      engine: {
        mode: "local-cli",
        engineId: "custom",
        command: `${process.execPath} scripts/mock-engine.mjs`
      },
      product: {
        name: "저소음 한글 키보드",
        description: "사무실용 키보드",
        requirements: "첨부 검증",
        attachments: [{ name: "payload.exe", type: "image/png", extension: "png", size: 10 }]
      },
      markets: ["smartstore"]
    })
  });
  const payload = await response.json();

  assert.equal(response.status, 422);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "VALIDATION_ERROR");
  assert.match(payload.error.message, /unsupported attachment/i);
});

test("Given allowed extension with disallowed MIME When generation runs Then request is rejected", async (t) => {
  const app = createServer();
  const address = await listen(app);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());

  const response = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: await jsonHeaders(baseUrl),
    body: JSON.stringify({
      engine: {
        mode: "local-cli",
        engineId: "custom",
        command: `${process.execPath} scripts/mock-engine.mjs`
      },
      product: {
        name: "저소음 한글 키보드",
        description: "사무실용 키보드",
        requirements: "첨부 검증",
        attachments: [{ name: "payload.png", type: "application/x-msdownload", kind: "image", size: 10 }]
      },
      markets: ["smartstore"]
    })
  });
  const payload = await response.json();

  assert.equal(response.status, 422);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "VALIDATION_ERROR");
  assert.match(payload.error.message, /unsupported attachment/i);
});

test("Given attachment path fields When generation runs Then only safe filename metadata is exported", async (t) => {
  const app = createServer();
  const address = await listen(app);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());

  const generated = await postJson(`${baseUrl}/api/generate`, {
    engine: {
      mode: "local-cli",
      engineId: "custom",
      command: `${process.execPath} scripts/mock-engine.mjs`,
      model: "mock"
    },
    product: {
      name: "저소음 한글 키보드",
      description: "사무실용 키보드",
      requirements: "경로 문자열은 사용하지 않음",
      attachments: [{
        name: "/Users/b./Desktop/private/desk-shot.png",
        type: "image/png",
        size: 68,
        kind: "image",
        path: "/Users/b./Desktop/private/desk-shot.png",
        webkitRelativePath: "private/desk-shot.png",
        previewDataUrl: "data:image/png;base64,iVBORw0KGgo="
      }]
    },
    markets: ["smartstore"]
  });
  const serialized = JSON.stringify(generated);

  assert.equal(generated.ok, true);
  assert.equal(generated.exports.json.product.attachments[0].name, "desk-shot.png");
  assert.doesNotMatch(serialized, /\/Users\/b\.|private\/desk-shot|webkitRelativePath|C:\\fakepath/u);
});

test("Given cross-origin text request When generation API is called Then local CLI is not executed", async (t) => {
  const app = createServer();
  const address = await listen(app);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());

  const response = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: {
      "content-type": "text/plain",
      origin: "http://malicious.example",
      "sec-fetch-site": "cross-site",
    },
    body: JSON.stringify({
      engine: {
        mode: "local-cli",
        engineId: "custom",
        command: `${process.execPath} scripts/mock-engine.mjs`
      },
      product: {
        name: "공격 상품",
        description: "외부 origin에서 보낸 요청",
        requirements: "로컬 명령 실행 시도"
      },
      markets: ["smartstore"]
    })
  });
  const payload = await response.json();

  assert.equal(response.status, 403);
  assert.equal(payload.error.code, "FORBIDDEN");
});

test("Given malformed JSON When a write API is called Then it returns a structured client error", async (t) => {
  const app = createServer();
  const address = await listen(app);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());

  const response = await fetch(`${baseUrl}/api/preflight`, {
    method: "POST",
    headers: await jsonHeaders(baseUrl),
    body: "{"
  });
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "INVALID_JSON");
});

test("Given local CLI preflight without page session When request is rejected Then it does not mention engine API tokens", async (t) => {
  const app = createServer();
  const address = await listen(app);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());

  const response = await fetch(`${baseUrl}/api/preflight`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: "local-cli",
      engineId: "custom",
      command: `${process.execPath} scripts/mock-engine.mjs`
    })
  });
  const payload = await response.json();

  assert.equal(response.status, 403);
  assert.equal(payload.error.code, "FORBIDDEN");
  assert.doesNotMatch(payload.error.message, /api token/i);
});

test("Given BYOK HTTP preflight without provider token When endpoint is configured Then token requirement stays in BYOK branch", async (t) => {
  const app = createServer();
  const address = await listen(app);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());

  const response = await fetch(`${baseUrl}/api/preflight`, {
    method: "POST",
    headers: await jsonHeaders(baseUrl),
    body: JSON.stringify({
      mode: "byok-http",
      engineId: "byok",
      byokProvider: "http://127.0.0.1:9/generate",
      model: "provider-model"
    })
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, false);
  assert.equal(payload.mode, "byok-http");
  assert.match(payload.message, /token|required/i);
  assert.doesNotMatch(payload.message, /local CLI command/i);
});

test("Given BYOK HTTP preflight with bearer auth When provider requires token Then token is sent without leaking", async (t) => {
  const app = createServer();
  const appAddress = await listen(app);
  const expectedToken = "byok-preflight-secret";
  const authProvider = createNodeServer((request, response) => {
    response.writeHead(request.headers.authorization === `Bearer ${expectedToken}` ? 204 : 401);
    response.end();
  });
  const providerAddress = await listen(authProvider);
  const baseUrl = `http://127.0.0.1:${appAddress.port}`;
  t.after(() => app.close());
  t.after(() => authProvider.close());

  const payload = await postJson(`${baseUrl}/api/preflight`, {
    mode: "byok-http",
    engineId: "byok",
    byokProvider: `http://127.0.0.1:${providerAddress.port}/generate`,
    apiKey: expectedToken,
    model: "provider-model"
  });

  assert.equal(payload.ok, true);
  assert.equal(payload.status, "available");
  assert.equal(payload.mode, "byok-http");
  assert.doesNotMatch(JSON.stringify(payload), new RegExp(expectedToken));
});

test("Given non-loopback Host When app shell or API is requested Then local token and command APIs are denied", async (t) => {
  const app = createServer();
  const address = await listen(app);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const attackerHost = `attacker.test:${address.port}`;
  t.after(() => app.close());

  const shell = await rawHttpJson(address.port, "/", { host: attackerHost });
  assert.equal(shell.status, 403);
  const shellPayload = shell.payload;
  assert.equal(shellPayload.error.code, "FORBIDDEN");

  const blocked = await rawHttpJson(address.port, "/api/generate", {
    host: attackerHost,
    origin: `http://${attackerHost}`,
    "content-type": "application/json",
    "x-store-maker-token": "stolen-or-guessed-token",
  }, {
    engine: {
      mode: "local-cli",
      engineId: "custom",
      command: `${process.execPath} scripts/mock-engine.mjs`
    },
    product: {
      name: "공격 상품",
      description: "비로컬 Host 요청",
      requirements: "토큰 우회 시도"
    },
    markets: ["smartstore"]
  });

  assert.equal(blocked.status, 403);
  assert.equal(blocked.payload.error.code, "FORBIDDEN");
});

test("Given loopback Host When app shell is requested Then local token is injected", async (t) => {
  const app = createServer();
  const address = await listen(app);
  t.after(() => app.close());

  const shell = await rawHttpText(address.port, "/", { host: `127.0.0.1:${address.port}` });

  assert.equal(shell.status, 200);
  assert.match(shell.body, /<meta name="store-maker-token" content="[^"]+"/u);
});

function rawHttpJson(port, path, headers, body) {
  return new Promise((resolveRequest, rejectRequest) => {
    const rawBody = body === undefined ? undefined : JSON.stringify(body);
    const request = requestHttp({
      host: "127.0.0.1",
      port,
      path,
      method: rawBody ? "POST" : "GET",
      headers: {
        ...headers,
        ...(rawBody ? { "content-length": Buffer.byteLength(rawBody) } : {}),
      },
    }, (response) => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        raw += chunk;
      });
      response.on("end", () => {
        resolveRequest({ status: response.statusCode, payload: JSON.parse(raw) });
      });
    });
    request.on("error", rejectRequest);
    if (rawBody) request.write(rawBody);
    request.end();
  });
}

function rawHttpText(port, path, headers) {
  return new Promise((resolveRequest, rejectRequest) => {
    const request = requestHttp({
      host: "127.0.0.1",
      port,
      path,
      method: "GET",
      headers,
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        resolveRequest({ status: response.statusCode, body });
      });
    });
    request.on("error", rejectRequest);
    request.end();
  });
}

test("Given missing CLI When preflight runs Then failure explains the command problem", async (t) => {
  const app = createServer();
  const address = await listen(app);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());

  const preflight = await postJson(`${baseUrl}/api/preflight`, {
    mode: "local-cli",
    engineId: "codex",
    command: "definitely-missing-store-maker-cli"
  });

  assert.equal(preflight.ok, false);
  assert.equal(preflight.status, "missing");
  assert.match(preflight.message, /not found|ENOENT|missing/i);
});

test("Given local CLI ignores SIGTERM When timeout expires Then generation returns structured timeout failure", async (t) => {
  const app = createServer();
  const address = await listen(app);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());

  const stubbornCommand = `${process.execPath} -e "process.on('SIGTERM',()=>{}); setTimeout(()=>{process.stdout.write('late success'); process.exit(0)},400); setInterval(()=>{},1000)"`;
  const response = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: await jsonHeaders(baseUrl),
    body: JSON.stringify({
      engine: {
        mode: "local-cli",
        engineId: "custom",
        command: stubbornCommand,
        timeoutMs: 80
      },
      product: {
        name: "저소음 한글 키보드",
        description: "사무실용 키보드",
        requirements: "저소음과 한글 각인 강조"
      },
      markets: ["smartstore"]
    })
  });
  const payload = await response.json();

  assert.equal(response.status, 422);
  assert.equal(payload.ok, false);
  assert.match(payload.error.message, /timed out/i);
  assert.doesNotMatch(payload.error.message, /^Local CLI timed out after 80ms$/);
  assert.match(payload.error.message, /Custom CLI|custom/i);
  assert.match(payload.error.message, /copy|단계|작업/i);
  assert.ok(payload.logs.some((log) => log.title === "local CLI timed out"));
});

test("Given static server When source paths are requested Then only public app files are served", async (t) => {
  const app = createServer();
  const address = await listen(app);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());

  const appResponse = await fetch(`${baseUrl}/assets/app.js`);
  assert.equal(appResponse.status, 200);

  for (const path of ["/server.mjs", "/lib/server/engines.mjs", "/tests/store-maker.test.mjs", "/.omx/notepad.md", "/assets/%2e%2e/server.mjs"]) {
    const response = await fetch(`${baseUrl}${path}`);
    assert.notEqual(response.status, 200, `${path} must not be public`);
  }
});

test("Given malformed asset URL When static server parses it Then it returns not found without leaking internals", async (t) => {
  const app = createServer();
  const address = await listen(app);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());

  const response = await fetch(`${baseUrl}/assets/%ZZ`);
  const payload = await response.json();

  assert.equal(response.status, 404);
  assert.equal(payload.error.code, "NOT_FOUND");
});

test("Given unreachable BYOK provider When preflight runs Then it does not report available", async (t) => {
  const app = createServer();
  const address = await listen(app);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());

  const preflight = await postJson(`${baseUrl}/api/preflight`, {
    mode: "byok",
    engineId: "byok",
    byokProvider: "http://127.0.0.1:9/generate",
    model: "provider-model"
  });

  assert.equal(preflight.ok, false);
  assert.equal(preflight.status, "failed");
});

test("Given hanging BYOK provider When generation runs Then timeout error is returned", async (t) => {
  const app = createServer();
  const appAddress = await listen(app);
  const hangingProvider = createNodeServer(() => {});
  const providerAddress = await listen(hangingProvider);
  const baseUrl = `http://127.0.0.1:${appAddress.port}`;
  t.after(() => app.close());
  t.after(() => {
    hangingProvider.closeAllConnections();
    hangingProvider.close();
  });

  const response = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: await jsonHeaders(baseUrl),
    body: JSON.stringify({
      engine: {
        mode: "byok",
        engineId: "byok",
        byokProvider: `http://127.0.0.1:${providerAddress.port}/generate`,
        model: "provider-model",
        apiKey: "sk-test-store-maker-secret",
        timeoutMs: 80
      },
      product: {
        name: "저소음 한글 키보드",
        description: "사무실용 키보드",
        requirements: "저소음과 한글 각인 강조",
        materials: ["desk-shot.png"]
      },
      markets: ["smartstore"]
    })
  });
  const payload = await response.json();

  assert.equal(response.status, 422);
  assert.equal(payload.ok, false);
  assert.match(payload.error.message, /timed out|aborted/i);
  assert.ok(payload.logs.some((log) => log.title === "BYOK request failed"));
  assert.doesNotMatch(JSON.stringify(payload), /sk-test-store-maker-secret/);
});

async function listen(app) {
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  const address = app.address();
  assert.equal(typeof address, "object");
  assert.notEqual(address, null);
  return address;
}

async function generateWithImageCount(t, baseUrl, options) {
  const generated = await postJson(`${baseUrl}/api/generate`, imageGenerationBody(options));
  t.after(() => cleanupImageOutputsFromPayload(generated));
  return generated;
}

function imageGenerationBody({ imageCount, command = "./scripts/fake-codex-imagegen.mjs", timeoutMs = 2000, style = "제품 단독컷", moodMode, sameMoodCount, variedMoodCount }) {
  return {
    engine: {
      mode: "local-cli",
      engineId: "custom",
      command: `${process.execPath} scripts/mock-engine.mjs`,
      model: "mock"
    },
    imageGeneration: {
      provider: "codex-imagegen",
      command,
      imageCount,
      ...(moodMode ? { moodMode } : {}),
      ...(sameMoodCount !== undefined ? { sameMoodCount } : {}),
      ...(variedMoodCount !== undefined ? { variedMoodCount } : {}),
      ratio: "1:1",
      style,
      background: "흰 배경",
      useReference: false,
      timeoutMs
    },
    product: {
      name: `이미지 ${imageCount}개 검증 상품`,
      description: "사무실용 키보드와 데스크 주변용 상품",
      requirements: "요청한 개수만큼 독립 이미지 파일을 생성하고 export에 포함"
    },
    markets: ["smartstore"]
  };
}

async function cleanupImageOutputsFromPayload(payload) {
  const serialized = JSON.stringify(payload);
  const dirs = new Set(serialized.match(/outputs\/image-runs\/[0-9a-f-]+/gu) ?? []);
  for (const dir of dirs) {
    await rm(new URL(`../${dir}/`, import.meta.url), { recursive: true, force: true });
  }
}

async function payloadImageHashes(payload) {
  const outputDir = payload?.result?.images?.outputDir;
  const files = payload?.result?.images?.files ?? [];
  return Promise.all(files.map(async (file) => {
    const buffer = await readFile(new URL(`../${outputDir}/${file.filename}`, import.meta.url));
    return createHash("sha256").update(buffer).digest("hex");
  }));
}

async function waitForJob(baseUrl, jobId, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastJob;
  while (Date.now() < deadline) {
    const payload = await getJson(`${baseUrl}/api/generate-jobs/${encodeURIComponent(jobId)}`);
    lastJob = payload.job;
    if (predicate(lastJob)) return lastJob;
    await delay(100);
  }
  assert.fail(`Timed out waiting for job ${jobId}; last=${JSON.stringify(lastJob)}`);
}

async function getJson(url) {
  const response = await fetch(url, { headers: await jsonHeaders(new URL(url).origin) });
  const payload = await response.json();
  if (!response.ok) {
    assert.fail(`Unexpected HTTP ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: await jsonHeaders(new URL(url).origin),
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok) {
    assert.fail(`Unexpected HTTP ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function jsonHeaders(baseUrl) {
  const token = await readLocalToken(baseUrl);
  return { "content-type": "application/json", "x-store-maker-token": token };
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function readLocalToken(baseUrl) {
  const response = await fetch(baseUrl);
  const html = await response.text();
  const match = html.match(/<meta name="store-maker-token" content="([^"]+)"/u);
  assert.ok(match, "Store Maker local token meta tag must be present");
  return match[1];
}

test("Given static UI When index is read Then it remains a standalone app shell", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /Store Maker/);
  assert.match(html, /name="generation-mode"/);
  assert.match(html, /id="brand-url"/);
  assert.match(html, /id="ad-mood-preset"/);
  assert.match(html, /id="ad-options-panel"/);
  assert.match(html, /id="material-dropzone"/);
  assert.match(html, /id="material-file-input"/);
  assert.match(html, /data-image-provider="codex-imagegen"/);
  assert.match(html, /id="image-count"/);
  assert.match(html, /id="image-style"/);
  assert.ok(imageStyleOptions.includes("자동 다양화"));
  assert.ok(imageStyleOptions.includes("정보형 인포그래픽"));
  assert.equal(maxImageCount, 20);
  assert.match(html, /multiple/);
  assert.match(html, /\.png,.jpg,.jpeg,.webp,.pdf,.txt,.md,.csv/);
  assert.doesNotMatch(html, /textarea id="materials"/);
  assert.doesNotMatch(html, /\/api\/sangselab/);
});
