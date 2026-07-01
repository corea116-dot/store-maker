import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer as createNodeServer, request as requestHttp } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createServer } from "../server.mjs";

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
      materials: ["desk-shot.png", "battery-spec.pdf"]
    },
    markets: ["smartstore", "coupang"]
  });

  assert.equal(generated.ok, true);
  assert.match(generated.prompt, /저소음 한글 키보드/);
  assert.match(generated.prompt, /desk-shot\.png/);
  assert.match(generated.prompt, /smartstore, coupang/);
  assert.match(generated.result.markdown, /저소음 한글 키보드 상세페이지 초안/);
  assert.equal(generated.exports.json.product.name, "저소음 한글 키보드");
  assert.ok(generated.logs.some((log) => log.message.includes("prompt delivered")));
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
      count: 1,
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
  assert.equal(generated.result.images.manifest?.fallback, true);
  assert.ok(generated.logs.some((log) => log.title === "image output imported"));
  assert.ok(generated.logs.some((log) => log.title === "fallback manifest created"));
  assert.doesNotMatch(serialized, /\/var\/|\/Users\/b\./u);

  const imageResponse = await fetch(`${baseUrl}${generated.result.images.files[0].url}`);
  assert.equal(imageResponse.status, 200);
  assert.equal(imageResponse.headers.get("content-type"), "image/png");
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
      count: 1,
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
  assert.equal(generated.result.images.manifest?.fallback, true);
  assert.equal(generated.result.images.manifest?.files?.[0]?.filename, "product-main.png");
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
  assert.match(html, /id="material-dropzone"/);
  assert.match(html, /id="material-file-input"/);
  assert.match(html, /data-image-provider="codex-imagegen"/);
  assert.match(html, /id="image-count"/);
  assert.match(html, /multiple/);
  assert.match(html, /\.png,.jpg,.jpeg,.webp,.pdf,.txt,.md,.csv/);
  assert.doesNotMatch(html, /textarea id="materials"/);
  assert.doesNotMatch(html, /\/api\/sangselab/);
});
