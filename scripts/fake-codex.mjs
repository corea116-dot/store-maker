#!/usr/bin/env node

const args = process.argv.slice(2);

if (args.includes("--version") || args.includes("-V")) {
  process.stdout.write("codex-cli 999.0.0-test\n");
  process.exit(0);
}

if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write("Usage: codex exec [OPTIONS] [PROMPT]\n  -o, --output-last-message <FILE>\n");
  process.exit(0);
}

if (args[0] !== "exec") {
  process.stderr.write("fake codex expects exec subcommand\n");
  process.exit(2);
}

const outputPath = optionValue(args, "--output-last-message") ?? optionValue(args, "-o");
if (!outputPath) {
  process.stderr.write("missing --output-last-message\n");
  process.exit(2);
}

let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  prompt += chunk;
});

process.stdin.on("end", async () => {
  if (prompt.includes("You create a Store Maker detail-page candidate.")) {
    await import("node:fs/promises").then(({ writeFile }) => writeFile(outputPath, builderCandidateJson(prompt)));
    process.stderr.write("fake codex candidate completed\n");
    return;
  }
  const productName = matchField(prompt, "상품명") ?? "상품";
  const markets = matchField(prompt, "목표 마켓") ?? "smartstore";
  const output = [
    `# ${productName} 상세페이지 초안`,
    "",
    `- 대상 마켓: ${markets}`,
    "- Codex adapter: final message file captured",
    "- 프롬프트 전달: 상품명과 목표 마켓을 확인했습니다.",
  ].join("\n");
  await import("node:fs/promises").then(({ writeFile }) => writeFile(outputPath, output));
  process.stderr.write("fake codex completed\n");
});

function builderCandidateJson(value) {
  const operation = value.match(/Operation:\s*([^;]+);\s*mode:\s*([^;]+);\s*allowed JSON keys:\s*([^.]*)\./u);
  const mode = operation?.[2]?.trim() ?? "add";
  const keys = new Set((operation?.[3] ?? "").split(",").map((key) => key.trim()).filter(Boolean));
  if (mode === "copy") return JSON.stringify({ heading: "AI가 다듬은 핵심 제목", body: "상품의 핵심 가치를 짧고 이해하기 쉽게 설명합니다.", bullets: ["확인 가능한 정보 중심", "구매 전 이해를 돕는 문장"] });
  if (mode === "layout") return JSON.stringify({ layout: "split-left" });
  if (mode === "whole") return JSON.stringify({ kind: "benefits", layout: "text-only", heading: "AI가 정리한 핵심 장점", body: "구매 판단에 필요한 정보를 정리했습니다.", bullets: ["핵심 장점", "사용 맥락"] });
  if (keys.has("type")) return JSON.stringify({ type: "faq", heading: "AI 후보 FAQ", body: "구매 전에 자주 확인하는 내용을 안내합니다.", bullets: ["확인 후 선택하세요"], layout: "text-only" });
  return JSON.stringify({});
}

function optionValue(values, name) {
  const index = values.indexOf(name);
  return index >= 0 ? values[index + 1] : undefined;
}

function matchField(prompt, label) {
  const pattern = new RegExp(`^[-*] ${label}:\\s*(.+)$`, "mu");
  const match = prompt.match(pattern);
  return match?.[1]?.trim();
}
