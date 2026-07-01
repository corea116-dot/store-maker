#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const args = process.argv.slice(2);
const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);

if (args.includes("--version") || args.includes("-V")) {
  process.stdout.write("codex-cli-imagegen 999.0.0-test\n");
  process.exit(0);
}

const execIndex = args.indexOf("exec");
if (execIndex < 0) {
  process.stderr.write("fake imagegen codex expects exec subcommand\n");
  process.exit(2);
}
const execArgs = args.slice(execIndex + 1);

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
  const outputDir = field(prompt, "OUTPUT_DIR");
  if (!outputDir) {
    process.stderr.write("missing OUTPUT_DIR in prompt\n");
    process.exit(2);
  }
  if (!prompt.includes("$imagegen")) {
    process.stderr.write("missing $imagegen instruction\n");
    process.exit(2);
  }

  await mkdir(outputDir, { recursive: true });
  if (args.includes("--write-codex-home-output")) {
    const generatedImagesDir = join(process.env.CODEX_HOME ?? process.cwd(), "generated_images");
    await mkdir(generatedImagesDir, { recursive: true });
    await writeFile(join(generatedImagesDir, `ig_${Date.now()}.png`), tinyPng);
  } else if (!args.includes("--no-image-output")) {
    await writeFile(join(outputDir, "product-main.png"), tinyPng);
    if (!execArgs.includes("--no-manifest")) {
      await writeFile(join(outputDir, "manifest.json"), JSON.stringify({
        provider: "codex-imagegen",
        promptIncludesImagegen: true,
        imageInputs: imageArgs(args).map((file) => basename(file)),
        source: { generatedImagePath: `${process.cwd()}/private-source.png` },
        files: ["product-main.png"],
      }, null, 2));
    }
  }
  await writeFile(outputPath, "fake codex imagegen completed");
  if (execArgs.includes("--hang-after-output")) {
    setInterval(() => {}, 1000);
  }
});

function optionValue(values, name) {
  const index = values.indexOf(name);
  return index >= 0 ? values[index + 1] : undefined;
}

function imageArgs(values) {
  const found = [];
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === "--image" || values[index] === "-i") found.push(values[index + 1]);
  }
  return found.filter(Boolean);
}

function field(value, label) {
  const match = value.match(new RegExp(`^${label}:\\s*(.+)$`, "mu"));
  return match?.[1]?.trim();
}
