import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createGenerationJobManager } from "../lib/server/jobs.mjs";

test("Given 26 persistent terminal jobs When history settles Then only the latest 25 survive an orderly restart", async (t) => {
  // Given: an isolated persistent manager whose jobs finish one at a time.
  const root = await mkdtemp(join(tmpdir(), "store-maker-brand-retention-"));
  const stateFile = join(root, "jobs.json");
  const manager = createGenerationJobManager({ stateFile, run: async () => ({ ok: true, logs: [], result: {}, exports: {} }) });
  t.after(() => rm(root, { recursive: true, force: true }));

  // When: the manager completes a 26th persistent job and flushes quiescent state.
  const completed = [];
  for (let index = 0; index < 26; index += 1) {
    const started = await manager.start({ product: { name: `보존 경계 ${index + 1}` } });
    completed.push(await waitForTerminal(manager, started.id));
  }
  await manager.flush();

  // Then: disk and orderly restart expose exactly the same latest 25 terminal records.
  const listed = await manager.list();
  const stored = JSON.parse(await readFile(stateFile, "utf8"));
  const restarted = createGenerationJobManager({ stateFile, run: async () => ({ ok: true }) });
  const expectedIds = [...completed].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)
    || Date.parse(right.startedAt) - Date.parse(left.startedAt)
    || Date.parse(right.finishedAt) - Date.parse(left.finishedAt)
    || Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    || right.id.localeCompare(left.id)).slice(0, 25).map((job) => job.id);
  assert.deepEqual(listed.map((job) => job.id), expectedIds);
  assert.deepEqual(stored.jobs.map((job) => job.id), expectedIds);
  assert.deepEqual((await restarted.list()).map((job) => job.id), expectedIds);
});

async function waitForTerminal(manager, id) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const job = await manager.get(id);
    if (["completed", "failed", "cancelled"].includes(job?.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for terminal retention fixture");
}
