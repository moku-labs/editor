import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path/posix";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pageDirCandidates, resolvePageDir } from "../../page-dir";

let first: string;
let second: string;

beforeEach(async () => {
  first = await mkdtemp(join(tmpdir(), "moku-pd-a-"));
  second = await mkdtemp(join(tmpdir(), "moku-pd-b-"));
});

afterEach(async () => {
  await rm(first, { recursive: true, force: true });
  await rm(second, { recursive: true, force: true });
});

describe("resolvePageDir", () => {
  it("returns the configured folder resolved, built or not", () => {
    expect(resolvePageDir("relative/tools", [first])).toBe(resolve("relative/tools"));
    expect(resolvePageDir(first, [second])).toBe(first);
  });

  it("returns the first candidate that holds index.html", async () => {
    await writeFile(join(second, "index.html"), "<head></head>");
    expect(resolvePageDir(undefined, [first, second])).toBe(second);
    await writeFile(join(first, "index.html"), "<head></head>");
    expect(resolvePageDir(undefined, [first, second])).toBe(first);
  });

  it("tries the default candidates when none are given", () => {
    const built = pageDirCandidates().find(dir => existsSync(join(dir, "index.html")));
    expect(resolvePageDir(undefined)).toBe(built);
  });

  it("returns undefined when no candidate is built", () => {
    expect(resolvePageDir(undefined, [first, second])).toBeUndefined();
  });
});

describe("pageDirCandidates", () => {
  it("lists dist/tools next to the bundle, then the repo dist/tools from source", () => {
    const here = fileURLToPath(new URL("../../", import.meta.url));
    expect(pageDirCandidates()).toEqual([
      `${join(here, "tools")}/`,
      fileURLToPath(new URL("../../../../../dist/tools/", import.meta.url))
    ]);
  });
});
