#!/usr/bin/env node

const args = process.argv.slice(2);

if (args.includes("--version")) {
  process.stdout.write("store-maker-mock-engine 1.0.0\n");
  process.exit(0);
}

let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  prompt += chunk;
});

process.stdin.on("end", () => {
  if (prompt.includes("You create a Store Maker detail-page candidate.")) {
    process.stdout.write(builderCandidateJson(prompt));
    return;
  }
  const productName = matchField(prompt, "상품명") ?? "상품";
  const markets = matchField(prompt, "목표 마켓") ?? "스마트스토어";
  const requirements = matchField(prompt, "요구사항") ?? "요구사항 없음";
  const output = [
    `# ${productName} 상세페이지 초안`,
    "",
    `- 대상 마켓: ${markets}`,
    `- 핵심 요구사항: ${requirements}`,
    "- 카테고리 분석: 사무/생활용품 > 프리미엄 작업 도구",
    "- 상세 문구: 오래 쓰는 소재와 실제 사용 장면을 먼저 보여주세요.",
    "- 이미지 프롬프트: 자연광 책상 위 사용컷, 구성품 정렬컷, 전후 비교컷",
    "",
    "## 마켓 변환",
    "스마트스토어는 검색 키워드와 혜택을 앞에 두고, 쿠팡은 빠른 이해와 옵션 정보를 먼저 배치합니다.",
  ].join("\n");
  process.stdout.write(output);
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

function matchField(prompt, label) {
  const pattern = new RegExp(`^[-*] ${label}:\\s*(.+)$`, "mu");
  const match = prompt.match(pattern);
  return match?.[1]?.trim();
}
