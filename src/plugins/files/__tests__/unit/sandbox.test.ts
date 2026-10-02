import { lstat, mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path/posix";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sha1 } from "../../io";
import { checkLexical, isAllowed, isDenied, resolveReal, resolveRealSync } from "../../sandbox";
import { createFilesState } from "../../state";
import type { Fixture, TestCtx } from "../helpers";
import {
  createEmit,
  createFixture,
  createLog,
  DEFAULT_CONFIG,
  outcome,
  PNG_BYTES
} from "../helpers";

let fx: Fixture;

beforeEach(async () => {
  fx = await createFixture();
});

afterEach(async () => {
  await fx.cleanup();
});

const FORBIDDEN = -32_004;
const NOT_FOUND = -32_601;
const CONFLICT = -32_005;
const INVALID = -32_602;
const FAILED = -32_000;
const MIB = 1024 * 1024;

/** Every file the table rows rely on. */
const SEED: readonly string[] = [
  "package.json",
  "src/a.ts",
  "src/b.tsx",
  "src/a.js",
  "src/a.png",
  "Makefile",
  "a.css",
  "docs/a.md",
  ".moku/notes/n.md",
  ".moku/editor/layout.json",
  "~/x.ts",
  "node_modules/pkg/index.ts",
  "node_modules/x.ts",
  "Node_Modules/pkg/index.ts",
  "packages/a/node_modules/b.ts",
  ".git/config",
  ".GIT/HEAD",
  "dist/index.ts",
  ".env",
  ".env.local",
  "config/.env.json"
];

/**
 * Writes the seed files and a PNG capture.
 *
 * @param target - The fixture.
 */
async function seed(target: Fixture): Promise<void> {
  for (const file of SEED) await target.put(file);
  await target.put(".moku/captures/a.png", PNG_BYTES);
  await target.put(".moku/captures/a.svg", "<svg/>");
  await target.put("node_modules/x/a.png", PNG_BYTES);
}

/** One row of the security table. */
type Row = {
  readonly id: string;
  readonly setup?: (target: Fixture) => Promise<void>;
  readonly run: (target: Fixture) => Promise<unknown>;
  readonly expected: number | "ok";
  readonly check?: (target: Fixture) => Promise<void>;
};

const rows: readonly Row[] = [
  { id: "S1 read ../x.ts", run: t => t.api.read("../x.ts"), expected: FORBIDDEN },
  { id: "S2 read src/../../x.ts", run: t => t.api.read("src/../../x.ts"), expected: FORBIDDEN },
  { id: "S3 read src/../src/a.ts", run: t => t.api.read("src/../src/a.ts"), expected: FORBIDDEN },
  { id: "S4 read /etc/passwd", run: t => t.api.read("/etc/passwd"), expected: FORBIDDEN },
  { id: "S5 read C:/x.ts", run: t => t.api.read("C:/x.ts"), expected: FORBIDDEN },
  { id: "S5 read c:x.ts", run: t => t.api.read("c:x.ts"), expected: FORBIDDEN },
  {
    id: String.raw`S6 read src\a.ts`,
    run: t => t.api.read(String.raw`src\a.ts`),
    expected: FORBIDDEN
  },
  {
    id: String.raw`S6 read \\server\x.ts`,
    run: t => t.api.read(String.raw`\\server\x.ts`),
    expected: FORBIDDEN
  },
  { id: "S7 read NUL", run: t => t.api.read("src/a.ts\0.png"), expected: FORBIDDEN },
  { id: "S8 read empty", run: t => t.api.read(""), expected: FORBIDDEN },
  { id: "S9 read ./src/a.ts", run: t => t.api.read("./src/a.ts"), expected: FORBIDDEN },
  { id: "S9 read src//a.ts", run: t => t.api.read("src//a.ts"), expected: FORBIDDEN },
  { id: "S9 read src/a.ts/", run: t => t.api.read("src/a.ts/"), expected: FORBIDDEN },
  {
    id: "S10 read 1025 chars",
    run: t => t.api.read(`${"a".repeat(1022)}.ts`),
    expected: FORBIDDEN
  },
  { id: "S11 read %2e%2e/x.ts", run: t => t.api.read("%2e%2e/x.ts"), expected: NOT_FOUND },
  {
    id: "S12 read ~/x.ts",
    run: t => t.api.read("~/x.ts"),
    expected: "ok",
    check: t => expect(t.api.read("~/x.ts")).resolves.toHaveProperty("text", "// ~/x.ts\n")
  },
  {
    id: "S13 read node_modules/pkg/index.ts",
    run: t => t.api.read("node_modules/pkg/index.ts"),
    expected: FORBIDDEN
  },
  {
    id: "S14 read Node_Modules/pkg/index.ts",
    run: t => t.api.read("Node_Modules/pkg/index.ts"),
    expected: FORBIDDEN
  },
  {
    id: "S15 read packages/a/node_modules/b.ts",
    run: t => t.api.read("packages/a/node_modules/b.ts"),
    expected: FORBIDDEN
  },
  { id: "S16 read .git/config", run: t => t.api.read(".git/config"), expected: FORBIDDEN },
  { id: "S16 read .GIT/HEAD", run: t => t.api.read(".GIT/HEAD"), expected: FORBIDDEN },
  { id: "S17 read dist/index.ts", run: t => t.api.read("dist/index.ts"), expected: FORBIDDEN },
  { id: "S18 read .env", run: t => t.api.read(".env"), expected: FORBIDDEN },
  { id: "S18 read .env.local", run: t => t.api.read(".env.local"), expected: FORBIDDEN },
  {
    id: "S18 read config/.env.json",
    run: t => t.api.read("config/.env.json"),
    expected: FORBIDDEN
  },
  { id: "S19 read src/a.js", run: t => t.api.read("src/a.js"), expected: FORBIDDEN },
  { id: "S19 read src/a.png", run: t => t.api.read("src/a.png"), expected: FORBIDDEN },
  { id: "S19 read Makefile", run: t => t.api.read("Makefile"), expected: FORBIDDEN },
  { id: "S20 read src (folder)", run: t => t.api.read("src"), expected: FORBIDDEN },
  ...["package.json", "src/a.ts", "src/b.tsx", "a.css", "docs/a.md"].map(
    (path): Row => ({
      id: `S21 read ${path}`,
      run: t => t.api.read(path),
      expected: "ok",
      check: t => expect(t.api.read(path)).resolves.toHaveProperty("text", `// ${path}\n`)
    })
  ),
  ...[".moku/notes/n.md", ".moku/editor/layout.json"].map(
    (path): Row => ({ id: `S22 read ${path}`, run: t => t.api.read(path), expected: "ok" })
  ),
  {
    id: "S23 read src/link.ts → outside file",
    setup: async t => t.link("src/link.ts", await t.putOutside("hosts")),
    run: t => t.api.read("src/link.ts"),
    expected: FORBIDDEN
  },
  {
    id: "S24 read src/alias.ts → src/a.ts",
    setup: t => t.link("src/alias.ts", join(t.root, "src/a.ts")),
    run: t => t.api.read("src/alias.ts"),
    expected: "ok",
    check: t => expect(t.api.read("src/alias.ts")).resolves.toHaveProperty("text", "// src/a.ts\n")
  },
  {
    id: "S25 read src/alias.ts → node_modules/x.ts",
    setup: t => t.link("src/alias.ts", join(t.root, "node_modules/x.ts")),
    run: t => t.api.read("src/alias.ts"),
    expected: FORBIDDEN
  },
  {
    id: "S26 read src/alias.ts → src/a.js",
    setup: t => t.link("src/alias.ts", join(t.root, "src/a.js")),
    run: t => t.api.read("src/alias.ts"),
    expected: FORBIDDEN
  },
  {
    id: "S27 read ext/a.ts, ext → outside folder",
    setup: async t => {
      await t.putOutside("ext/a.ts");
      await t.link("ext", join(t.outside, "ext"));
    },
    run: t => t.api.read("ext/a.ts"),
    expected: FORBIDDEN
  },
  {
    id: "S28 read 2 MiB + 1 byte",
    setup: async t => {
      await t.put("big.ts", "x".repeat(2 * MIB + 1));
    },
    run: t => t.api.read("big.ts"),
    expected: FAILED
  },
  {
    id: "S29 write ext/new.ts, ext → outside folder",
    setup: async t => {
      await mkdir(join(t.outside, "ext"));
      await t.link("ext", join(t.outside, "ext"));
    },
    run: t => t.api.write("ext/new.ts", "x"),
    expected: FORBIDDEN,
    check: async t => expect(await readdir(join(t.outside, "ext"))).toEqual([])
  },
  {
    id: "S30 write src/deep/new/file.ts",
    run: t => t.api.write("src/deep/new/file.ts", "x"),
    expected: "ok",
    check: async t => {
      expect(await readFile(join(t.root, "src/deep/new/file.ts"), "utf8")).toBe("x");
    }
  },
  { id: "S31 write src/a.js", run: t => t.api.write("src/a.js", "x"), expected: FORBIDDEN },
  {
    id: "S32 write src/a.ts with a stale version",
    run: t => t.api.write("src/a.ts", "x", sha1(new TextEncoder().encode("old"))),
    expected: CONFLICT,
    check: async t => {
      expect(await readFile(join(t.root, "src/a.ts"), "utf8")).toBe("// src/a.ts\n");
    }
  },
  {
    id: "S33 write src/missing.ts with a version",
    run: t => t.api.write("src/missing.ts", "x", "0".repeat(40)),
    expected: CONFLICT
  },
  {
    id: "S34 write src/alias.ts → src/a.ts",
    setup: t => t.link("src/alias.ts", join(t.root, "src/a.ts")),
    run: t => t.api.write("src/alias.ts", "updated"),
    expected: "ok",
    check: async t => {
      expect(await readFile(join(t.root, "src/a.ts"), "utf8")).toBe("updated");
      const link = await lstat(join(t.root, "src/alias.ts"));
      expect(link.isSymbolicLink()).toBe(true);
    }
  },
  {
    id: "S35 write 2 MiB + 1 byte",
    run: t => t.api.write("src/big.ts", "x".repeat(2 * MIB + 1)),
    expected: INVALID
  },
  {
    id: "S36 two concurrent writes with the same version",
    run: async t => {
      const { version } = await t.api.read("src/a.ts");
      const results = await Promise.all([
        outcome(t.api.write("src/a.ts", "one", version)),
        outcome(t.api.write("src/a.ts", "two", version))
      ]);
      expect(results).toEqual(["ok", CONFLICT]);
      expect(await readFile(join(t.root, "src/a.ts"), "utf8")).toBe("one");
    },
    expected: "ok"
  },
  {
    id: "S37 write src/x.ts where src/x.ts is a folder",
    setup: async t => {
      await mkdir(join(t.root, "src/x.ts"));
    },
    run: t => t.api.write("src/x.ts", "x"),
    expected: FORBIDDEN,
    check: async t => {
      const names = await readdir(join(t.root, "src"));
      expect(names.filter(name => name.endsWith(".tmp"))).toEqual([]);
    }
  },
  {
    id: "S38 writeBinary src/a.png",
    run: t => t.api.writeBinary("src/a.png", PNG_BYTES),
    expected: FORBIDDEN
  },
  {
    id: "S39 writeBinary .moku/captures/a.txt",
    run: t => t.api.writeBinary(".moku/captures/a.txt", PNG_BYTES),
    expected: FORBIDDEN
  },
  {
    id: "S39 writeBinary .moku/captures/a.svg",
    run: t => t.api.writeBinary(".moku/captures/a.svg", PNG_BYTES),
    expected: FORBIDDEN
  },
  {
    id: "S40 writeBinary .moku/captures/series-x/001.PNG",
    run: t => t.api.writeBinary(".moku/captures/series-x/001.PNG", PNG_BYTES),
    expected: "ok",
    check: async t => {
      const file = join(t.rootReal, ".moku/captures/series-x/001.PNG");
      expect([...(await readFile(file))]).toEqual([...PNG_BYTES]);
      expect(t.ctx.emit).toHaveBeenCalledWith("files:written", {
        path: ".moku/captures/series-x/001.PNG",
        bytes: PNG_BYTES.length,
        kind: "capture"
      });
    }
  },
  {
    id: "S41 writeBinary 16 MiB + 1 byte",
    run: t => t.api.writeBinary(".moku/captures/big.png", new Uint8Array(16 * MIB + 1)),
    expected: INVALID
  },
  { id: "S42 list ..", run: t => t.api.list(".."), expected: FORBIDDEN },
  { id: "S42 list /", run: t => t.api.list("/"), expected: FORBIDDEN },
  { id: "S42 list src/..", run: t => t.api.list("src/.."), expected: FORBIDDEN },
  { id: "S43 list node_modules", run: t => t.api.list("node_modules"), expected: FORBIDDEN },
  { id: "S43 list .git", run: t => t.api.list(".git"), expected: FORBIDDEN },
  { id: "S45 list src/a.ts (a file)", run: t => t.api.list("src/a.ts"), expected: FORBIDDEN },
  { id: "S46 list nope", run: t => t.api.list("nope"), expected: NOT_FOUND },
  {
    id: "S47 resolve src/a.ts",
    run: t => Promise.resolve(t.api.resolve("src/a.ts")),
    expected: "ok",
    check: async t => expect(t.api.resolve("src/a.ts")).toBe(join(t.rootReal, "src/a.ts"))
  },
  {
    id: "S48 the message of S4 names the path, never the root",
    run: async t => {
      const error = await t.api.read("/etc/passwd").catch((error_: unknown) => error_);
      expect(error).toBeInstanceOf(Error);
      const message = error instanceof Error ? error.message : "";
      expect(message).toContain("/etc/passwd");
      expect(message).not.toContain(t.rootReal);
      expect(message).not.toContain(t.root);
    },
    expected: "ok"
  },
  {
    id: "S50 readBinary .moku/captures/a.png",
    run: t => t.api.readBinary(".moku/captures/a.png"),
    expected: "ok",
    check: async t => {
      const { dataUrl, version } = await t.api.readBinary(".moku/captures/a.png");
      expect(dataUrl.startsWith("data:image/png;base64,")).toBe(true);
      const bytes = Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64");
      expect([...bytes]).toEqual([...PNG_BYTES]);
      expect(version).toBe(sha1(PNG_BYTES));
    }
  },
  ...["src/a.ts", ".moku/notes/n.md", ".moku/captures/a.svg"].map(
    (path): Row => ({
      id: `S51 readBinary ${path}`,
      run: t => t.api.readBinary(path),
      expected: FORBIDDEN
    })
  ),
  ...["node_modules/x/a.png", "../a.png"].map(
    (path): Row => ({
      id: `S52 readBinary ${path}`,
      run: t => t.api.readBinary(path),
      expected: FORBIDDEN
    })
  ),
  {
    id: "S53 readBinary .moku/captures/link.png → outside PNG",
    setup: async t => t.link(".moku/captures/link.png", await t.putOutside("a.png", PNG_BYTES)),
    run: t => t.api.readBinary(".moku/captures/link.png"),
    expected: FORBIDDEN
  },
  {
    id: "S54 readBinary 16 MiB + 1 byte",
    setup: async t => {
      await t.put(".moku/captures/big.png", new Uint8Array(16 * MIB + 1));
    },
    run: t => t.api.readBinary(".moku/captures/big.png"),
    expected: FAILED
  },
  {
    id: "S55 readBinary .moku/captures/missing.png",
    run: t => t.api.readBinary(".moku/captures/missing.png"),
    expected: NOT_FOUND
  }
];

describe("security table", () => {
  it.each(rows)("$id", async ({ setup, run, expected, check }) => {
    await seed(fx);
    await setup?.(fx);
    expect(await outcome(run(fx))).toBe(expected);
    await check?.(fx);
  });

  it("S44 lists exactly .moku, src and a.ts from a crowded root", async () => {
    for (const file of [".git/config", "node_modules/x.ts", "dist/a.ts", ".env", "a.js"]) {
      await fx.put(file);
    }
    await fx.put("a.ts");
    await fx.put("src/b.ts");
    await fx.put(".moku/notes/n.md");
    await mkdir(join(fx.outside, "out"));
    await fx.link("out", join(fx.outside, "out"));

    const entries = await fx.api.list("");
    expect(entries.map(entry => [entry.path, entry.kind])).toEqual([
      [".moku", "dir"],
      ["src", "dir"],
      ["a.ts", "file"]
    ]);
  });

  it("S49 init throws the spec/11 formatted error for a file root and a missing root", async () => {
    const file = await fx.put("a.ts");
    for (const root of [file, join(fx.root, "missing")]) {
      const ctx: TestCtx = {
        config: { ...DEFAULT_CONFIG, root },
        state: createFilesState(),
        emit: createEmit(),
        log: createLog()
      };
      const { validateFilesConfig } = await import("../../init");
      expect(() => validateFilesConfig(ctx)).toThrow(
        `[moku-editor] files.root "${root}" is not a directory.\n  Pass pluginConfigs.files.root pointing at the game project.`
      );
    }
  });
});

describe("checkLexical", () => {
  it.each([
    "",
    ".",
    "src/..",
    "/x",
    String.raw`a\b`,
    "a\0b",
    "a//b",
    "./a",
    "a/",
    "C:/a",
    "c:a"
  ])("rejects %j for a read", path => {
    expect(() => checkLexical(path, "read")).toThrow(/forbidden path/);
  });

  it("passes the root forms only for list", () => {
    expect(() => checkLexical("", "list")).not.toThrow();
    expect(() => checkLexical(".", "list")).not.toThrow();
    expect(() => checkLexical("..", "list")).toThrow();
  });

  it("rejects a value that is not a string", () => {
    const path: unknown = 42;
    expect(() => checkLexical(path as string, "read")).toThrow(/forbidden path: 42/);
  });

  it("accepts 1024 chars and rejects 1025", () => {
    expect(() => checkLexical("a".repeat(1024), "read")).not.toThrow();
    expect(() => checkLexical("a".repeat(1025), "read")).toThrow();
  });

  it("does no decoding", () => {
    expect(() => checkLexical("%2e%2e/x.ts", "read")).not.toThrow();
    expect(() => checkLexical("~/x.ts", "read")).not.toThrow();
  });
});

describe("isDenied and isAllowed", () => {
  it("tests the path and each of its folder prefixes, case-insensitively", () => {
    const deny = fx.ctx.state.denyGlobs;
    expect(isDenied("node_modules", deny)).toBe(true);
    expect(isDenied("a/Node_Modules/b/c.ts", deny)).toBe(true);
    expect(isDenied("src/a.ts", deny)).toBe(false);
    expect(isDenied("", deny)).toBe(false);
  });

  it("matches the allow list case-sensitively", () => {
    const allow = fx.ctx.state.allowGlobs;
    expect(isAllowed("src/a.ts", allow)).toBe(true);
    expect(isAllowed("src/a.TS", allow)).toBe(false);
    expect(isAllowed(".moku/captures/a.png", allow)).toBe(true);
  });
});

describe("resolveReal and resolveRealSync", () => {
  it("resolve a missing write target under its nearest existing ancestor", async () => {
    await fx.put("src/a.ts");
    const expected = join(fx.rootReal, "src/new/b.ts");
    expect(await resolveReal(fx.ctx, "src/new/b.ts", "write")).toBe(expected);
    expect(resolveRealSync(fx.ctx, "src/new/b.ts", "write")).toBe(expected);
  });

  it("reject a missing read target with -32601 and resolve the root for list", async () => {
    expect(await outcome(resolveReal(fx.ctx, "src/nope.ts", "read"))).toBe(NOT_FOUND);
    expect(() => resolveRealSync(fx.ctx, "src/nope.ts", "read")).toThrow(/not found/);
    expect(await resolveReal(fx.ctx, "", "list")).toBe(fx.rootReal);
    expect(resolveRealSync(fx.ctx, ".", "list")).toBe(fx.rootReal);
  });

  it("sync: rejects a symlink escape, a denied real path and a type mismatch", async () => {
    await fx.put("src/a.ts");
    await fx.put("node_modules/x.ts");
    await fx.link("src/out.ts", await fx.putOutside("o.ts"));
    await fx.link("src/nm.ts", join(fx.root, "node_modules/x.ts"));
    expect(() => resolveRealSync(fx.ctx, "src/out.ts", "read")).toThrow(/forbidden path/);
    expect(() => resolveRealSync(fx.ctx, "src/nm.ts", "read")).toThrow(/forbidden path/);
    expect(() => resolveRealSync(fx.ctx, "src", "list")).not.toThrow();
    expect(() => resolveRealSync(fx.ctx, "src/a.ts", "list")).toThrow(/forbidden path/);
  });

  it("reject writes through a file used as a folder", async () => {
    await fx.put("src/a.ts");
    expect(await outcome(resolveReal(fx.ctx, "src/a.ts/b.ts", "write"))).toBe(FORBIDDEN);
    expect(() => resolveRealSync(fx.ctx, "src/a.ts/b.ts", "write")).toThrow(/forbidden path/);
    expect(await outcome(resolveReal(fx.ctx, "src/a.ts/b.ts", "read"))).toBe(NOT_FOUND);
  });

  it("apply the capture rule to the real path of a symlink", async () => {
    await fx.put("src/a.ts");
    await fx.link(".moku/captures/x.png", join(fx.root, "src/a.ts"));
    expect(await outcome(resolveReal(fx.ctx, ".moku/captures/x.png", "writeBinary"))).toBe(
      FORBIDDEN
    );
    expect(await outcome(resolveReal(fx.ctx, ".moku/captures/x.png", "readBinary"))).toBe(
      FORBIDDEN
    );
  });

  it("follow an in-root folder symlink and check the real path", async () => {
    await fx.put("src/a.ts", "real");
    await fx.link("lnk", join(fx.root, "src"));
    expect(await resolveReal(fx.ctx, "lnk/a.ts", "read")).toBe(
      join(await realpath(fx.root), "src/a.ts")
    );
  });

  it("refuse every call before init", async () => {
    const ctx: TestCtx = { ...fx.ctx, state: createFilesState() };
    expect(await outcome(resolveReal(ctx, "src/a.ts", "read"))).toBe(FAILED);
    expect(() => resolveRealSync(ctx, "src/a.ts", "read")).toThrow(/before init/);
  });

  it("keep a dangling symlink inside the root as a write target", async () => {
    await fx.link("src/dangling.ts", join(fx.root, "src/gone.ts"));
    await writeFile(join(fx.root, "src/keep.ts"), "k");
    expect(await resolveReal(fx.ctx, "src/dangling.ts", "write")).toBe(
      join(fx.rootReal, "src/dangling.ts")
    );
    expect(await outcome(resolveReal(fx.ctx, "src/dangling.ts", "read"))).toBe(NOT_FOUND);
  });
});
