import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ROOT } from "./config.mjs";
import { logEntry } from "./logs.mjs";

const JOB_HISTORY_LIMIT = 25;
const JOB_STATE_FILE = join(ROOT, ".omx", "state", "store-maker-generation-jobs.json");
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

export function createGenerationJobManager({ run }) {
  const jobs = new Map();
  let history = [];
  let queue = [];
  let activeJobId;
  let persistChain = Promise.resolve();
  const ready = loadHistory();

  return {
    async start(body, options = {}) {
      await ready;
      const now = new Date().toISOString();
      const job = {
        id: randomUUID(),
        ephemeral: options.ephemeral === true,
        status: "queued",
        title: generationTitle(body),
        createdAt: now,
        updatedAt: now,
        startedAt: undefined,
        finishedAt: undefined,
        elapsedMs: 0,
        logs: [logEntry("info", "job queued", "생성 작업을 큐에 등록했습니다.")],
        result: undefined,
        error: undefined,
        body,
        controller: new AbortController(),
      };
      jobs.set(job.id, job);
      history.unshift(job);
      queue.push(job.id);
      trimHistory();
      void persistHistory();
      pump();
      return publicJob(job, { includeResult: true });
    },

    async list(options = {}) {
      await ready;
      return sortedHistory()
        .filter((job) => options.includeEphemeral === true || !job.ephemeral)
        .map((job) => publicJob(job, { includeResult: false }));
    },

    async get(id) {
      await ready;
      const job = jobs.get(id);
      return job ? publicJob(job, { includeResult: true }) : undefined;
    },

    async cancel(id) {
      await ready;
      const job = jobs.get(id);
      if (!job) return undefined;
      if (TERMINAL_STATUSES.has(job.status)) return publicJob(job, { includeResult: true });

      if (job.status === "queued") {
        queue = queue.filter((queuedId) => queuedId !== id);
        job.controller?.abort();
        markCancelled(job, "대기 중이던 생성 작업을 취소했습니다.");
        void persistHistory();
        pump();
        return publicJob(job, { includeResult: true });
      }

      job.status = "cancelling";
      job.updatedAt = new Date().toISOString();
      job.logs.push(logEntry("warning", "job cancellation requested", "사용자가 생성 취소를 요청했습니다. 실행 중인 provider를 정리합니다."));
      job.controller?.abort();
      void persistHistory();
      return publicJob(job, { includeResult: true });
    },

    async delete(id) {
      await ready;
      const job = jobs.get(id);
      if (!job) return { status: "missing" };
      if (!TERMINAL_STATUSES.has(job.status)) return { status: "active", job: publicJob(job, { includeResult: false }) };
      jobs.delete(id);
      history = history.filter((historyJob) => historyJob.id !== id);
      void persistHistory();
      return { status: "deleted" };
    },
  };

  async function loadHistory() {
    try {
      const parsed = JSON.parse(await readFile(JOB_STATE_FILE, "utf8"));
      const loadedJobs = Array.isArray(parsed.jobs) ? parsed.jobs.map(hydrateStoredJob) : [];
      history = sortJobsByNewestCreated(loadedJobs.filter(Boolean)).slice(0, JOB_HISTORY_LIMIT);
      for (const job of history) jobs.set(job.id, job);
    } catch (error) {
      history = [];
    }
  }

  function pump() {
    if (activeJobId) return;
    const nextId = queue.shift();
    if (!nextId) return;
    const job = jobs.get(nextId);
    if (!job || job.status !== "queued") {
      queueMicrotask(pump);
      return;
    }
    activeJobId = job.id;
    void runOne(job).finally(() => {
      activeJobId = undefined;
      pump();
    });
  }

  async function runOne(job) {
    if (job.controller.signal.aborted) {
      markCancelled(job, "생성 작업 시작 전에 취소되었습니다.");
      job.body = undefined;
      job.controller = undefined;
      trimHistory();
      void persistHistory();
      return;
    }

    job.status = "running";
    job.startedAt = new Date().toISOString();
    job.updatedAt = job.startedAt;
    job.logs.push(logEntry("info", "job running", "생성 작업을 시작했습니다. 페이지를 새로고침해도 작업 상태를 다시 불러올 수 있습니다."));
    void persistHistory();

    try {
      const result = await run(job.body, { signal: job.controller.signal });
      finishFromResult(job, result);
    } catch (error) {
      if (job.controller.signal.aborted) {
        markCancelled(job, errorMessage(error, "생성 작업이 취소되었습니다."));
      } else {
        const message = errorMessage(error, "Unexpected generation job failure");
        job.status = "failed";
        job.error = { code: "INTERNAL_ERROR", message };
        job.result = {
          ok: false,
          logs: [logEntry("error", "generation failed", message)],
          error: job.error,
        };
        job.logs.push(logEntry("error", "job failed", message));
      }
      finishJob(job);
    } finally {
      job.body = undefined;
      job.controller = undefined;
      trimHistory();
      void persistHistory();
    }
  }

  function finishFromResult(job, result) {
    if (job.controller.signal.aborted || result?.error?.code === "CANCELLED") {
      markCancelled(job, result?.error?.message ?? "생성 작업이 취소되었습니다.", result);
      finishJob(job);
      return;
    }
    job.result = result;
    if (result?.ok) {
      job.status = "completed";
      job.error = undefined;
      job.logs.push(logEntry("success", "job completed", "생성 작업이 완료되어 결과를 저장했습니다."));
    } else {
      job.status = "failed";
      job.error = result?.error ?? { code: "GENERATION_FAILED", message: "생성 작업이 실패했습니다." };
      job.logs.push(logEntry("error", "job failed", job.error.message));
    }
    finishJob(job);
  }

  function markCancelled(job, message, result) {
    job.status = "cancelled";
    job.error = { code: "CANCELLED", message };
    job.result = result?.ok
      ? undefined
      : result ?? {
        ok: false,
        logs: [logEntry("warning", "generation cancelled", message)],
        error: job.error,
      };
    job.logs.push(logEntry("warning", "job cancelled", message));
    finishJob(job);
  }

  function finishJob(job) {
    const now = new Date().toISOString();
    job.updatedAt = now;
    job.finishedAt ??= TERMINAL_STATUSES.has(job.status) ? now : undefined;
    job.elapsedMs = elapsedMs(job);
  }

  function persistHistory() {
    const snapshot = JSON.stringify({
      version: 1,
      jobs: history.filter((job) => !job.ephemeral).map((job) => storedJob(job)),
    }, null, 2);
    persistChain = persistChain
      .then(async () => {
        await mkdir(join(ROOT, ".omx", "state"), { recursive: true });
        await writeFile(JOB_STATE_FILE, snapshot);
      })
      .catch(() => {});
    return persistChain;
  }

  function trimHistory() {
    const active = history.filter((job) => !TERMINAL_STATUSES.has(job.status));
    const terminal = history.filter((job) => TERMINAL_STATUSES.has(job.status));
    const persistentTerminal = sortJobsByNewestCreated(terminal.filter((job) => !job.ephemeral)).slice(0, JOB_HISTORY_LIMIT);
    const ephemeralTerminal = sortJobsByNewestCreated(terminal.filter((job) => job.ephemeral)).slice(0, JOB_HISTORY_LIMIT);
    history = sortJobsByNewestCreated([...active, ...persistentTerminal, ...ephemeralTerminal]);
  }

  function sortedHistory() {
    return sortJobsByNewestCreated(history);
  }
}

