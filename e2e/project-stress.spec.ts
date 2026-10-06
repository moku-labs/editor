/**
 * @file The project index under an agent's load (change 2026-10-06-project-index, U10): for 60 s
 * a seeded script edits, grows, moves, deletes and breaks the 20 files of `nodes/` in the
 * merge-game copy the bin serves, one operation every 250 ms, while the Flow Code tab shows
 * `board/merge` and Files has `nodes/catch-up.ts` open. The tools page must keep following the
 * index: after the files are put back from the fixture, the Code tab shows `nodes/merge.ts` at the
 * line of `export const merge` (17) within 10 s, the Files tab stands on a file that exists, Used
 * by of `nodes/merge.ts` lists `board/merge`, at least 20 `editor.project` states reached the
 * page, no page error was logged and the server log holds no `[moku-editor]` error.
 *
 * The operations, drawn from a mulberry32 stream seeded with 7: edit 40 % (a comment line at the
 * end), insert-above 25 % (a comment line at the top, so the definition moves down), move 10 %
 * (to `nodes/moved/` and back, with the file's own imports and the flows' imports rewritten),
 * delete 10 % (put back on the next tick) and break 15 % (a syntax error, fixed on the next tick).
 * A file another node imports as a sibling (`./give`, `./splash`) is never moved: the move would
 * break that import, which is not what the index is tested on.
 *
 * Hot reload is off during the run: Bun's HMR dev server does not survive hundreds of reloads in a
 * row (delta-spec risks). The spec turns it off first and on again at the end. Bun still bundles
 * on every write and logs the syntax errors and missing imports the script makes; the spec names
 * that window of the server log in `dist-e2e/server-log-provoked.json`, which the teardown skips
 * (never a `[moku-editor]` line). It runs in the desktop project only: the index does not depend
 * on the window.
 */
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import type { Frame, Locator, Page } from "@playwright/test";
import { MERGE_GAME_DIR } from "../tests/fixtures/game-dir";
import { expect, openTools, test, type WorkspaceId } from "./fixtures";
import { topBar } from "./top-bar";

/** The editor repository. */
const REPO = fileURLToPath(new URL("..", import.meta.url));

/** The project root the bin serves. */
const GAME_ROOT = path.join(REPO, "dist-e2e", "game");

/** How long the script runs, in ms. */
const RUN_MS = 60_000;

/** One operation every this many ms. */
const TICK_MS = 250;

/** The seed of the operation stream. */
const SEED = 7;

/** Where a moved node file goes. */
const MOVED_DIR = "nodes/moved";

/** The line of `export const merge = defineNode({` in the fixture's `nodes/merge.ts`. */
const MERGE_LINE = 17;

/** The fewest `editor.project` states the page must see during the run. */
const MIN_PROJECT_FRAMES = 20;

/** How long the views may take to settle after the files are put back, in ms. */
const SETTLE_MS = 10_000;

/** How long one Hot reload switch may take: the restart, both reconnects and the frame reload. */
const SWITCH_MS = 30_000;

/**
 * What the run provokes on purpose. The Hot reload switch restarts the game server (D-32): Bun's
 * HMR client on the page served with HMR on reports its socket gone until the frame reloads; the
 * game logs its asset warnings after the reload.
 */
const SWITCH_WARNINGS: readonly RegExp[] = [
  /WebSocket connection to 'ws:\/\/127\.0\.0\.1:\d+\/_bun\/hmr' failed/,
  /^\[Bun\] Hot-module-reloading socket disconnected, reconnecting\.\.\.$/,
  /event: assets: texture is not loaded yet/,
  /event: renderer: no texture for asset key/,
  /event: assets: the node waited for a bundle/
];

/** The operations of the script. */
type Op = "edit" | "insert-above" | "move" | "delete" | "break";

/** The operations with their share of the stream, in drawing order. */
const OPS: readonly { readonly op: Op; readonly share: number }[] = [
  { op: "edit", share: 0.4 },
  { op: "insert-above", share: 0.25 },
  { op: "move", share: 0.1 },
  { op: "delete", share: 0.1 },
  { op: "break", share: 0.15 }
];

/** One node file as the script holds it: the text as it reads in `nodes/`. */
type NodeFile = {
  readonly stem: string;
  /** Moved to `nodes/moved/` now. */
  moved: boolean;
  /** The text in `nodes/` form; a moved file is written with its imports one folder deeper. */
  text: string;
  /** False for a file another node imports as a sibling. */
  readonly movable: boolean;
};

