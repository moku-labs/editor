import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path/posix";
import type { ProjectApi, ProjectIndex } from "@moku-labs/game/project";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectState } from "../../../registry/protocol";
import { startFiles, stopFiles } from "../../lifecycle";
import type { ProjectModule } from "../../project";
import { closeIndex, findKey, openIndex, summarize } from "../../project";
import type { FilesConfig } from "../../types";
import type { Fixture } from "../helpers";
import { createFixture, MINI_GAME, outcome, projectStates, putMiniGame } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The project index of files: the real index of @moku-labs/game/project on a
// temp mini game, and fake handles for the lifecycle edges. Every fixture is
// closed and removed in afterEach, also when a test fails.
// ─────────────────────────────────────────────────────────────────────────────

/** Watch batches land after a 75 ms quiet period, or the 2 s backstop walk. */
const WAIT = { timeout: 5000, interval: 20 };

/** The reason of an index the installed game cannot give. */
const NO_INDEX = "@moku-labs/game 0.6.0 or newer is needed for the project index";

/** Every fixture a test made, closed and removed after it. */
const made: Fixture[] = [];

afterEach(async () => {
  const fixtures = made.splice(0);
  for (const fixture of fixtures) closeIndex(fixture.ctx.state);
  await Promise.all(fixtures.map(fixture => fixture.cleanup()));
});

/**
 * A fixture with the mini game in its root.
 *
 * @param config - Config overrides.
 * @returns The fixture.
 */
async function gameFixture(config: Partial<FilesConfig> = {}): Promise<Fixture> {
  const fixture = await createFixture(config);
  made.push(fixture);
  await putMiniGame(fixture);
  return fixture;
}

/**
 * The last state a fixture announced.
 *
 * @param fixture - The fixture.
 * @returns The state, or undefined before the first.
 */
function lastState(fixture: Fixture): ProjectState | undefined {
  return projectStates(fixture.ctx).at(-1);
}

/**
 * An empty index of the game's shape.
 *
 * @param revision - Its revision.
 * @returns The index.
 */
function emptyIndex(revision = "r1"): ProjectIndex {
  return { schemaVersion: 1, revision, symbols: {}, files: {}, unresolved: [] };
}

/**
 * A fake handle of the game's shape.
 *
 * @param overrides - Members to replace.
 * @returns The handle.
 */
function fakeHandle(overrides: Partial<ProjectApi> = {}): ProjectApi {
  return {
    index: emptyIndex(),
    find: vi.fn(async () => []),
    watch: vi.fn(() => vi.fn()),
    changed: vi.fn(async () => emptyIndex()),
    close: vi.fn(),
    ...overrides
  };
}

/**
 * A fake `@moku-labs/game/project` whose openProject waits until the test settles it.
 *
 * @returns The loader, the openProject mock and the settle handles of the open.
 */
function pendingOpen() {
  const opening = Promise.withResolvers<ProjectApi>();
  const openProject = vi.fn(() => opening.promise);
  const load = async (): Promise<ProjectModule> => ({ openProject });
  return { load, openProject, opening };
}

/**
 * A loader of a fake `@moku-labs/game/project` whose openProject answers `handle`.
 *
 * @param handle - What openProject resolves with.
 * @returns The loader.
 */
function loaderOf(handle: Promise<ProjectApi>): () => Promise<ProjectModule> {
  return async () => ({ openProject: () => handle });
}

