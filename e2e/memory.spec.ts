/**
 * @file M4, the browser memory test (spec 10 Delta 2026-10-16b): the tools page with the live game
 * in its frame, measured through CDP in the desktop project only, in one test so every run shares
 * one page and the steady-local baseline. The game frame is same-origin with the tools page, so it
 * runs in the same renderer and isolate: the page's numbers include the game and its overlay
 * (asserted once).
 *
 * A measurement is taken after the logs of the tools page and the game page are emptied (as M3
 * does on the server: `@moku-labs/common`'s log keeps every entry, decisions.md 2026-10-16) and
 * the Console is cleared (its windowed table fills toward its overscan band; `resetLogs`). It
 * reads the DOM counters (`Memory.getDOMCounters`: nodes, listeners) and the used heap
 * (`Runtime.getHeapUsage`) as the median of 3 reads, each after a forced GC
 * (`HeapProfiler.collectGarbage`), and the heap the test judges from one heap snapshot: the JS
 * objects the page keeps, without V8's compiled code. The used heap also holds the code V8
 * compiles and optimizes as more of the editor runs (a heap snapshot diff of the churn put nearly
 * all of its repeating growth in InstructionStream, bytecode and feedback, ~270 KiB a window); it
 * is printed (`used`), not judged. Each run is cut into windows with a measurement after each
 * one, and prints `[leak] M4 <run> heap +X KiB nodes +N listeners +N used +Y KiB` with the growth
 * of each window. A metric fails only when its growth over the run passes the ceiling AND it grew
 * in every window: a leak repeats, while a cache filled once, a workspace mounted once or the
 * 2-minute history filling up does not.
 *
 * - steady-local: Render live on the local preview, the game's overlay open as a card; warm 5 s,
 *   baseline, 3 windows of 10 s. JS heap < +3 MiB, DOM nodes < +200, listeners < +50.
 * - steady-device: device mode on through `activeSource.connectWire()` (the adb listener, port
 *   47600; a taken port fails with connect's message), the fake phone of e2e/fake-device.ts pairs
 *   and becomes the source (activeSource's autoUse), the local preview paused; Render live on the
 *   phone with the Memory card "not measured" (a WebView heap is never trusted); warm 5 s, baseline,
 *   3 windows of 10 s with the steady ceilings; the local game stays paused for the whole run.
 * - churn, from the local preview with the phone linked, in 4 windows of 5 rounds: 20 × useDevice
 *   (Use in the Connect panel) ⇄ useLocal ("Use local preview"), 10 × the phone leaves (SIGUSR1:
 *   lost, the local preview takes over) and rejoins (SIGUSR2), 20 × the six workspaces, 20 × the
 *   popovers (Connect, its menu, Monitoring), 20 × the overlay hidden and open as a card; each
 *   window back to Render on the local preview, settle 3 s. Nodes and listeners within 5 % of the
 *   steady-local baseline, heap < +3 MiB from the churn's start (the 2-minute frame history fills
 *   through the steady runs, by design); `activeSource.markers()` within its bound of 32; exactly
 *   one device session in `link.sessions()`; the local preview running. Then the phone leaves and
 *   device mode goes off.
 *
 * The bin's tools page does not publish its app: activeSource and link are reached through the
 * plugin context the workspace's shell renders with (`viaTools`).
 *
 * `reducedMotion: "no-preference"`: the live timeline's rAF loop must run. It retries nothing on
 * its own (CI's one retry applies).
 */