function sortJobsByNewestCreated(items) {
  return [...items].sort(compareJobsByNewestCreated);
}

function compareJobsByNewestCreated(left, right) {
  return timestamp(right.createdAt) - timestamp(left.createdAt)
    || timestamp(right.startedAt) - timestamp(left.startedAt)
    || timestamp(right.finishedAt) - timestamp(left.finishedAt)
    || timestamp(right.updatedAt) - timestamp(left.updatedAt)
    || String(right.id).localeCompare(String(left.id));
}

function timestamp(value) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function hydrateStoredJob(value) {
  if (typeof value !== "object" || value === null || typeof value.id !== "string") return undefined;
  const status = ["queued", "running", "cancelling", "completed", "failed", "cancelled"].includes(value.status)
    ? value.status
    : "failed";
  const job = {
    id: value.id,
    status,
    title: typeof value.title === "string" ? value.title : "생성 작업",
    createdAt: readIso(value.createdAt),
    updatedAt: readIso(value.updatedAt),
    startedAt: readOptionalIso(value.startedAt),
    finishedAt: readOptionalIso(value.finishedAt),
    elapsedMs: Number.isSafeInteger(value.elapsedMs) ? value.elapsedMs : 0,
    logs: Array.isArray(value.logs) ? value.logs : [],
    result: value.result,
    error: value.error,
    body: undefined,
    controller: undefined,
  };
  if (!TERMINAL_STATUSES.has(job.status)) {
    job.status = "failed";
    job.error = { code: "SERVER_RESTARTED", message: "서버가 재시작되어 진행 중이던 작업을 이어서 실행할 수 없습니다." };
    job.result = { ok: false, logs: [logEntry("error", "job failed", job.error.message)], error: job.error };
    job.finishedAt = new Date().toISOString();
    job.updatedAt = job.finishedAt;
  }
  return job;
}

function storedJob(job) {
  return {
    id: job.id,
    status: job.status,
    title: job.title,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    elapsedMs: elapsedMs(job),
    hasResult: Boolean(job.result),
    error: job.error,
    logs: job.logs ?? [],
    ...(job.result ? { result: job.result } : {}),
  };
}

function publicJob(job, { includeResult }) {
  return {
    id: job.id,
    status: job.status,
    title: job.title,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    elapsedMs: elapsedMs(job),
    hasResult: Boolean(job.result),
    error: job.error,
    logs: [...(job.logs ?? []), ...(includeResult ? job.result?.logs ?? [] : [])],
    ...(includeResult && job.result ? { result: job.result } : {}),
  };
}

function elapsedMs(job) {
  const start = Date.parse(job.startedAt ?? job.createdAt);
  if (!Number.isFinite(start)) return 0;
  const end = job.finishedAt ? Date.parse(job.finishedAt) : Date.now();
  return Math.max(0, end - start);
}

function generationTitle(body) {
  const productName = typeof body?.product?.name === "string" && body.product.name.trim()
    ? body.product.name.trim()
    : "이름 없는 상품";
  const mode = body?.generationMode === "ad-set" ? "광고 세트" : "상세페이지";
  const count = body?.imageGeneration?.imageCount ?? body?.imageGeneration?.count;
  const suffix = Number.isSafeInteger(Number(count)) ? ` · 이미지 ${count}개` : "";
  return `${truncate(productName, 80)} · ${mode}${suffix}`;
}

function truncate(value, maxLength) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function errorMessage(error, fallback) {
  return error instanceof Error ? error.message : fallback;
}

function readIso(value) {
  return readOptionalIso(value) ?? new Date().toISOString();
}

function readOptionalIso(value) {
  if (typeof value !== "string") return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? value : undefined;
}