describe("project index: open and find on a real game", () => {
  it("opens, announces the keys and finds a node of a non-kebab file at its line", async () => {
    const fixture = await gameFixture();
    await openIndex(fixture.ctx);

    const [found] = await findKey(fixture.ctx, "node:main/open");
    expect(found).toMatchObject({ path: "features/settings/nodes.ts", binding: "open", line: 3 });
    expect(projectStates(fixture.ctx)).toEqual([
      expect.objectContaining({
        state: "on",
        defs: {
          "flow:main": ["flows/main.ts"],
          "node:main/home": ["nodes/home.ts"],
          "node:main/open": ["features/settings/nodes.ts"]
        },
        uses: { "node:main/home": ["flows/main.ts"], "node:main/open": ["flows/main.ts"] },
        broken: {}
      })
    ]);
    expect(fixture.api.project()).toEqual(lastState(fixture));
    expect(fixture.ctx.log.info).toHaveBeenCalledWith("files:project-on", {
      files: 3,
      keys: 3,
      ms: expect.any(Number)
    });
  });

  it("reads the line from disk at the call: three lines inserted above move it to line 6", async () => {
    const fixture = await gameFixture();
    await openIndex(fixture.ctx);

    const nodes = "features/settings/nodes.ts";
    await fixture.put(nodes, `// one\n// two\n// three\n${MINI_GAME[nodes] ?? ""}`);
    const [found] = await findKey(fixture.ctx, "node:main/open");

    const { version } = await fixture.api.read(nodes);
    expect(found?.line).toBe(6);
    expect(found?.hash).toBe(version);
  });

  it("announces a watch batch with the previous revision and the changed files", async () => {
    const fixture = await gameFixture();
    await openIndex(fixture.ctx);
    const first = lastState(fixture);

    await fixture.put("nodes/home.ts", `// edited\n${MINI_GAME["nodes/home.ts"] ?? ""}`);
    await vi.waitFor(() => expect(projectStates(fixture.ctx)).toHaveLength(2), WAIT);

    expect(first?.state === "on" ? first.previous : "off").toBeUndefined();
    expect(lastState(fixture)).toMatchObject({
      state: "on",
      previous: first?.state === "on" ? first.revision : "off",
      change: { files: ["nodes/home.ts"], moved: [], removed: [] }
    });
  });

  it("reports a node that moved to another file in one batch", async () => {
    const fixture = await gameFixture();
    await mkdir(join(fixture.root, "nodes/screens"));
    await openIndex(fixture.ctx);

    const flow = (MINI_GAME["flows/main.ts"] ?? "").replace(
      "../nodes/home",
      "../nodes/screens/home"
    );
    await Promise.all([
      rename(join(fixture.root, "nodes/home.ts"), join(fixture.root, "nodes/screens/home.ts")),
      writeFile(join(fixture.root, "flows/main.ts"), flow)
    ]);

    await vi.waitFor(() => {
      const state = lastState(fixture);
      expect(state?.state === "on" ? state.change?.moved : []).toContainEqual({
        key: "node:main/home",
        from: "nodes/home.ts",
        to: "nodes/screens/home.ts"
      });
    }, WAIT);
    expect(lastState(fixture)).toMatchObject({
      defs: { "node:main/home": ["nodes/screens/home.ts"] }
    });
  });

  it("lists a file that does not parse as broken; find answers its last good line, broken", async () => {
    const fixture = await gameFixture();
    await openIndex(fixture.ctx);

    const nodes = "features/settings/nodes.ts";
    await fixture.put(nodes, `${MINI_GAME[nodes] ?? ""}export const = ;\n`);
    await vi.waitFor(() => expect(lastState(fixture)).toHaveProperty(["broken", nodes]), WAIT);

    const state = lastState(fixture);
    expect(state?.state === "on" ? state.broken[nodes] : undefined).toMatch(/^features\/settings/);
    const [found] = await findKey(fixture.ctx, "node:main/open");
    expect(found).toMatchObject({ path: nodes, line: 3, broken: true });
  });

  it("drops an answer whose file the sandbox does not let it read", async () => {
    const fixture = await gameFixture({ allow: ["flows/**", "nodes/**"] });
    await openIndex(fixture.ctx);

    expect(await findKey(fixture.ctx, "node:main/open")).toEqual([]);
    expect(await findKey(fixture.ctx, "node:main/home")).toHaveLength(1);
  });

  it("answers [] for a key the index does not know", async () => {
    const fixture = await gameFixture();
    await openIndex(fixture.ctx);

    expect(await fixture.api.find("node:main/nowhere")).toEqual([]);
  });

  it("waits for the open in progress: find right after start answers the line", async () => {
    const fixture = await gameFixture();
    startFiles(fixture.ctx);

    const [found] = await fixture.api.find("node:main/home");
    expect(found).toMatchObject({ path: "nodes/home.ts", line: 3 });
  });
});

