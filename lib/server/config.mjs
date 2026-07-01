import { fileURLToPath } from "node:url";
import { join } from "node:path";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const LOG_DIR = join(ROOT, ".omx", "logs");
export const IMAGE_RUNS_DIR = join(ROOT, "outputs", "image-runs");
export const IMAGE_UPLOADS_DIR = join(ROOT, "outputs", "uploads");
export const PREFLIGHT_TIMEOUT_MS = 5000;
export const GENERATE_TIMEOUT_MS = 30000;
export const IMAGEGEN_TIMEOUT_MS = 300000;
export const OUTPUT_LIMIT = 12000;
export const MAX_JSON_BODY_BYTES = 16_000_000;