/** What the next tick undoes: a deleted file comes back, a broken one is fixed. */
type Heal = { readonly file: NodeFile; readonly kind: "deleted" | "broken" };

/**
 * A mulberry32 stream: the same seed gives the same operations on every run.
 *
 * @param seed - The seed.
 * @returns The next number in [0, 1).
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * The operation a draw picks.
 *
 * @param draw - A number in [0, 1).
 * @returns The operation.
 */
function opOf(draw: number): Op {
  let edge = 0;
  for (const { op, share } of OPS) {
    edge += share;
    if (draw < edge) return op;
  }
  return "break";
}

/**
 * The absolute path of a file of the served root.
 *
 * @param rel - Root-relative path.
 * @returns The absolute path.
 */
function abs(rel: string): string {
  return path.join(GAME_ROOT, rel);
}

/**
 * The root-relative path of a node file now.
 *
 * @param file - The node file.
 * @returns `nodes/<stem>.ts` or `nodes/moved/<stem>.ts`.
 */
function pathOf(file: NodeFile): string {
  return `${file.moved ? MOVED_DIR : "nodes"}/${file.stem}.ts`;
}

/**
 * The text a node file has on disk: in `nodes/moved/` its imports reach one folder further up.
 *
 * @param file - The node file.
 * @returns The text to write.
 */
function diskText(file: NodeFile): string {
  if (!file.moved) return file.text;
  return file.text.replaceAll('from "../', 'from "../../').replaceAll('from "./', 'from "../');
}

/**
 * Puts the node and flow files of the copy back to the fixture's and removes `nodes/moved/` and
 * any file the fixture does not have. Only a file that differs is written, and every write goes
 * out in one burst, so the index sees one batch and an unchanged copy sees none.
 */
async function restoreFromFixture(): Promise<void> {
  await rm(abs(MOVED_DIR), { recursive: true, force: true });
  const writes: Promise<void>[] = [];
  for (const dir of ["nodes", "flows"]) {
    const fixture = await readdir(path.join(MERGE_GAME_DIR, dir));
    const copy = existsSync(abs(dir)) ? await readdir(abs(dir)) : [];
    for (const name of copy.filter(entry => !fixture.includes(entry))) {
      writes.push(rm(abs(`${dir}/${name}`), { recursive: true, force: true }));
    }
    for (const name of fixture) {
      const want = await readFile(path.join(MERGE_GAME_DIR, dir, name), "utf8");
      const rel = `${dir}/${name}`;
      const have = existsSync(abs(rel)) ? await readFile(abs(rel), "utf8") : undefined;
      if (have !== want) writes.push(writeFile(abs(rel), want));
    }
  }
  await Promise.all(writes);
}

/**
 * Reads the 20 node files of the fixture.
 *
 * @returns The files.
 */
async function nodeFiles(): Promise<NodeFile[]> {
  const entries = await readdir(path.join(MERGE_GAME_DIR, "nodes"));
  const names = entries.filter(name => name.endsWith(".ts"));
  const texts = await Promise.all(
    names.map(name => readFile(path.join(MERGE_GAME_DIR, "nodes", name), "utf8"))
  );
  const stems = names.map(name => name.slice(0, -".ts".length));
  const siblings = new Set(
    texts.flatMap(text => [...text.matchAll(/from "\.\/([\w-]+)"/g)].map(match => match[1]))
  );
  return stems.map((stem, index) => ({
    stem,
    moved: false,
    text: texts[index] ?? "",
    movable: !siblings.has(stem)
  }));
}

/**
 * The script: the node files, the flows it rewrites on a move, and what the next tick heals.
 */
class Script {
  private readonly random = mulberry32(SEED);
  private heals: Heal[] = [];
  private tick = 0;

  /** How many times each operation ran. */
  readonly counts: Record<Op, number> = {
    edit: 0,
    "insert-above": 0,
    move: 0,
    delete: 0,
    break: 0
  };

  /**
   * @param files - The node files.
   * @param flows - The flow files: root-relative path → text.
   */
  constructor(
    private readonly files: readonly NodeFile[],
    private readonly flows: Map<string, string>
  ) {}

  /**
   * One tick: heals what the last one broke, then runs one drawn operation on one drawn file.
   */
  async step(): Promise<void> {
    this.tick += 1;
    await this.heal();
    const op = opOf(this.random());
    const file = this.files[Math.floor(this.random() * this.files.length)];
    if (file === undefined) return;

    const done = await this.run(op, file);
    this.counts[done] += 1;
  }

