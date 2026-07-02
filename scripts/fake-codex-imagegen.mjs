#!/usr/bin/env node

import { mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { deflateSync } from "node:zlib";
import { maxImageCount, minImageCount } from "../assets/image-options.js";

const args = process.argv.slice(2);
const crcTable = buildCrcTable();

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
  const requestedCount = boundedCount(
    numberField(prompt, "GENERATE_IMAGE_COUNT")
      ?? numberField(prompt, "REQUESTED_IMAGE_COUNT")
      ?? numberField(prompt, "생성 개수")
      ?? 1,
  );
  const startIndex = Math.max(1, numberField(prompt, "RETRY_IMAGE_START_INDEX") ?? 1);
  const existingCount = await countExistingImages(outputDir);
  const cappedCount = capOutputCount(requestedCount, existingCount);
  const duplicateOutput = args.includes("--duplicate-output")
    || (args.includes("--duplicate-first-pass") && !prompt.includes("DUPLICATE_REPAIR_MODE"));
  if (args.includes("--write-codex-home-output")) {
    const generatedImagesDir = join(process.env.CODEX_HOME ?? process.cwd(), "generated_images");
    await mkdir(generatedImagesDir, { recursive: true });
    for (let offset = 0; offset < cappedCount; offset += 1) {
      const index = startIndex + offset;
      await writeFile(join(generatedImagesDir, `ig_${Date.now()}_${offset + 1}.png`), pngForIndex(duplicateOutput ? 1 : index));
    }
  } else if (!args.includes("--no-image-output")) {
    const files = [];
    for (let offset = 0; offset < cappedCount; offset += 1) {
      const index = startIndex + offset;
      const filename = imageFilename(index);
      files.push(filename);
      await writeFile(join(outputDir, filename), pngForIndex(duplicateOutput ? 1 : index));
    }
    if (!execArgs.includes("--no-manifest")) {
      await writeFile(join(outputDir, "manifest.json"), JSON.stringify({
        provider: "codex-imagegen",
        promptIncludesImagegen: true,
        requestedImageCount: requestedCount,
        generatedImageCount: files.length,
        imageInputs: imageArgs(args).map((file) => basename(file)),
        source: { generatedImagePath: `${process.cwd()}/private-source.png` },
        files,
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

function numberField(value, label) {
  const raw = field(value, label);
  const match = raw?.match(/^-?\d+/u);
  if (!match) return undefined;
  const parsed = Number.parseInt(match[0], 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function boundedCount(value) {
  return Math.max(minImageCount, Math.min(maxImageCount, value));
}

function capOutputCount(requestedCount, existingCount) {
  const limit = numberOption("--limit-images");
  const cap = numberOption("--cap-output-images");
  let writable = requestedCount;
  if (Number.isSafeInteger(limit)) writable = Math.min(writable, Math.max(0, limit));
  if (Number.isSafeInteger(cap)) writable = Math.min(writable, Math.max(0, cap - existingCount));
  return Math.max(0, writable);
}

function numberOption(name) {
  const value = optionValue(args, name);
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

async function countExistingImages(outputDir) {
  try {
    const entries = await readdir(outputDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && /\.(?:png|jpe?g|webp)$/iu.test(entry.name)).length;
  } catch (error) {
    return 0;
  }
}

function imageFilename(index) {
  return index === 1 ? "product-main.png" : `product-main-${String(index).padStart(2, "0")}.png`;
}

function pngForIndex(index) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const pixel = Buffer.from([
    0,
    (index * 53) % 256,
    (index * 97) % 256,
    (index * 193) % 256,
    255,
  ]);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(pixel)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function buildCrcTable() {
  return Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    return value >>> 0;
  });
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
