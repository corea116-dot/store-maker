import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { DETAIL_PAGE_PROJECTS_DIR, IMAGE_RUNS_DIR } from "./config.mjs";
import {
  DetailPageDocumentValidationError,
  normalizeDetailPageDocument,
} from "./detail-page-document.mjs";

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
    let raw;
    try {
      raw = await readFile(projectPath(id), "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return undefined;
      throw new ProjectStoreInvalidError("Could not read detail page project", { cause: error });
    }
    try {
      const project = normalizeProject(JSON.parse(raw), id);
      await assertImagesExist(project.document, imageRunsDirectory);
      return project;
    } catch (error) {
      if (error instanceof ProjectStoreInvalidError) throw error;
      throw new ProjectStoreInvalidError("Stored detail page project is invalid", { cause: error });
    }
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

async function assertImagesExist(document, imageRunsDirectory) {
  const root = resolve(imageRunsDirectory);
  for (const section of document.sections) {
    if (!section.image) continue;
    const relativePath = section.image.url.slice("/outputs/image-runs/".length);
    const path = resolve(root, relativePath);
    if (!path.startsWith(`${root}${sep}`)) throw new DetailPageDocumentValidationError("document image path escapes the output directory");
    try {
      const info = await stat(path);
      if (!info.isFile()) throw new Error("not a file");
    } catch (error) {
      throw new DetailPageDocumentValidationError(`document image does not exist: ${section.image.filename}`);
    }
  }
}

function normalizeProject(value, expectedId) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ProjectStoreInvalidError("Stored project must be an object");
  if (value.schemaVersion !== 1 || value.id !== expectedId || value.sourceJobId !== expectedId) throw new ProjectStoreInvalidError("Stored project identity is invalid");
  if (!Number.isSafeInteger(value.revision) || value.revision < 1) throw new ProjectStoreInvalidError("Stored project revision is invalid");
  if (!isIso(value.createdAt) || !isIso(value.updatedAt)) throw new ProjectStoreInvalidError("Stored project timestamps are invalid");
  return {
    schemaVersion: 1,
    id: expectedId,
    sourceJobId: expectedId,
    revision: value.revision,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    document: normalizeDetailPageDocument(value.document),
  };
}

function assertProjectId(value) {
  if (typeof value !== "string" || !PROJECT_ID_PATTERN.test(value)) throw new ProjectStoreInvalidError("Detail page project id is invalid");
}

function isIso(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
