import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path/posix";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { atomicWrite, sha1 } from "../../io";
import type { Fixture } from "../helpers";
import { createFixture } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The version check of write runs inside beforeRename (D-45): an external writer
// that changes the file after the temp file is written, and before the rename,
// is caught. atomicWrite is wrapped so the external write lands in that window.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("../../io", async importOriginal => {
  const io = await importOriginal<typeof import("../../io")>();
  return { ...io, atomicWrite: vi.fn(io.atomicWrite) };
});

let fx: Fixture;

beforeEach(async () => {
  fx = await createFixture();
});

afterEach(async () => {
  vi.mocked(atomicWrite).mockClear();
  await fx.cleanup();
});

/**
 * Makes the next atomicWrite write `external` onto the target after its temp file is written and
 * before the real beforeRename runs.
 *
 * @param external - The bytes an agent writes in the window.
 */
async function writeInWindow(external: string): Promise<void> {
  const io = await vi.importActual<typeof import("../../io")>("../../io");
  vi.mocked(atomicWrite).mockImplementationOnce((real, bytes, beforeRename) =>
    io.atomicWrite(real, bytes, async () => {
      await writeFile(real, external);
      await beforeRename?.();
    })
  );
}

/**
 * The names in the folder of the root that end with `.tmp`.
 *
 * @returns The temp file names left behind.
 */
async function temporaries(): Promise<string[]> {
  const names = await readdir(fx.root);
  return names.filter(name => name.endsWith(".tmp"));
}

describe("files api: write checks the version right before the rename", () => {
  it("rejects with -32005 when the file changed after the temp write; the external bytes stay", async () => {
    await fx.put("a.ts", "old");
    const { version } = await fx.api.read("a.ts");
    await writeInWindow("external");

    await expect(fx.api.write("a.ts", "mine", version)).rejects.toMatchObject({
      code: -32_005,
      data: { reason: "version_conflict", id: "a.ts" }
    });
    expect(await readFile(join(fx.root, "a.ts"), "utf8")).toBe("external");
    expect(await temporaries()).toEqual([]);
    expect(fx.ctx.emit).not.toHaveBeenCalled();
  });

  it("lets the write win over the external bytes when no version is given", async () => {
    await fx.put("a.ts", "old");
    await writeInWindow("external");

    await fx.api.write("a.ts", "mine");

    expect(await readFile(join(fx.root, "a.ts"), "utf8")).toBe("mine");
    expect(await temporaries()).toEqual([]);
  });

  it("compares with the bytes on disk at the rename, not at the call", async () => {
    await fx.put("a.ts", "old");
    await writeInWindow("external");

    const saved = await fx.api.write("a.ts", "mine", sha1(new TextEncoder().encode("external")));

    expect(saved.version).toBe(sha1(new TextEncoder().encode("mine")));
    expect(await readFile(join(fx.root, "a.ts"), "utf8")).toBe("mine");
  });

  it("checks the text before it writes anything, even with a stale version", async () => {
    await fx.put("a.ts", "old");

    await expect(
      fx.api.write("a.ts", "x".repeat(2 * 1024 * 1024 + 1), "f".repeat(40))
    ).rejects.toMatchObject({ code: -32_602, data: { field: "text" } });
    expect(atomicWrite).not.toHaveBeenCalled();
  });

  it("answers -32005 for a version given for a file that is missing", async () => {
    await expect(fx.api.write("new.ts", "x", "f".repeat(40))).rejects.toMatchObject({
      code: -32_005
    });
    expect(await readdir(fx.root)).toEqual([]);
  });
});
