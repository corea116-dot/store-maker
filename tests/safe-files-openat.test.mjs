import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  openContainedRegularFile,
  removeContainedPath,
  writeContainedNewFile,
} from "../lib/server/safe-files.mjs";

test("Given a readable file When its visible root is replaced after the root descriptor opens Then the original root remains authoritative", async (t) => {
  const fixture = await rootSwapFixture(t);
  await writeFile(join(fixture.root, "nested", "asset.txt"), "trusted-bytes");
  await writeFile(join(fixture.outside, "nested", "asset.txt"), "outside-secret");

  const opened = await openContainedRegularFile(fixture.root, join(fixture.root, "nested", "asset.txt"), {
    trustedRoot: fixture.parent,
    beforeOpen: fixture.swapRoot,
  });
  try {
    assert.equal(await opened.handle.readFile("utf8"), "trusted-bytes");
  } finally {
    await opened.handle.close();
  }
  assert.equal(await readFile(join(fixture.outside, "nested", "asset.txt"), "utf8"), "outside-secret");
});

test("Given a new output file When its visible root is replaced after the root descriptor opens Then creation stays in the original root", async (t) => {
  const fixture = await rootSwapFixture(t);
  await writeContainedNewFile(fixture.root, join(fixture.root, "nested", "created.txt"), Buffer.from("trusted-write"), {
    trustedRoot: fixture.parent,
    beforeOpen: fixture.swapRoot,
  });

  assert.equal(await readFile(join(fixture.movedRoot, "nested", "created.txt"), "utf8"), "trusted-write");
  await assert.rejects(access(join(fixture.outside, "nested", "created.txt")), { code: "ENOENT" });
});

test("Given a staged file When its visible root is replaced after the root descriptor opens Then deletion cannot touch the replacement tree", async (t) => {
  const fixture = await rootSwapFixture(t);
  await writeFile(join(fixture.root, "nested", "discard.txt"), "trusted-discard");
  await writeFile(join(fixture.outside, "nested", "discard.txt"), "outside-sentinel");

  await removeContainedPath(fixture.root, join(fixture.root, "nested", "discard.txt"), {
    trustedRoot: fixture.parent,
    beforeOpen: fixture.swapRoot,
  });

  await assert.rejects(access(join(fixture.movedRoot, "nested", "discard.txt")), { code: "ENOENT" });
  assert.equal(await readFile(join(fixture.outside, "nested", "discard.txt"), "utf8"), "outside-sentinel");
});

test("Given an intermediate directory replaced with a symlink after the root descriptor opens When a file is read Then the boundary fails closed", async (t) => {
  const fixture = await rootSwapFixture(t);
  await writeFile(join(fixture.root, "nested", "asset.txt"), "trusted-bytes");
  await writeFile(join(fixture.outside, "nested", "asset.txt"), "outside-secret");

  await assert.rejects(
    openContainedRegularFile(fixture.root, join(fixture.root, "nested", "asset.txt"), {
      trustedRoot: fixture.parent,
      beforeOpen: async () => {
        await rename(join(fixture.root, "nested"), join(fixture.root, "nested-opened"));
        await symlink(join(fixture.outside, "nested"), join(fixture.root, "nested"));
      },
    }),
    /safely readable|symbolic link/u,
  );
  assert.equal(await readFile(join(fixture.outside, "nested", "asset.txt"), "utf8"), "outside-secret");
});

async function rootSwapFixture(t) {
  const parent = await mkdtemp(join(tmpdir(), "store-maker-safe-openat-"));
  const root = join(parent, "trusted");
  const movedRoot = join(parent, "trusted-opened");
  const outside = join(parent, "outside");
  await Promise.all([mkdir(join(root, "nested"), { recursive: true }), mkdir(join(outside, "nested"), { recursive: true })]);
  t.after(() => rm(parent, { recursive: true, force: true }));
  return {
    parent,
    root,
    movedRoot,
    outside,
    swapRoot: async () => {
      await rename(root, movedRoot);
      await symlink(outside, root);
    },
  };
}