import { type ChildProcess, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { CDPSession, Frame, Page } from "@playwright/test";
import { expect, type Tools, test, WORKSPACES } from "./fixtures";

/**
 * One measurement: the heap of JS objects (without compiled code) in bytes, the DOM nodes, the
 * event listeners, and the used heap in bytes (printed, not judged).
 */
type Counters = {
  readonly heap: number;
  readonly nodes: number;
  readonly listeners: number;
  readonly used: number;
};

/** The ceiling of each judged metric's growth over a run. */
type Ceilings = Omit<Counters, "used">;

/** The parts of a V8 heap snapshot the heap metric reads. */
type HeapSnapshot = {
  readonly snapshot: {
    readonly meta: {
      readonly node_fields: readonly string[];
      readonly node_types: readonly [readonly string[]];
    };
  };
  readonly nodes: readonly number[];
};

/** The editor repository root: the fake phone runs from it. */
const REPO = fileURLToPath(new URL("..", import.meta.url));

/** The demo phone's fixtures (renderView RV6), read by the fake phone. */
const FIXTURE = "src/plugins/renderView/__tests__/device-fixtures.ts";

/** One KiB and one MiB, in bytes. */
const KIB = 1024;
const MIB = 1024 * KIB;

/** Warm-up before a steady baseline, ms. */
const WARM_MS = 5000;

/** A steady run: three windows of 10 s. */
const STEADY_WINDOWS = 3;
const WINDOW_MS = 10_000;

/** The churn: four windows of five rounds each (20 in all), then a 3 s settle per window. */
const CHURN_WINDOWS = 4;
const CHURN_ROUNDS = 5;
const SETTLE_MS = 3000;

/** The popovers of the churn: the Connect panel (scan lease on and off), its menu, Monitoring. */
const CHURN_POPOVERS = ["connect", "split", "monitoring"] as const;

/** The steady ceilings. */
const STEADY: Ceilings = { heap: 3 * MIB, nodes: 200, listeners: 50 };

/** The churn's share of the steady-local baseline for nodes and listeners. */
const CHURN_SHARE = 0.05;

/** How long the fake phone may take to pair, link and become the source, ms. */
const LINK_MS = 30_000;

/** activeSource's `markers` bound (its default, src/tools.ts). */
const MARKERS_MAX = 32;

/**
 * The middle value.
 *
 * @param values - The values.
 * @returns The median.
 */
function median(values: readonly number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

/**
 * One read after a forced full GC: the used heap and the DOM counters.
 *
 * @param cdp - The page's CDP session.
 * @returns The counters, without the objects heap.
 */
async function readOnce(cdp: CDPSession): Promise<Omit<Counters, "heap">> {
  await cdp.send("HeapProfiler.collectGarbage");
  const { usedSize } = await cdp.send("Runtime.getHeapUsage");
  const { nodes, jsEventListeners } = await cdp.send("Memory.getDOMCounters");
  return { used: usedSize, nodes, listeners: jsEventListeners };
}

/**
 * The heap of JS objects the page keeps: a heap snapshot (it collects the garbage first) summed
 * over its nodes' own sizes, without V8's compiled code (type "code": machine code, bytecode,
 * feedback) and without Blink's native objects (the DOM counters count those).
 *
 * @param cdp - The page's CDP session.
 * @returns Bytes.
 */
async function objectsHeap(cdp: CDPSession): Promise<number> {
  const chunks: string[] = [];
  const onChunk = (event: { chunk: string }): void => {
    chunks.push(event.chunk);
  };
  cdp.on("HeapProfiler.addHeapSnapshotChunk", onChunk);
  try {
    await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
  } finally {
    cdp.off("HeapProfiler.addHeapSnapshotChunk", onChunk);
  }
  const { snapshot, nodes } = JSON.parse(chunks.join("")) as HeapSnapshot;
  const fields = snapshot.meta.node_fields;
  const typeAt = fields.indexOf("type");
  const sizeAt = fields.indexOf("self_size");
  const types = snapshot.meta.node_types[0];
  let bytes = 0;
  for (let node = 0; node < nodes.length; node += fields.length) {
    const type = types[nodes[node + typeAt] ?? 0];
    if (type !== "code" && type !== "native") bytes += nodes[node + sizeAt] ?? 0;
  }
  return bytes;
}

/**
 * A measurement: the median of 3 reads of the used heap and the DOM counters, then the objects
 * heap.
 *
 * @param cdp - The page's CDP session.
 * @returns The counters.
 */
async function measure(cdp: CDPSession): Promise<Counters> {
  const reads: Omit<Counters, "heap">[] = [];
  for (let read = 0; read < 3; read += 1) reads.push(await readOnce(cdp));
  return {
    heap: await objectsHeap(cdp),
    nodes: median(reads.map(one => one.nodes)),
    listeners: median(reads.map(one => one.listeners)),
    used: median(reads.map(one => one.used))
  };
}

/**
 * A signed number with its unit.
 *
 * @param value - The growth.
 * @param unit - "KiB" (the value is bytes) or "" (a count).
 * @returns E.g. "+412.5 KiB", "-3".
 */
function signed(value: number, unit: "KiB" | ""): string {
  const number = unit === "KiB" ? (value / KIB).toFixed(1) : String(value);
  const text = value >= 0 ? `+${number}` : number;
  return unit === "" ? text : `${text} ${unit}`;
}

/**
 * The growth from one measurement to another.
 *
 * @param from - The earlier measurement.
 * @param to - The later one.
 * @returns The growth of each metric.
 */
function growth(from: Counters, to: Counters): Counters {
  return {
    heap: to.heap - from.heap,
    nodes: to.nodes - from.nodes,
    listeners: to.listeners - from.listeners,
    used: to.used - from.used
  };
}

/**
 * Prints a run's line, `[leak] M4 <run> heap +X KiB nodes +N listeners +N used +Y KiB`, and the
 * growth of each window.
 *
 * @param run - The run's name.
 * @param baseline - The baseline of the totals.
 * @param start - Where the first window starts (the baseline, or the end of an earlier run).
 * @param windows - The measurement after each window.
 */
function report(
  run: string,
  baseline: Counters,
  start: Counters,
  windows: readonly Counters[]
): void {
  const last = windows.at(-1) ?? start;
  const total = growth(baseline, last);
  const steps = windows.map((window, index) => growth(windows[index - 1] ?? start, window));
  console.log(
    `[leak] M4 ${run} heap ${signed(total.heap, "KiB")} nodes ${signed(total.nodes, "")} listeners ${signed(total.listeners, "")} used ${signed(total.used, "KiB")}`
  );
  console.log(
    `[leak] M4 ${run} windows heap ${steps.map(step => signed(step.heap, "KiB")).join(" / ")}; nodes ${steps.map(step => signed(step.nodes, "")).join(" / ")}; listeners ${steps.map(step => signed(step.listeners, "")).join(" / ")}; used ${steps.map(step => signed(step.used, "KiB")).join(" / ")}; baseline heap ${(baseline.heap / MIB).toFixed(1)} MiB nodes ${baseline.nodes} listeners ${baseline.listeners}`
  );
}

/**
 * The metrics that leak: their growth over the run passes the ceiling and they grew in every
 * window. One that passes the ceiling without growing in every window is reported, not failed.
 *
 * @param baseline - The baseline of the totals.
 * @param start - Where the first window starts.
 * @param windows - The measurement after each window.
 * @param ceilings - The ceiling of each metric's total growth.
 * @returns One line per leaking metric; empty when none leaks.
 */
function leaks(
  baseline: Counters,
  start: Counters,
  windows: readonly Counters[],
  ceilings: Ceilings
): string[] {
  const last = windows.at(-1) ?? start;
  const total = growth(baseline, last);
  const found: string[] = [];
  for (const metric of ["heap", "nodes", "listeners"] as const) {
    const steps = windows.map(
      (window, index) => window[metric] - (windows[index - 1] ?? start)[metric]
    );
    if (total[metric] <= ceilings[metric]) continue;
    const repeated = steps.every(step => step > 0);
    const line = `${metric} grew ${total[metric]} (ceiling ${ceilings[metric]}), by window ${steps.join(" / ")}`;
    if (repeated) found.push(line);
    else console.log(`[leak] over the ceiling once, not in every window: ${line}`);
  }
  return found;
}

/**
 * Runs `windows` windows of `run` and measures after each.
 *
 * @param take - Takes one measurement.
 * @param windows - How many windows.
 * @param run - One window's work.
 * @returns The measurement after each window.
 */
async function windowsOf(
  take: () => Promise<Counters>,
  windows: number,
  run: (window: number) => Promise<void>
): Promise<Counters[]> {
  const measured: Counters[] = [];
  for (let window = 0; window < windows; window += 1) {
    await run(window);
    measured.push(await take());
  }
  return measured;
}

/**
 * The game page frame.
 *
 * @param page - The test page.
 * @returns The frame.
 */
function gameFrame(page: Page): Frame {
  const frame = page.frames().find(f => f !== page.mainFrame() && !f.url().includes("/__editor/"));
  if (frame === undefined) throw new Error("no game frame");
  return frame;
}

/**
 * Whether the local game is paused, from its own channel's heartbeat.
 *
 * @param page - The test page.
 * @returns The heartbeat's `paused`.
 */
function localPaused(page: Page): Promise<boolean> {
  return gameFrame(page).evaluate(() => {
    const editor = Reflect.get(globalThis, "editor") as {
      channel: { heartbeat(): { paused: boolean } };
    };
    return editor.channel.heartbeat().paused;
  });
}

/** What `resetLogs` emptied: log entries of each page, and the Console's held lines. */
type Emptied = { readonly tools: number; readonly game: number; readonly console: number };

/**
 * Empties the logs of the tools page and of the game page and clears the Console before a
 * measurement. As M3 does on the server: `@moku-labs/common`'s log keeps every entry until
 * `reset()` (decisions.md 2026-10-16, a dependency follow-up), and every source switch logs. The
 * Console keeps up to 5000 lines and draws a window of them (its rows plus a 20-row band), so its
 * table fills by a few rows each window until that band is full: bounded, but growth that repeats
 * across windows. Cleared, it holds one "Console cleared" row at every measurement.
 *
 * @param page - The test page.
 * @returns What was emptied.
 */
async function resetLogs(page: Page): Promise<Emptied> {
  const { log: tools, console: lines } = (await viaTools(page, "reset-log")) as {
    log: number;
    console: number;
  };
  const game = await gameFrame(page).evaluate(() => {
    const editor = Reflect.get(globalThis, "editor") as {
      log: { trace(): readonly unknown[]; reset(): void };
    };
    const entries = editor.log.trace().length;
    editor.log.reset();
    return entries;
  });
  return { tools, game, console: lines };
}

/** The source facts the churn checks, read from the tools page's own plugins. */
type SourceFacts = { readonly markers: number; readonly deviceSessions: number };

/** What `viaTools` does on the tools page. */
type ToolsOperation = "connect-wire" | "stop-devices" | "facts" | "reset-log";

/**
 * Runs one operation with the tools page's activeSource and link. The bin's tools page does not
 * publish its app, so they come from the context the workspace's shell renders with: Preact keeps
 * the mount's root vnode on the mount element (`__k`, Preact 10), and a plugin context's `require`
 * resolves a plugin by its name. "connect-wire" is `activeSource.connectWire()` (device mode on,
 * the adb listener; a taken port rejects with connect's message), "stop-devices"
 * `activeSource.stopDevices()`, "facts" the length of `activeSource.markers()` and the device
 * sessions of `link.sessions()`, "reset-log" empties the page's log (`ctx.log.reset()`) and clears
 * the Console (`consoleView.clear()`), and answers how many entries and lines they held.
 *
 * @param page - The test page.
 * @param operation - The operation.
 * @returns connectWire's listen, nothing, the facts, or the entries the log held.
 */
function viaTools(page: Page, operation: ToolsOperation): Promise<unknown> {
  return page.evaluate(async op => {
    type Ctx = {
      require(plugin: { readonly name: string }): unknown;
      readonly log: { trace(): readonly unknown[]; reset(): void };
    };
    type Vnode = {
      readonly props?: { readonly ctx?: Partial<Ctx> };
      readonly __k?: readonly (Vnode | null)[] | null;
    };
    const root = document.querySelector<HTMLElement & { __k?: Vnode }>("[data-editor-root]");
    // Breadth first from the root vnode: the shell, the first vnode with a plugin context.
    const queue: Vnode[] = root?.__k ? [root.__k] : [];
    let vnode = queue.shift();
    while (vnode !== undefined && typeof vnode.props?.ctx?.require !== "function") {
      queue.push(...(vnode.__k ?? []).filter(child => child !== null && child !== undefined));
      vnode = queue.shift();
    }
    const ctx = vnode?.props?.ctx as Ctx | undefined;
    if (ctx === undefined) throw new Error("[e2e] no plugin context under [data-editor-root]");
    const activeSource = ctx.require({ name: "activeSource" }) as {
      connectWire(): Promise<unknown>;
      stopDevices(): Promise<void>;
      markers(): readonly unknown[];
    };
    const link = ctx.require({ name: "link" }) as { sessions(): readonly { device?: unknown }[] };
    const operations = {
      "connect-wire": () => activeSource.connectWire(),
      "stop-devices": () => activeSource.stopDevices(),
      facts: () => ({
        markers: activeSource.markers().length,
        deviceSessions: link.sessions().filter(session => Boolean(session.device)).length
      }),
      "reset-log": () => {
        const consoleView = ctx.require({ name: "consoleView" }) as {
          lines(): readonly unknown[];
          clear(): void;
        };
        const emptied = { log: ctx.log.trace().length, console: consoleView.lines().length };
        ctx.log.reset();
        consoleView.clear();
        return emptied;
      }
    };
    return operations[op]();
  }, operation);
}

/** The fake phone: its process and the steps it printed. */
type FakePhone = { readonly child: ChildProcess; readonly lines: string[] };

/**
 * Starts the fake phone on the adb listener.
 *
 * @param address - The adb listener's host:port.
 * @returns The phone.
 */
function startPhone(address: string): FakePhone {
  const child = spawn(
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- Bun is the project's runtime (CLAUDE.md); a dev machine has it on PATH.
    "bun",
    ["e2e/fake-device.ts", "--address", address, "--fixture", FIXTURE],
    { cwd: REPO, stdio: ["ignore", "pipe", "pipe"] }
  );
  const lines: string[] = [];
  const keep = (chunk: Buffer): void => {
    lines.push(...chunk.toString().split("\n").filter(Boolean));
  };
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);
  return { child, lines };
}

/**
 * Stops the fake phone and waits for its exit.
 *
 * @param phone - The phone.
 */
async function stopPhone(phone: FakePhone): Promise<void> {
  if (phone.child.exitCode !== null) return;
  const exited = new Promise(resolve => phone.child.once("exit", resolve));
  phone.child.kill("SIGTERM");
  const timer = setTimeout(() => phone.child.kill("SIGKILL"), 3000);
  await exited;
  clearTimeout(timer);
}

/**
 * Shows Render on the local preview, live, with frames.
 *
 * @param tools - The tools driver.
 */
async function renderLocal(tools: Tools): Promise<void> {
  const { page } = tools;
  await tools.show("render");
  await expect(page.locator("[data-source-pill]")).toHaveAttribute("data-kind", "local");
  await expect(page.locator("[data-source-pill] [data-part=name]")).toContainText("Running");
  await expect(page.locator("[data-render=frames] [data-headline]")).not.toHaveText(
    "No frames yet"
  );
}

/**
 * One round of the popovers: each opens under its trigger and closes with Esc.
 *
 * @param page - The test page.
 */
async function popoverRound(page: Page): Promise<void> {
  for (const id of CHURN_POPOVERS) {
    await page.locator(`[data-popover-trigger="${id}"]`).click();
    await expect(page.locator(`[data-popover="${id}"]`)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-popover]")).toHaveCount(0);
  }
}

/**
 * How many times the fake phone printed a step.
 *
 * @param phone - The phone.
 * @param step - The step, e.g. "session".
 * @returns The count.
 */
function stepsOf(phone: FakePhone, step: string): number {
  return phone.lines.filter(line => line.startsWith(`[fake-device] ${step}`)).length;
}

/**
 * Waits for the source pill to name a kind of source.
 *
 * @param page - The test page.
 * @param kind - "local" or "device".
 */
async function sourceIs(page: Page, kind: "local" | "device"): Promise<void> {
  await expect(page.locator("[data-source-pill]")).toHaveAttribute("data-kind", kind, {
    timeout: LINK_MS
  });
}

/**
 * `useDevice`: the linked phone's Use in the Connect panel, then the panel closed.
 *
 * @param page - The test page.
 */
async function useDevice(page: Page): Promise<void> {
  await page.locator('[data-popover-trigger="connect"]').click();
  await page.locator('[data-popover="connect"] [data-linked-row] [data-action=use]').click();
  await sourceIs(page, "device");
  if ((await page.locator("[data-popover]").count()) > 0) await page.keyboard.press("Escape");
  await expect(page.locator("[data-popover]")).toHaveCount(0);
}

/**
 * `useLocal`: "Use local preview" in the connection bar (the phone stays linked).
 *
 * @param page - The test page.
 */
async function useLocal(page: Page): Promise<void> {
  await page.locator("[data-render=connection] [data-action=use-local]").click();
  await sourceIs(page, "local");
}

/**
 * The phone leaves (SIGUSR1: the local preview takes over with a notice) and rejoins with its
 * token (SIGUSR2: a new session, the phone the source again).
 *
 * @param page - The test page.
 * @param phone - The fake phone, the source now.
 */
async function leaveAndRejoin(page: Page, phone: FakePhone): Promise<void> {
  const sessions = stepsOf(phone, "session");
  phone.child.kill("SIGUSR1");
  await sourceIs(page, "local");
  phone.child.kill("SIGUSR2");
  await expect
    .poll(() => stepsOf(phone, "session"), { message: "the phone rejoins", timeout: LINK_MS })
    .toBeGreaterThan(sessions)
    .catch((error: unknown) => {
      throw new Error(
        `${String(error)}\n  The phone printed: ${phone.lines.slice(-10).join(" | ")}`
      );
    });
  await sourceIs(page, "device");
}

/**
 * Sets the game's overlay window, in the game frame.
 *
 * @param page - The test page.
 * @param mode - "card" or "hidden".
 */
async function overlayMode(page: Page, mode: "card" | "hidden"): Promise<void> {
  await gameFrame(page).evaluate(async value => {
    const editor = Reflect.get(globalThis, "editor") as {
      registry: { command(id: string): { run(input: object): Promise<unknown> } };
    };
    await editor.registry.command("editor.overlay").run({ mode: value });
  }, mode);
}

/**
 * One round of the churn, from and back to the local preview: useDevice, (on even rounds) the phone
 * leaves and rejoins, useLocal, the six workspaces, the popovers on Render, the overlay hidden and
 * open again as a card.
 *
 * @param tools - The tools driver.
 * @param phone - The fake phone, linked.
 * @param round - The round's number over the whole churn (0-based).
 */
async function churnRound(tools: Tools, phone: FakePhone, round: number): Promise<void> {
  const { page } = tools;
  await useDevice(page);
  if (round % 2 === 0) await leaveAndRejoin(page, phone);
  await useLocal(page);
  for (const { id } of WORKSPACES) await tools.show(id);
  await tools.show("render");
  await popoverRound(page);
  await overlayMode(page, "hidden");
  await overlayMode(page, "card");
}

test.use({ reducedMotion: "no-preference" });

test.describe("memory (M4)", () => {
  test("steady on the local preview and on a phone, and after churn, the page does not grow", async ({
    tools,
    errors
  }) => {
    test.setTimeout(600_000);
    const { page } = tools;
    await renderLocal(tools);

    // The game's overlay open as a card, in the game frame.
    await overlayMode(page, "card");

    // One renderer and isolate: the game frame is in the page, with no target of its own.
    const cdp = await page.context().newCDPSession(page);
    expect(gameFrame(page).url()).not.toContain("/__editor/");
    const { targetInfos } = await cdp.send("Target.getTargets");
    expect(
      targetInfos.filter(target => target.type === "iframe").map(target => target.url),
      "the game frame shares the tools page's renderer (no out-of-process iframe target)"
    ).toEqual([]);

    // Each measurement empties both logs and the Console first; what they held is printed per run.
    const logged = { tools: 0, game: 0, console: 0 };
    const take = async (): Promise<Counters> => {
      const emptied = await resetLogs(page);
      logged.tools += emptied.tools;
      logged.game += emptied.game;
      logged.console += emptied.console;
      return measure(cdp);
    };
    const printLogged = (run: string): void => {
      console.log(
        `[leak] M4 ${run} emptied before measuring: log entries tools ${logged.tools}, game ${logged.game}; console lines ${logged.console}`
      );
      logged.tools = 0;
      logged.game = 0;
      logged.console = 0;
    };

    // steady-local.
    await page.waitForTimeout(WARM_MS);
    const local = await take();
    const steadyLocal = await windowsOf(take, STEADY_WINDOWS, () => page.waitForTimeout(WINDOW_MS));
    report("steady-local", local, local, steadyLocal);
    printLogged("steady-local");
    expect(leaks(local, local, steadyLocal, STEADY), "[leak] M4 steady-local").toEqual([]);

    // steady-device: device mode on, the fake phone links and becomes the source. It lists only
    // the nine sources Render reads, so the other workspaces' watches have nothing to follow on it
    // (link keeps them for a later session) and Files finds no game.graph there: both say so at
    // warn, as they would for any session without those sources.
    errors.allow(/event: link:source-missing,/);
    errors.allow(/event: filesView:graph-failed,/);
    const listen = (await viaTools(page, "connect-wire")) as { adb: string };
    const phone = startPhone(listen.adb);
    try {
      await expect
        .poll(() => stepsOf(phone, "session"), {
          message: "the fake phone pairs and opens its session",
          timeout: LINK_MS
        })
        .toBe(1);
      await sourceIs(page, "device");
      await expect(page.locator("[data-render=workspace]")).toHaveAttribute("data-src", "device");
      await expect(page.locator("[data-render=frames] [data-headline]")).toContainText(" in view");
      await expect(page.locator("[data-card-kind=memory]")).toContainText(
        "Memory is not measured on this device"
      );
      await expect.poll(() => localPaused(page), { timeout: 10_000 }).toBe(true);

      await page.waitForTimeout(WARM_MS);
      const device = await take();
      const pauses: boolean[] = [];
      const steadyDevice = await windowsOf(take, STEADY_WINDOWS, async () => {
        await page.waitForTimeout(WINDOW_MS);
        pauses.push(await localPaused(page));
      });
      report("steady-device", device, device, steadyDevice);
      printLogged("steady-device");
      expect(leaks(device, device, steadyDevice, STEADY), "[leak] M4 steady-device").toEqual([]);
      expect(pauses, "the local preview stays paused while the phone is the source").toEqual(
        Array.from({ length: STEADY_WINDOWS }, () => true)
      );
      await sourceIs(page, "device");

      // churn, from the local preview with the phone linked: 20 × useDevice ⇄ useLocal, 10 × the
      // phone leaves and rejoins, 20 × the six workspaces, 20 × the popovers (the Connect panel's
      // scan lease on and off), 20 × the overlay hidden and open; each window back to Render on
      // the local preview, settled. Nodes and listeners against the steady-local baseline; the
      // heap against the churn's start (the 2-minute frame history fills through the steady runs,
      // by design: decisions.md).
      await useLocal(page);
      await renderLocal(tools);
      await page.waitForTimeout(SETTLE_MS);
      const churnStart = await take();
      const churn = await windowsOf(take, CHURN_WINDOWS, async window => {
        for (let round = 0; round < CHURN_ROUNDS; round += 1) {
          await churnRound(tools, phone, window * CHURN_ROUNDS + round);
        }
        await renderLocal(tools);
        await page.waitForTimeout(SETTLE_MS);
      });
      const churnBase: Counters = { ...local, heap: churnStart.heap, used: churnStart.used };
      report("churn", churnBase, churnStart, churn);
      printLogged("churn");
      const churnLimits: Ceilings = {
        heap: STEADY.heap,
        nodes: Math.round(local.nodes * CHURN_SHARE),
        listeners: Math.round(local.listeners * CHURN_SHARE)
      };
      expect(leaks(churnBase, churnStart, churn, churnLimits), "[leak] M4 churn").toEqual([]);

      // After the churn: the markers bounded, the phone's old sessions gone, the local preview
      // running (every pause resumed).
      const facts = (await viaTools(page, "facts")) as SourceFacts;
      console.log(
        `[leak] M4 churn markers ${facts.markers} (bound ${MARKERS_MAX}), device sessions ${facts.deviceSessions}, rejoins ${stepsOf(phone, "session") - 1}`
      );
      expect(facts.markers, "activeSource.markers() stays within its bound").toBeLessThanOrEqual(
        MARKERS_MAX
      );
      expect(facts.deviceSessions, "one device session in link.sessions()").toBe(1);
      await expect(page.locator("[data-render=workspace]")).toHaveAttribute("data-src", "local");
      expect(await localPaused(page), "the local preview runs after the churn").toBe(false);
    } finally {
      await stopPhone(phone);
      await viaTools(page, "stop-devices");
    }
  });
});