describe("project index: off", () => {
  it("is off with one error line and -32008 on find when the game has no index", async () => {
    const fixture = await gameFixture();
    await openIndex(fixture.ctx, () => Promise.reject(new Error("Cannot find module")));

    const off = { state: "off", reason: NO_INDEX };
    expect(fixture.api.project()).toEqual(off);
    expect(projectStates(fixture.ctx)).toEqual([off]);
    expect(fixture.ctx.log.error).toHaveBeenCalledTimes(1);
    expect(fixture.ctx.log.error).toHaveBeenCalledWith("files:project-off", { reason: NO_INDEX });
    await expect(fixture.api.find("node:main/open")).rejects.toMatchObject({
      code: -32_008,
      message: `[moku-editor] project index off: ${NO_INDEX}`,
      data: { reason: "not_installed", retryable: false }
    });
  });

  it("is off with the bare message when openProject rejects", async () => {
    const fixture = await gameFixture();
    const reason = '[game] The project index needs the "typescript" package.';
    await openIndex(fixture.ctx, loaderOf(Promise.reject(new Error(reason))));

    expect(fixture.api.project()).toEqual({ state: "off", reason });
    expect(fixture.ctx.log.error).toHaveBeenCalledWith("files:project-off", { reason });
  });

  it("is off as disabled and never loads the index when files.project is false", async () => {
    const fixture = await gameFixture({ project: false });
    const load = vi.fn(loaderOf(Promise.resolve(fakeHandle())));
    await openIndex(fixture.ctx, load);

    expect(load).not.toHaveBeenCalled();
    expect(projectStates(fixture.ctx)).toEqual([{ state: "off", reason: "disabled" }]);
  });

  it("answers -32008 not opened before start", async () => {
    const fixture = await gameFixture();

    expect(fixture.api.project()).toEqual({ state: "off", reason: "not opened" });
    await expect(fixture.api.find("node:main/open")).rejects.toMatchObject({
      code: -32_008,
      message: "[moku-editor] project index off: not opened"
    });
  });

  it("rejects a key over 512 characters, or not a string, with -32602 field key", async () => {
    const fixture = await gameFixture();
    const { find } = fixture.api;
    const key: unknown = 42;

    await expect(find(`node:${"x".repeat(508)}`)).rejects.toMatchObject({
      code: -32_602,
      data: { reason: "invalid_input", field: "key" }
    });
    expect(await outcome(find(key as string))).toBe(-32_602);
    expect(await outcome(find(`node:${"x".repeat(507)}`))).toBe(-32_008);
  });
});