  /**
   * Undoes the deletes and breaks of the last tick.
   */
  async heal(): Promise<void> {
    const heals = this.heals;
    this.heals = [];
    for (const { file } of heals) await writeFile(abs(pathOf(file)), diskText(file));
  }

  /**
   * Runs one operation; a move of a file that cannot move is an edit.
   *
   * @param op - The drawn operation.
   * @param file - The drawn file.
   * @returns The operation that ran.
   */
  private async run(op: Op, file: NodeFile): Promise<Op> {
    switch (op) {
      case "edit": {
        file.text = `${file.text}// stress edit ${this.tick}\n`;
        await writeFile(abs(pathOf(file)), diskText(file));
        return op;
      }
      case "insert-above": {
        file.text = `// stress line ${this.tick}\n${file.text}`;
        await writeFile(abs(pathOf(file)), diskText(file));
        return op;
      }
      case "move": {
        if (!file.movable) return this.run("edit", file);
        await this.move(file);
        return op;
      }
      case "delete": {
        await rm(abs(pathOf(file)), { force: true });
        this.heals.push({ file, kind: "deleted" });
        return op;
      }
      case "break": {
        await writeFile(abs(pathOf(file)), `${diskText(file)}export const stressBroken = (;\n`);
        this.heals.push({ file, kind: "broken" });
        return op;
      }
    }
  }

  /**
   * Moves a node file between `nodes/` and `nodes/moved/`: the new file, the flows' imports,
   * then the old file goes.
   *
   * @param file - The node file.
   */
  private async move(file: NodeFile): Promise<void> {
    const from = pathOf(file);
    const before = `from "../${from.slice(0, -".ts".length)}"`;
    file.moved = !file.moved;
    const to = pathOf(file);
    const after = `from "../${to.slice(0, -".ts".length)}"`;

    await mkdir(abs(MOVED_DIR), { recursive: true });
    await writeFile(abs(to), diskText(file));
    for (const [flow, text] of this.flows) {
      if (!text.includes(before)) continue;
      const next = text.replaceAll(before, after);
      this.flows.set(flow, next);
      await writeFile(abs(flow), next);
    }
    await rm(abs(from), { force: true });
  }
}

/**
 * The server log of the bin: `E2E_SERVER_LOG`, else the newest `dist-e2e/server*.log` (the bin
 * writes to it the whole run).
 *
 * @returns The absolute path, or undefined when there is none.
 */
