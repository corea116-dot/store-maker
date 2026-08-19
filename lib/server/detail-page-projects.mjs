import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DETAIL_PAGE_PROJECTS_DIR, IMAGE_RUNS_DIR } from "./config.mjs";
import {
  DetailPageDocumentValidationError,
  migrateDetailPageDocument,
  normalizeDetailPageDocument,
} from "./detail-page-document.mjs";
import { parseOutputImageUrl } from "./detail-page-schema.mjs";
import { openContainedRegularFile } from "./safe-files.mjs";

const PROJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class ProjectRevisionConflictError extends Error {
  constructor(currentProject) {
    super(`Expected a different revision; current revision is ${currentProject.revision}`);
    this.name = "ProjectRevisionConflictError";
    this.currentProject = currentProject;
  }
}

export class ProjectStoreInvalidError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "ProjectStoreInvalidError";
  }
}

export class ProjectStoreWriteError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "ProjectStoreWriteError";
  }
}

export class ProjectRecoveryConflictError extends Error {
  constructor() {
    super("The corrupt project changed before recovery could be confirmed");
    this.name = "ProjectRecoveryConflictError";
  }
}

export function createDetailPageProjectStore(options = {}) {
  const directory = options.directory ?? DETAIL_PAGE_PROJECTS_DIR;
  const imageRunsDirectory = options.imageRunsDirectory ?? IMAGE_RUNS_DIR;
  const now = options.now ?? (() => new Date().toISOString());
  const writeChains = new Map();

  return {
    get(id) {
      assertProjectId(id);
      return readProject(id);
    },

    getRecovery(id) {
      assertProjectId(id);
      return exclusive(id, () => getRecovery(id));
    },

    create(id, document) {
      assertProjectId(id);
      return exclusive(id, async () => {
        const existing = await readProject(id);
        if (existing) return existing;
        const normalized = normalizeDetailPageDocument(document);
        await assertImagesExist(normalized, imageRunsDirectory);
        const timestamp = now();
        const project = {
          schemaVersion: 1,
          id,
          sourceJobId: id,
          revision: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
          document: normalized,
        };
        await atomicWrite(id, project);
        return project;
      });
    },

    save(id, expectedRevision, document) {
      assertProjectId(id);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
        throw new DetailPageDocumentValidationError("expectedRevision must be a positive integer");
      }
      return exclusive(id, async () => {
        const current = await readProject(id);
        if (!current) throw new ProjectStoreInvalidError("Detail page project does not exist");
        if (current.revision !== expectedRevision) throw new ProjectRevisionConflictError(current);
        const normalized = normalizeDetailPageDocument(document);
        await assertImagesExist(normalized, imageRunsDirectory);
        const project = {
          ...current,
          revision: current.revision + 1,
          updatedAt: now(),
          document: normalized,
        };
        await atomicWrite(id, project);
        return project;
      });
    },

    recover(id, expectedCorruptSha256, document) {
      assertProjectId(id);
      return exclusive(id, () => recoverProject(id, expectedCorruptSha256, document));
    },

    delete(id) {
      assertProjectId(id);
      return exclusive(id, async () => {
        try {
          await unlink(projectPath(id));
          return true;
        } catch (error) {
          if (error?.code === "ENOENT") return false;
          throw new ProjectStoreWriteError("Could not delete detail page project", { cause: error });
        }
      });
    },
  };

  async function readProject(id) {
    const raw = await readRawProject(id);
    if (raw === undefined) return undefined;
    try {
      return await normalizeStoredProject(raw, id);
    } catch (error) {
      if (error instanceof ProjectStoreInvalidError) throw error;
      throw new ProjectStoreInvalidError("Stored detail page project is invalid", { cause: error });
    }
  }

  async function getRecovery(id) {
    const raw = await readRawProject(id);
    if (raw === undefined) return undefined;
    try {
      await normalizeStoredProject(raw, id);
    } catch (error) {
      return { expectedCorruptSha256: fingerprint(raw) };
    }
    throw new ProjectStoreInvalidError("Detail page project is not corrupt");
  }

  async function recoverProject(id, expectedCorruptSha256, document) {
    if (typeof expectedCorruptSha256 !== "string" || !/^[0-9a-f]{64}$/iu.test(expectedCorruptSha256)) {
      throw new ProjectStoreInvalidError("Corrupt project fingerprint is invalid");
    }
    const raw = await readRawProject(id);
    if (raw === undefined) throw new ProjectStoreInvalidError("Detail page project does not exist");
    try {
      await normalizeStoredProject(raw, id);
      throw new ProjectStoreInvalidError("Detail page project is not corrupt");
    } catch (error) {
      if (error instanceof ProjectStoreInvalidError && error.message === "Detail page project is not corrupt") throw error;
    }
    if (fingerprint(raw) !== expectedCorruptSha256.toLowerCase()) throw new ProjectRecoveryConflictError();
    const normalized = normalizeDetailPageDocument(document);
    await assertImagesExist(normalized, imageRunsDirectory);
    const timestamp = now();
    const project = {
      schemaVersion: 1,
      id,
      sourceJobId: id,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      document: normalized,
    };
    const currentPath = projectPath(id);
    const archivePath = `${currentPath}.corrupt-${archiveTimestamp(timestamp)}-${randomUUID()}.json`;
    let archived = false;
    try {
      await rename(currentPath, archivePath);
      archived = true;
      await atomicWrite(id, project);
      return project;
    } catch (error) {
      if (archived) await rename(archivePath, currentPath).catch(() => {});
      if (error instanceof ProjectStoreWriteError) throw error;
      throw new ProjectStoreWriteError("Could not recover detail page project", { cause: error });
    }
  }

  async function readRawProject(id) {
    try {
      return await readFile(projectPath(id), "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return undefined;
      throw new ProjectStoreInvalidError("Could not read detail page project", { cause: error });
    }
  }

  async function normalizeStoredProject(raw, id) {
    const project = normalizeProject(JSON.parse(raw), id);
    await assertImagesExist(project.document, imageRunsDirectory);
    return project;
  }

  async function atomicWrite(id, project) {
    await mkdir(directory, { recursive: true });
    const temporaryPath = `${projectPath(id)}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, JSON.stringify(project, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
      await rename(temporaryPath, projectPath(id));
    } catch (error) {
      await unlink(temporaryPath).catch(() => {});
      throw new ProjectStoreWriteError("Could not persist detail page project", { cause: error });
    }
  }

  function exclusive(id, operation) {
    const previous = writeChains.get(id) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    const settled = current.catch(() => {});
    writeChains.set(id, settled);
    void settled.finally(() => {
      if (writeChains.get(id) === settled) writeChains.delete(id);
    });
    return current;
  }

  function projectPath(id) {
    return resolve(directory, `${id}.json`);
  }
}

function fingerprint(raw) {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

function archiveTimestamp(value) {
  return String(value).replace(/[^0-9]/gu, "").slice(0, 17) || String(Date.now());
}

async function assertImagesExist(document, imageRunsDirectory) {
  const root = resolve(imageRunsDirectory);
  for (const section of document.sections) {
    if (!section.image) continue;
    const outputImage = parseOutputImageUrl(section.image.url);
    if (!outputImage) throw new DetailPageDocumentValidationError("document image URL is invalid");
    const path = resolve(root, outputImage.relativePath);
    let opened;
    try {
      opened = await openContainedRegularFile(root, path);
    } catch (error) {
      throw new DetailPageDocumentValidationError(`document image does not exist: ${section.image.filename}`);
    } finally {
      await opened?.handle.close().catch(() => {});
    }
  }
}

function normalizeProject(value, expectedId) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ProjectStoreInvalidError("Stored project must be an object");
  if (value.schemaVersion !== 1 || value.id !== expectedId || value.sourceJobId !== expectedId) throw new ProjectStoreInvalidError("Stored project identity is invalid");
  if (!Number.isSafeInteger(value.revision) || value.revision < 1) throw new ProjectStoreInvalidError("Stored project revision is invalid");
  if (!isIso(value.createdAt) || !isIso(value.updatedAt)) throw new ProjectStoreInvalidError("Stored project timestamps are invalid");
  const migration = migrateDetailPageDocument(value.document);
  return {
    schemaVersion: 1,
    id: expectedId,
    sourceJobId: expectedId,
    revision: value.revision,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    document: migration.document,
    ...(migration.report.migrated ? { migration: migration.report } : {}),
  };
}

function assertProjectId(value) {
  if (typeof value !== "string" || !PROJECT_ID_PATTERN.test(value)) throw new ProjectStoreInvalidError("Detail page project id is invalid");
}

function isIso(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
