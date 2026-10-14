/* eslint-disable unicorn/no-null -- null is "not known" on the digest, the device and the pairing request */
import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path/posix";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { perfDiscoveryPath, readPerfDiscovery, writePerfDiscovery } from "../../discovery";
import { removeRoot, tempRoot } from "../helpers";

/** What a perf run writes. */
const INPUT = {
  pid: 4242,
  port: 47_600,
  path: "/__editor",
  token: "s".repeat(43),
  lan: "192.168.1.5:47600",
  startedAt: 1_791_986_083_963
};

let root: string;

beforeEach(async () => {
  root = await tempRoot();
});

afterEach(async () => {
  await removeRoot(root);
});

describe("writePerfDiscovery", () => {
  it("writes .moku/perf.json 0600 with the token, through a temp file that does not stay", async () => {
    const release = writePerfDiscovery(root, INPUT);
    const path = perfDiscoveryPath(root);
    expect(path).toBe(join(root, ".moku/perf.json"));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ version: 1, ...INPUT });
    expect(readdirSync(join(root, ".moku"))).toEqual(["perf.json"]);
    release();
  });

  it("removes the file on release only while it still holds this pid", async () => {
    const release = writePerfDiscovery(root, INPUT);
    const path = perfDiscoveryPath(root);
    await writeFile(path, JSON.stringify({ version: 1, ...INPUT, pid: 777 }));
    release();
    expect(existsSync(path)).toBe(true);

    const again = writePerfDiscovery(root, INPUT);
    again();
    expect(existsSync(path)).toBe(false);
  });
});

describe("readPerfDiscovery", () => {
  it("reads the record a run wrote", () => {
    const release = writePerfDiscovery(root, { ...INPUT, lan: null });
    expect(readPerfDiscovery(root)).toEqual({ version: 1, ...INPUT, lan: null });
    release();
  });

  it("answers undefined for no file, a file that is not JSON, and a record with a field missing", async () => {
    expect(readPerfDiscovery(root)).toBeUndefined();
    await mkdir(join(root, ".moku"));
    await writeFile(perfDiscoveryPath(root), "{ not json");
    expect(readPerfDiscovery(root)).toBeUndefined();
    // JSON drops an undefined field: the record has no token.
    await writeFile(
      perfDiscoveryPath(root),
      JSON.stringify({ version: 1, ...INPUT, token: undefined })
    );
    expect(readPerfDiscovery(root)).toBeUndefined();
    await writeFile(perfDiscoveryPath(root), JSON.stringify({ version: 2, ...INPUT }));
    expect(readPerfDiscovery(root)).toBeUndefined();
  });
});
