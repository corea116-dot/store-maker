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

function optionValue(values, name) {
  const index = values.indexOf(name);
  return index >= 0 ? values[index + 1] : undefined;
}

function matchField(prompt, label) {
  const pattern = new RegExp(`^[-*] ${label}:\\s*(.+)$`, "mu");
  const match = prompt.match(pattern);
  return match?.[1]?.trim();
}