describe("project index: lifecycle", () => {
  it("closes a handle that opens after stop and announces nothing", async () => {
    const fixture = await gameFixture();
    const { load, openProject, opening } = pendingOpen();
    const handle = fakeHandle();
    const opened = openIndex(fixture.ctx, load);
    await vi.waitFor(() => expect(openProject).toHaveBeenCalledTimes(1));

    stopFiles(fixture.ctx);
    opening.resolve(handle);
    await opened;

    expect(handle.close).toHaveBeenCalledTimes(1);
    expect(handle.watch).not.toHaveBeenCalled();
    expect(fixture.ctx.emit).not.toHaveBeenCalled();
    expect(fixture.api.project()).toEqual({ state: "off", reason: "stopped" });
  });

  it("never calls openProject when stop comes while the module loads", async () => {
    const fixture = await gameFixture();
    const loading = Promise.withResolvers<ProjectModule>();
    const openProject = vi.fn(async () => fakeHandle());
    const opened = openIndex(fixture.ctx, () => loading.promise);

    stopFiles(fixture.ctx);
    loading.resolve({ openProject });
    await opened;

    expect(openProject).not.toHaveBeenCalled();
    expect(fixture.ctx.emit).not.toHaveBeenCalled();
  });

  it("announces nothing when the load fails after stop", async () => {
    const fixture = await gameFixture();
    const loading = Promise.withResolvers<ProjectModule>();
    const opened = openIndex(fixture.ctx, () => loading.promise);

    stopFiles(fixture.ctx);
    loading.reject(new Error("Cannot find module"));
    await opened;

    expect(fixture.ctx.emit).not.toHaveBeenCalled();
    expect(fixture.ctx.log.error).not.toHaveBeenCalled();
  });

  it("announces nothing when openProject rejects after stop", async () => {
    const fixture = await gameFixture();
    const { load, openProject, opening } = pendingOpen();
    const opened = openIndex(fixture.ctx, load);
    await vi.waitFor(() => expect(openProject).toHaveBeenCalledTimes(1));

    stopFiles(fixture.ctx);
    opening.reject(new Error("gone"));
    await opened;

    expect(fixture.ctx.emit).not.toHaveBeenCalled();
  });

  it("stop ends the watch, closes the handle and leaves the state off without an emit", async () => {
    const fixture = await gameFixture();
    const unwatch = vi.fn();
    const handle = fakeHandle({ watch: vi.fn(() => unwatch) });
    await openIndex(fixture.ctx, loaderOf(Promise.resolve(handle)));
    fixture.ctx.emit.mockClear();

    stopFiles(fixture.ctx);

    expect(unwatch).toHaveBeenCalledTimes(1);
    expect(handle.close).toHaveBeenCalledTimes(1);
    expect(fixture.ctx.emit).not.toHaveBeenCalled();
    await expect(fixture.api.find("flow:main")).rejects.toMatchObject({
      message: "[moku-editor] project index off: stopped"
    });
  });

  it("announces each batch of the watch with the revision it follows", async () => {
    const fixture = await gameFixture();
    const watch = vi.fn<ProjectApi["watch"]>(() => vi.fn());
    await openIndex(fixture.ctx, loaderOf(Promise.resolve(fakeHandle({ watch }))));

    const [onIndex] = watch.mock.calls[0] ?? [];
    const change = { revision: "r2", files: ["nodes/home.ts"], moved: [], removed: [] };
    onIndex?.(emptyIndex("r2"), change);
    onIndex?.(emptyIndex("r3"), { ...change, revision: "r3" });

    expect(
      projectStates(fixture.ctx).map(state => [state.state, Reflect.get(state, "previous")])
    ).toEqual([
      ["on", undefined],
      ["on", "r1"],
      ["on", "r2"]
    ]);
  });

  it("closes the handle and is off when the watch cannot start", async () => {
    const fixture = await gameFixture();
    const handle = fakeHandle({
      watch: vi.fn(() => {
        throw new Error("[game] The project is closed.");
      })
    });
    await openIndex(fixture.ctx, loaderOf(Promise.resolve(handle)));

    expect(handle.close).toHaveBeenCalledTimes(1);
    expect(projectStates(fixture.ctx)).toEqual([
      { state: "off", reason: "[game] The project is closed." }
    ]);
  });

  it("logs a failing files:project emit and still settles", async () => {
    const fixture = await gameFixture();
    fixture.ctx.emit.mockImplementation(() => {
      throw new Error("hook failed");
    });
    await openIndex(fixture.ctx, loaderOf(Promise.resolve(fakeHandle())));

    expect(fixture.api.project()).toMatchObject({ state: "on", revision: "r1" });
    expect(fixture.ctx.log.error).toHaveBeenCalledWith("files:emit-failed", {
      event: "files:project",
      error: "Error: hook failed"
    });
  });

  it("copies the prop of an idProp answer (G4)", async () => {
    const fixture = await gameFixture();
    const found = {
      path: "flows/main.ts",
      key: "settingsBoard",
      component: "Signboard",
      kind: "idProp" as const,
      prop: "id",
      line: 2,
      range: [1, 1, 3, 1] as [number, number, number, number],
      hash: "h1"
    };
    const handle = fakeHandle({ find: vi.fn(async () => [found]) });
    await openIndex(fixture.ctx, loaderOf(Promise.resolve(handle)));

    expect(await fixture.api.find("jsx:settingsBoard")).toEqual([found]);
  });

  it("maps a find the index fails to -32000", async () => {
    const fixture = await gameFixture();
    const handle = fakeHandle({ find: vi.fn(() => Promise.reject(new Error("EACCES"))) });
    await openIndex(fixture.ctx, loaderOf(Promise.resolve(handle)));

    expect(await outcome(fixture.api.find("flow:main"))).toBe(-32_000);
  });
});