function serverLog(): string | undefined {
  const named = process.env.E2E_SERVER_LOG;
  if (named !== undefined) return path.resolve(REPO, named);
  const dir = path.join(REPO, "dist-e2e");
  if (!existsSync(dir)) return undefined;
  const logs = readdirSync(dir)
    .filter(name => /^server.*\.log$/.test(name))
    .map(name => path.join(dir, name));
  return logs.toSorted((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

/** Where a spec names the server log window it provoked errors in (e2e/global-teardown.ts). */
const PROVOKED = path.join(REPO, "dist-e2e", "server-log-provoked.json");

/** The server log and the size it had when the run started; set by the test. */
let provoked: { readonly log: string; readonly from: number } | undefined;

/**
 * Names the window of the server log this spec provoked errors in: Bun's dev server bundles the
 * game on every write even with hot reload off, and logs the syntax errors and the missing
 * imports the script makes on purpose. The teardown skips that window, except `[moku-editor]`
 * lines.
 */
async function recordProvoked(): Promise<void> {
  if (provoked === undefined) return;
  const windows: unknown[] = existsSync(PROVOKED)
    ? (JSON.parse(await readFile(PROVOKED, "utf8")) as unknown[])
    : [];
  const to = statSync(provoked.log).size;
  windows.push({ log: provoked.log, from: provoked.from, to, by: "project-stress.spec.ts" });
  await writeFile(PROVOKED, `${JSON.stringify(windows, undefined, 2)}\n`);
  provoked = undefined;
}

/**
 * The lines a log got after a byte offset.
 *
 * @param file - The log.
 * @param from - The size it had before.
 * @returns The new lines.
 */
function linesSince(file: string, from: number): string[] {
  const size = statSync(file).size;
  if (size <= from) return [];
  const buffer = Buffer.alloc(size - from);
  const handle = openSync(file, "r");
  try {
    readSync(handle, buffer, 0, buffer.length, from);
  } finally {
    closeSync(handle);
  }
  return buffer.toString("utf8").split("\n");
}

/**
 * The game iframe.
 *
 * @param page - The test page.
 * @returns The frame of the game page.
 */
function gameFrame(page: Page): Frame {
  const frame = page.frames().find(f => f !== page.mainFrame() && !f.url().includes("/__editor/"));
  if (frame === undefined) throw new Error("no game frame");
  return frame;
}

/**
 * Tells whether the game page was reloaded since it was marked.
 *
 * @param page - The tools page.
 * @returns "reloaded", "marked" or "pending" (no page to ask, mid reload).
 */
async function reloadState(page: Page): Promise<string> {
  try {
    const marked = await gameFrame(page).evaluate(() => Reflect.get(globalThis, "__e2eMark") === 1);
    return marked ? "marked" : "reloaded";
  } catch {
    return "pending";
  }
}

/**
 * Turns Hot reload on or off with the top-bar switch and waits for the restart: the switch
 * state, the game frame reloaded and a live link.
 *
 * @param page - The tools page.
 * @param on - The state asked for.
 */
async function setHotReload(page: Page, on: boolean): Promise<void> {
  const hot = topBar(page).getByRole("switch", { name: "Hot reload", exact: true });
  if ((await hot.getAttribute("aria-checked")) === String(on)) return;
  await gameFrame(page).evaluate(() => Reflect.set(globalThis, "__e2eMark", 1));
  await hot.click();
  await expect(hot).toHaveAttribute("aria-checked", String(on), { timeout: SWITCH_MS });
  await expect.poll(() => reloadState(page), { timeout: SWITCH_MS }).toBe("reloaded");
  await expect(page.locator("[data-ui=link-pill]")).toHaveAttribute("data-kind", "live", {
    timeout: SWITCH_MS
  });
}

/**
 * Shows a workspace with the rail.
 *
 * @param page - The tools page.
 * @param ws - The workspace.
 */
async function show(page: Page, ws: WorkspaceId): Promise<void> {
  await page.locator(`[data-ui=rail] button[data-workspace=${ws}]`).click();
  await expect(page.locator("[data-ui=shell]")).toHaveAttribute("data-workspace", ws);
}

/**
 * The Files workspace host.
 *
 * @param page - The tools page.
 * @returns The host.
 */
function files(page: Page): Locator {
  return page.locator("[data-workspace-host=files]");
}

/**
 * The Flow Inspector's Code tab.
 *
 * @param page - The tools page.
 * @returns The tab body.
 */
function codeTab(page: Page): Locator {
  return page.locator("[data-workspace-host=flow] [data-flow=inspector] [data-flow=code-tab]");
}

/**
 * Opens a file through the Files tree, expanding every ancestor folder first.
 *
 * @param page - The tools page.
 * @param rel - Root-relative path.
 */
async function openInTree(page: Page, rel: string): Promise<void> {
  const parts = rel.split("/");
  for (let index = 1; index < parts.length; index += 1) {
    const folder = files(page).locator(
      `[role=treeitem][data-path="${parts.slice(0, index).join("/")}"]`
    );
    if ((await folder.getAttribute("aria-expanded")) !== "true") await folder.click();
    await expect(folder).toHaveAttribute("aria-expanded", "true");
  }
  await files(page).locator(`[role=treeitem][data-path="${rel}"]`).click();
  await expect(files(page).locator(`[role=tab][title="${rel}"]`)).toHaveAttribute(
    "aria-selected",
    "true"
  );
}

/**
 * The path of the selected Files tab.
 *
 * @param page - The tools page.
 * @returns The path, "" without a tab.
 */
async function activeFile(page: Page): Promise<string> {
  const active = files(page).locator("[role=tab][aria-selected=true]");
  return (await active.count()) === 0 ? "" : ((await active.getAttribute("title")) ?? "");
}

test.beforeEach(async () => {
  await restoreFromFixture();
});

test.afterEach(async ({ page }) => {
  await restoreFromFixture();
  await recordProvoked();
  // A run that stopped half way leaves Hot reload on for the specs after it, as every spec does.
  const hot = topBar(page).getByRole("switch", { name: "Hot reload", exact: true });
  if ((await hot.count()) === 1 && (await hot.getAttribute("aria-checked")) === "false") {
    await hot.click();
    await expect(hot).toHaveAttribute("aria-checked", "true", { timeout: SWITCH_MS });
  }
});

test.describe("project index · stress", () => {
  test("60 s of agent edits, moves, deletes and breaks: the Code tab, Files and Used by follow the index", async ({
    page,
    errors
  }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "the desktop window only");
    test.setTimeout(120_000);
    for (const pattern of SWITCH_WARNINGS) errors.allow(pattern);

    // Every editor.project state the page gets, from the first socket on.
    const states: string[] = [];
    page.on("websocket", socket => {
      if (!socket.url().includes("/__editor/")) return;
      socket.on("framereceived", ({ payload }) => {
        if (typeof payload !== "string" || !payload.includes('"project"')) return;
        const note = JSON.parse(payload) as {
          channel?: string;
          method?: string;
          params?: { state?: string };
        };
        if (note.channel === "editor" && note.method === "project") {
          states.push(note.params?.state ?? "");
        }
      });
    });
    const log = serverLog();
    const logFrom = log === undefined ? 0 : statSync(log).size;
    if (log !== undefined) provoked = { log, from: logFrom };
    await openTools(page);
    await expect.poll(() => states.at(-1), { timeout: SWITCH_MS }).toBe("on");

    // Files: nodes/merge.ts; its Used by chip selects board/merge on the Flow canvas.
    await show(page, "files");
    await openInTree(page, "nodes/merge.ts");
    await files(page)
      .locator("[data-part=used-by] [data-chip][data-kind=node]", { hasText: "board/merge" })
      .click();
    await expect(page.locator("[data-ui=shell]")).toHaveAttribute("data-workspace", "flow");
    const inspector = page.locator("[data-workspace-host=flow] [data-flow=inspector]");
    await inspector.getByRole("tab", { name: "Code" }).click();
    await expect(codeTab(page).locator("[data-part=path]")).toHaveText("nodes/merge.ts");
    await expect(codeTab(page).locator("[data-line][data-highlight]")).toHaveAttribute(
      "data-line",
      String(MERGE_LINE)
    );

    // Files: nodes/catch-up.ts, the tab the script moves, deletes and breaks under.
    await show(page, "files");
    await openInTree(page, "nodes/catch-up.ts");
    await setHotReload(page, false);

    const flows = new Map<string, string>();
    for (const name of await readdir(path.join(MERGE_GAME_DIR, "flows"))) {
      flows.set(`flows/${name}`, await readFile(path.join(MERGE_GAME_DIR, "flows", name), "utf8"));
    }
    const script = new Script(await nodeFiles(), flows);
    const framesBefore = states.length;
    try {
      const end = Date.now() + RUN_MS;
      let next = Date.now();
      while (Date.now() < end) {
        await script.step();
        next += TICK_MS;
        await sleep(Math.max(0, next - Date.now()));
      }
      await script.heal();
    } finally {
      await restoreFromFixture();
    }
    const frames = states.length - framesBefore;
    const summary = { counts: script.counts, frames };
    await testInfo.attach("stress-ops.json", {
      body: JSON.stringify(summary, undefined, 2),
      contentType: "application/json"
    });
    console.log(`\nProject index stress: ${JSON.stringify(summary)}\n`);

    // The Code tab is back on the node's definition.
    await show(page, "flow");
    await expect(codeTab(page).locator("[data-part=path]")).toHaveText("nodes/merge.ts", {
      timeout: SETTLE_MS
    });
    await expect(codeTab(page).locator("[data-line][data-highlight]")).toHaveAttribute(
      "data-line",
      String(MERGE_LINE),
      { timeout: SETTLE_MS }
    );

    // The Files tab stands on a file that exists and shows it.
    await show(page, "files");
    await expect
      .poll(
        async () => existsSync(abs(await activeFile(page))) && (await activeFile(page)) !== "",
        {
          timeout: SETTLE_MS
        }
      )
      .toBe(true);
    await expect(files(page).locator("[data-files-body]")).not.toContainText(
      "The file is gone from disk."
    );

    // Used by of nodes/merge.ts names its node.
    await openInTree(page, "nodes/merge.ts");
    await expect(
      files(page).locator("[data-part=used-by] [data-chip][data-kind=node]", {
        hasText: "board/merge"
      })
    ).toBeVisible({ timeout: SETTLE_MS });

    await setHotReload(page, true);

    expect(frames, "editor.project states during the run").toBeGreaterThanOrEqual(
      MIN_PROJECT_FRAMES
    );
    expect(states.at(-1)).toBe("on");
    if (log !== undefined) {
      const bad = linesSince(log, logFrom).filter(line => line.includes("[moku-editor]"));
      expect(bad, `[moku-editor] lines in ${log}`).toEqual([]);
    }
  });
});
