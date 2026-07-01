#!/usr/bin/env node

const args = process.argv.slice(2);

if (args.includes("--version")) {
  process.stdout.write("prompt-probe-engine 1.0.0\n");
  process.exit(0);
}

const mode = optionValue(args, "--mode") ?? "stdin";

if (mode === "last-arg") {
  process.stdout.write(render(args.at(-1) ?? ""));
  process.exit(0);
}

if (mode === "prompt-file") {
  const promptFile = args.at(-1);
  if (!promptFile) {
    process.stderr.write("missing prompt file path\n");
    process.exit(2);
  }
  const { readFile } = await import("node:fs/promises");
  process.stdout.write(render(await readFile(promptFile, "utf8")));
  process.exit(0);
}

let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  prompt += chunk;
});
process.stdin.on("end", () => {
  process.stdout.write(render(prompt));
});

function optionValue(values, name) {
  const index = values.indexOf(name);
  return index >= 0 ? values[index + 1] : undefined;
}

function render(prompt) {
  const productName = matchField(prompt, "상품명") ?? "상품";
  const markets = matchField(prompt, "목표 마켓") ?? "smartstore";
  return [`# ${productName} 상세페이지 초안`, "", `- 대상 마켓: ${markets}`, "- prompt probe ok"].join("\n");
}

function matchField(prompt, label) {
  const pattern = new RegExp(`^[-*] ${label}:\\s*(.+)$`, "mu");
  const match = prompt.match(pattern);
  return match?.[1]?.trim();
}
