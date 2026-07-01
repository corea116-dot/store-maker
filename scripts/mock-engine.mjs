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

function matchField(prompt, label) {
  const pattern = new RegExp(`^[-*] ${label}:\\s*(.+)$`, "mu");
  const match = prompt.match(pattern);
  return match?.[1]?.trim();
}