describe("summarize", () => {
  const index: ProjectIndex = {
    schemaVersion: 1,
    revision: "r9",
    manifest: "manifest.json",
    symbols: {
      "flow:main": { def: [{ path: "flows/main.ts", binding: "main" }] },
      "jsx:hudRow": { def: [{ path: "features/ui/hud.tsx", key: "hudRow", kind: "literal" }] },
      "node:main/home": {
        def: [{ path: "nodes/home.ts", binding: "home" }],
        uses: [
          { path: "flows/main.ts", binding: "main", key: "home" },
          { path: "flows/main.ts", binding: "other", key: "home" }
        ]
      },
      "style:features/ui/hud.tsx#hud": {
        def: [
          { path: "features/ui/hud.tsx", binding: "hud" },
          { path: "features/ui/hud.tsx", binding: "hud" }
        ],
        uses: []
      },
      "textStyle:ui.title": {
        def: [
          { path: "features/ui/styles.ts", key: "ui.title" },
          { path: "features/ui/more-styles.ts", key: "ui.title" }
        ],
        conflict: true
      }
    },
    files: {
      "features/ui/hud.tsx": {
        hash: "a",
        state: "broken",
        error: "features/ui/hud.tsx:3:7 ',' expected."
      },
      "features/ui/odd.ts": { hash: "b", state: "broken" },
      "flows/main.ts": { hash: "c", state: "ok" }
    },
    unresolved: [{ path: "features/ui/hud.tsx", reason: "key built at run time" }]
  };

  it("maps every key but jsx: to its def paths in def order, deduped, both of a conflict", () => {
    const state = summarize(index);

    expect(state.state === "on" ? state.defs : {}).toEqual({
      "flow:main": ["flows/main.ts"],
      "node:main/home": ["nodes/home.ts"],
      "style:features/ui/hud.tsx#hud": ["features/ui/hud.tsx"],
      "textStyle:ui.title": ["features/ui/styles.ts", "features/ui/more-styles.ts"]
    });
  });

  it("lists uses only for keys that have some, deduped", () => {
    const state = summarize(index);

    expect(state.state === "on" ? state.uses : {}).toEqual({
      "node:main/home": ["flows/main.ts"]
    });
  });

  it("lists broken files with the first error, empty when the index has none", () => {
    const state = summarize(index);

    expect(state.state === "on" ? state.broken : {}).toEqual({
      "features/ui/hud.tsx": "features/ui/hud.tsx:3:7 ',' expected.",
      "features/ui/odd.ts": ""
    });
  });

  it("copies revision, previous, manifest and the change without its revision", () => {
    const change = {
      revision: "r9",
      files: ["nodes/a.ts", "nodes/b/a.ts"],
      moved: [{ key: "node:main/a", from: "nodes/a.ts", to: "nodes/b/a.ts" }],
      removed: ["node:main/gone"]
    };

    expect(summarize(index, "r8", change)).toMatchObject({
      state: "on",
      revision: "r9",
      previous: "r8",
      manifest: "manifest.json",
      change: {
        files: ["nodes/a.ts", "nodes/b/a.ts"],
        moved: [{ key: "node:main/a", from: "nodes/a.ts", to: "nodes/b/a.ts" }],
        removed: ["node:main/gone"]
      }
    });
    expect(summarize(index, "r8", change)).not.toHaveProperty(["change", "revision"]);
  });

  it("leaves previous, manifest and change out when there are none", () => {
    const state = summarize(emptyIndex());

    expect(state).toEqual({ state: "on", revision: "r1", defs: {}, uses: {}, broken: {} });
    expect(Object.keys(state)).not.toContain("previous");
  });

  it("does not touch the index it reads and shares no list with it", () => {
    const before = JSON.stringify(index);
    const state = summarize(index, "r8");

    expect(JSON.stringify(index)).toBe(before);
    expect(state.state === "on" ? state.defs["flow:main"] : undefined).not.toBe(
      index.symbols["flow:main"]?.def
    );
  });
});
