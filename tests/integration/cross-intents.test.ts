import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import type { ToolsEvents } from "../../src/config";
import {
  type Logged,
  logErrors,
  PNG_1X1,
  paramsOf,
  type Stack,
  type StackOptions,
  settle,
  shutdown,
  startStack,
  type Tap,
  trackUnhandled,
  type UnhandledTracker,
  until
} from "./helpers/stack";

// ─────────────────────────────────────────────────────────────────────────────
// Cross-plugin intents I1–I5 (plan §3, cross-intents.test.ts): the global
// tools events that let one view ask another for something without a
// view-to-view dependency. workspace:changed fans out (I1); the flow, file,
// sheet and scene intents reach the view that hooks them (I2–I4); and
// workspace:ran carries every origin to stateView and consoleView (I5).
// ─────────────────────────────────────────────────────────────────────────────

let stack: Stack | undefined;
let unhandled: UnhandledTracker | undefined;

afterEach(async () => {
  unhandled?.stop();
  unhandled = undefined;
  await shutdown(stack);
  stack = undefined;
});

/** Bun's own Event, taken before the page stubs `Event` with the happy-dom class. */
const NativeEvent = globalThis.Event;

/** The six workspaces in the order I1 shows them. */
const SHOWN = ["game", "render", "state", "files", "console", "flow"] as const;

/** The scene sources gameView and renderView watch only while their workspace is shown. */
const SCENE_IDS = ["game.entities", "game.projections", "game.ui"] as const;

/** Sources a screenless tiny game fails to read: one `link:watch-failed` each, at error level. */
const SCREENLESS_IDS: ReadonlySet<string> = new Set([
  "game.render",
  "game.assets",
  "game.effects",
  "game.ui",
  "game.entities",
  "game.projections"
]);

/**
 * Starts the whole stack with a renderer that answers a 1×1 PNG and tracks unhandled rejections.
 *
 * @param options - The startStack options.
 * @returns The live stack.
 */
async function liveStack(options: StackOptions = {}): Promise<Stack> {
  unhandled = trackUnhandled();
  stack = await startStack({ agent: { png: PNG_1X1 }, ...options });
  return stack;
}

/**
 * The error entries of the apps, without the watch failures a screenless tiny game causes.
 *
 * @param apps - The apps to read.
 * @returns The other error entries.
 */
function realErrors(...apps: readonly Logged[]) {
  return logErrors(...apps).filter(entry => {
    const data: { readonly id?: unknown } = entry.data ?? {};
    return !(
      entry.event === "link:watch-failed" &&
      typeof data.id === "string" &&
      SCREENLESS_IDS.has(data.id)
    );
  });
}

/**
 * Every app of a stack, for the clean check.
 *
 * @param live - The live stack.
 * @returns The four apps.
 */
function appsOf(live: Stack): Logged[] {
  return [live.server.app, live.agent.app, live.tools.app, live.game.app];
}

/**
 * One element under a root, failing loudly when it is missing.
 *
 * @param root - Where to look.
 * @param selector - A CSS selector.
 * @returns The element.
 * @throws {Error} When nothing matches.
 */
function elementIn(root: ParentNode, selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (element === null) throw new Error(`no element matches ${selector}`);
  return element;
}

/**
 * Clicks an element inside `act`, so Preact renders what the click changed.
 *
 * @param element - The element.
 * @returns Resolves after the render.
 */
async function click(element: HTMLElement): Promise<void> {
  await act(() => {
    element.click();
  });
}

/**
 * Presses a key the way the workspace listens: its one keydown listener sits on `globalThis`
 * (the window in a browser). In the node environment `globalThis` is Bun's global, whose
 * `dispatchEvent` takes only a Bun `Event`, while the listener checks `instanceof KeyboardEvent`
 * against the stubbed happy-dom class. So the event is a Bun `Event` with the happy-dom
 * `KeyboardEvent` prototype and its key fields as own properties.
 *
 * @param key - The `key` of the press.
 * @returns Resolves after the render.
 */
async function pressKey(key: string): Promise<void> {
  const event = new NativeEvent("keydown", { cancelable: true });
  Object.setPrototypeOf(event, globalThis.KeyboardEvent.prototype);
  Object.defineProperties(event, {
    key: { value: key },
    code: { value: "" },
    metaKey: { value: false },
    ctrlKey: { value: false },
    altKey: { value: false },
    shiftKey: { value: false },
    target: { value: globalThis.document.body },
    preventDefault: { value: () => undefined }
  });
  await act(() => {
    globalThis.dispatchEvent(event);
  });
}

/**
 * How many `watch` requests for one source the tools app sent through the hub so far. A screenless
 * game fails the scene watches, so the link never sends their `unwatch` (it has no wire sub to
 * drop): the requests, not the open watches, show who started watching when.
 *
 * @param live - The live stack.
 * @param id - The source id.
 * @returns The number of watch requests.
 */
function watchRequests(live: Stack, id: string): number {
  return live.server.tap
    .requests("tools", "watch", "game")
    .filter(message => paramsOf(message)?.id === id).length;
}

/**
 * The watch requests of each scene source so far.
 *
 * @param live - The live stack.
 * @returns One count per scene id, in SCENE_IDS order.
 */
function sceneRequests(live: Stack): number[] {
  return SCENE_IDS.map(id => watchRequests(live, id));
}

/**
 * True when every tools watch of a source got at least one value from the hub.
 *
 * @param tap - The wire tap.
 * @param id - The source id.
 * @returns Whether all its watches delivered.
 */
function delivered(tap: Tap, id: string): boolean {
  const subs = tap
    .requests("tools", "watch", "game")
    .filter(message => paramsOf(message)?.id === id)
    .map(message => paramsOf(message)?.sub);
  const valued = new Set(tap.sent("tools", "value", "game").map(note => paramsOf(note)?.sub));
  return subs.length > 0 && subs.every(sub => valued.has(sub));
}

/**
 * The texts of the toasts in the page.
 *
 * @param live - The live stack.
 * @returns One text per visible toast.
 */
function toastTexts(live: Stack): string[] {
  return [...live.page.root.querySelectorAll("[data-toast]")].map(toast => toast.textContent ?? "");
}

describe("cross-intents: workspace:changed", () => {
  it("I1: fans out to every view; scene watches follow the shown workspace", async () => {
    const live = await liveStack();
    const { tools } = live;
    const { workspace } = tools.app;
    const changedBefore = tools.eventsOf("workspace:changed").length;
    expect(workspace.active()).toBe("flow");
    expect(sceneRequests(live)).toEqual([0, 0, 0]);

    const scenes: Partial<Record<(typeof SHOWN)[number], number[]>> = {};
    for (const ws of SHOWN) {
      workspace.show(ws);
      expect(workspace.active()).toBe(ws);
      const host = workspace.host(ws);
      await until(
        () => host.querySelector(`[data-panel="${ws}"][data-panel-state="ready"]`) !== null,
        `the ${ws} panel ready in its host`
      );
      if (ws === "game" || ws === "render") {
        const expected = ws === "game" ? 1 : 2;
        await until(
          () => sceneRequests(live).every(count => count === expected),
          `the ${ws} scene watches`
        );
      }
      await settle();
      scenes[ws] = sceneRequests(live);
    }

    expect(tools.eventsOf("workspace:changed").slice(changedBefore)).toEqual(
      SHOWN.map(ws => ({ ws }))
    );
    // Game opens one watch per scene source, Render its own set; State, Files, Console and Flow
    // open none.
    expect(scenes).toEqual({
      game: [1, 1, 1],
      render: [2, 2, 2],
      state: [2, 2, 2],
      files: [2, 2, 2],
      console: [2, 2, 2],
      flow: [2, 2, 2]
    });
    // Both views stopped their watches on leaving: showing them again starts a fresh set
    // (a view still watching would not).
    workspace.show("game");
    await until(() => sceneRequests(live).every(count => count === 3), "Game watching again");
    workspace.show("render");
    await until(() => sceneRequests(live).every(count => count === 4), "Render watching again");

    // renderView's tracker and consoleView's log are session watches: one request, still open.
    expect(watchRequests(live, "game.render")).toBe(1);
    expect(watchRequests(live, "game.assets")).toBe(1);
    expect(watchRequests(live, "game.log")).toBe(1);
    expect(live.server.tap.watchedIds().filter(id => id === "game.log")).toEqual(["game.log"]);
    expect(realErrors(...appsOf(live))).toEqual([]);
    expect(unhandled?.list).toEqual([]);
  });
});

describe("cross-intents: flow intents", () => {
  it("I2: select-node, focus-frame and new-note reach flowView from filesView, consoleView and gameView", async () => {
    const live = await liveStack();
    const { tools } = live;
    const { workspace, filesView, flowView, consoleView, gameView, link } = tools.app;
    // flowView takes its first game.history value as the baseline: play must come after it, or
    // the edge lands in the first batch with no live frame and the label is #0.
    await until(() => delivered(live.server.tap, "game.history"), "flowView's first history value");
    await link.run("game.answer", { intent: "play" });

    // 1. filesView's Used-by chip for home emits workspace:select-node
    await filesView.open("nodes/home.ts");
    workspace.show("files");
    const files = workspace.host("files");
    await until(
      () => files.querySelector('[data-part="used-by"] [data-kind="node"]') !== null,
      "the Used-by chip of home"
    );
    const chip = elementIn(files, '[data-part="used-by"] [data-kind="node"]');
    expect(chip.textContent).toBe("main/home");
    await click(chip);
    await until(() => tools.eventsOf("workspace:select-node").length === 1, "select-node");
    expect(tools.eventsOf("workspace:select-node")).toEqual([{ id: "main/home" }]);
    expect(workspace.active()).toBe("flow");
    expect(flowView.focus.selected()).toBe("main/home");

    // 2. consoleView.focusFrame at the frame of the last edge emits workspace:focus-frame
    const flow = workspace.host("flow");
    expect(flowView.focus.history(true)).toBe(true);
    await until(
      () => flow.querySelector('[data-flow="history-row"] [data-part="frame"]') !== null,
      "the history strip rows"
    );
    // Newest first; the label is f<frame>, the frame flowView saw the edge arrive at.
    const newest = elementIn(flow, '[data-flow="history-row"]');
    const label = elementIn(newest, '[data-part="frame"]').textContent;
    expect(label).toMatch(/^f\d+$/);
    const frame = Number(label.slice(1));
    flowView.focus.select(undefined);
    workspace.show("console");
    await settle();
    consoleView.focusFrame(frame);
    await until(() => tools.eventsOf("workspace:focus-frame").length === 1, "focus-frame");
    expect(tools.eventsOf("workspace:focus-frame")).toEqual([{ frame }]);
    expect(workspace.active()).toBe("flow");
    await until(
      () => toastTexts(live).includes(`Frame ${String(frame)} · home · play`),
      "the toast naming the edge at that frame"
    );
    expect(flowView.focus.selected()).toBe("main/home");
    expect(elementIn(flow, '[data-flow="history-strip"]').dataset.open).toBe("");
    expect(elementIn(newest, '[data-part="outcome"]').textContent).toBe("play → visit/enter");
    // The row of the edge at that frame is the selected one.
    await until(
      () => elementIn(flow, '[data-flow="history-row"]').getAttribute("aria-selected") === "true",
      "the history row of that frame selected"
    );
    expect(
      [...flow.querySelectorAll('[data-flow="history-row"][aria-selected="true"]')].map(
        row => elementIn(row, '[data-part="frame"]').textContent
      )
    ).toEqual([label]);

    // 3. the capture card's "New note…" emits workspace:new-note
    workspace.show("game");
    await settle();
    const capture = await gameView.capture();
    if (capture === undefined) throw new Error("the capture failed");
    expect(capture.path).toMatch(/^\.moku\/captures\/.+\.png$/);
    const game = workspace.host("game");
    await until(
      () => game.querySelector('[data-game="card"] [data-part="attach"] select option') !== null,
      "the capture card's note select"
    );
    const select = elementIn(game, '[data-game="card"] [data-part="attach"] select');
    await act(() => {
      if (select instanceof HTMLSelectElement) select.value = "new";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const newNote = elementIn(game, '[data-game="card"] [data-part="attach"] button');
    expect(newNote.textContent).toBe("New note…");
    await click(newNote);
    await until(() => tools.eventsOf("workspace:new-note").length === 1, "new-note");
    expect(tools.eventsOf("workspace:new-note")).toEqual([
      { captures: [capture.path], from: { node: "home" } }
    ]);
    expect(workspace.active()).toBe("flow");
    await until(
      () => flow.querySelector('[data-flow="note-editor"][open]') !== null,
      "the open note editor"
    );
    const editor = elementIn(flow, '[data-flow="note-editor"]');
    expect(elementIn(editor, '[data-part="context"]').textContent).toBe("On home");
    expect(elementIn(editor, '[data-part="thumbnail"]').getAttribute("alt")).toBe(capture.path);
    // No view depends on another: filesView, consoleView and gameView reached flowView through
    // the global tools events alone.
    expect(realErrors(...appsOf(live))).toEqual([]);
    expect(unhandled?.list).toEqual([]);
  });
});

describe("cross-intents: file and sheet intents", () => {
  it("I3: open-file from flowView's Code tab and open-sheet from filesView's series card", async () => {
    const live = await liveStack();
    const { tools } = live;
    const { workspace, filesView, flowView, gameView } = tools.app;
    const series = await gameView.series({ durationMs: 300, intervalMs: 100 });
    if (series === undefined) throw new Error("the series was refused");

    // 1. flowView's Code tab "Open in Files" emits workspace:open-file
    workspace.show("flow");
    const flow = workspace.host("flow");
    await until(() => flowView.focus.select("main/home"), "home selectable");
    await until(
      () => flow.querySelector('[data-flow="inspector"] [role="tab"]') !== null,
      "the inspector tabs"
    );
    const codeTab = [
      ...flow.querySelectorAll<HTMLElement>('[data-flow="inspector"] [role="tab"]')
    ].find(tab => tab.textContent === "Code");
    if (codeTab === undefined) throw new Error("no Code tab");
    await click(codeTab);
    await until(
      () => flow.querySelector('[data-flow="code-tab"] [data-action="open-files"]') !== null,
      "the Code tab's Open in Files"
    );
    await click(elementIn(flow, '[data-flow="code-tab"] [data-action="open-files"]'));
    await until(() => tools.eventsOf("workspace:open-file").length === 1, "open-file");
    expect(tools.eventsOf("workspace:open-file")).toEqual([
      { path: "nodes/home.ts", line: expect.any(Number) }
    ]);
    await until(() => workspace.active() === "files", "Files shown");
    await until(() => filesView.active() === "nodes/home.ts", "home.ts the active tab");

    // 2. filesView's series card "Open contact sheet" emits workspace:open-sheet
    await filesView.open(series.indexPath);
    const files = workspace.host("files");
    await until(
      () => files.querySelector('[data-preview="series"] button') !== null,
      "the series card"
    );
    const openSheet = elementIn(files, '[data-preview="series"] button');
    expect(openSheet.textContent).toBe("Open contact sheet");
    await click(openSheet);
    await until(() => tools.eventsOf("workspace:open-sheet").length === 1, "open-sheet");
    expect(tools.eventsOf("workspace:open-sheet")).toEqual([{ index: series.indexPath }]);
    await until(() => workspace.active() === "game", "Game shown");
    const game = workspace.host("game");
    await until(
      () => game.querySelectorAll('[data-game="sheet"] [data-part="tile"]').length === series.shots,
      "a tile per shot on the contact sheet"
    );
    expect(series.shots).toBeGreaterThan(0);
    expect(realErrors(...appsOf(live))).toEqual([]);
    expect(unhandled?.list).toEqual([]);
  });
});

describe("cross-intents: scene intents", () => {
  it("I4: inspect and reveal reach gameView and renderView without a view-to-view dependency", async () => {
    const live = await liveStack();
    const { tools } = live;
    const { workspace, gameView, renderView } = tools.app;
    const ref: ToolsEvents["workspace:inspect"]["ref"] = { kind: "entity", id: 7 };

    // 1. workspace:inspect → gameView shows Game, selects the ref, Element tab
    tools.emit("workspace:inspect", { ref });
    await settle();
    expect(tools.eventsOf("workspace:inspect")).toEqual([{ ref }]);
    expect(workspace.active()).toBe("game");
    expect(gameView.selected()).toEqual(ref);
    const game = workspace.host("game");
    await until(
      () => game.querySelector('#game-tab-element[aria-selected="true"]') !== null,
      "the Element tab active"
    );

    // 2. workspace:reveal → renderView shows Render; the screenless scene has no such node
    expect(() => tools.emit("workspace:reveal", { ref })).not.toThrow();
    await settle();
    expect(workspace.active()).toBe("render");
    expect(renderView.snapshot().tree.some(row => row.id === "entity:7")).toBe(false);

    // 3. the api directly
    workspace.show("flow");
    await settle();
    renderView.reveal(ref);
    expect(workspace.active()).toBe("render");
    expect(renderView.snapshot().tree.some(row => row.id === "entity:7")).toBe(false);
    gameView.select(undefined);
    expect(gameView.selected()).toBeUndefined();
    const pressed = () =>
      workspace
        .host("game")
        .querySelector('[data-game="toolbar"] [data-part="pick"]')
        ?.getAttribute("aria-pressed");
    await settle();
    gameView.pick(true);
    expect(workspace.active()).toBe("game");
    await until(() => pressed() === "true", "the picker on");
    gameView.pick(false);
    await until(() => pressed() === "false", "the picker off");
    expect(realErrors(...appsOf(live))).toEqual([]);
    expect(unhandled?.list).toEqual([]);
  });
});

describe("cross-intents: workspace:ran", () => {
  it("I5: carries every origin; stateView and consoleView react", async () => {
    const live = await liveStack();
    const { tools } = live;
    const { workspace, panels, flowView, link, stateView, consoleView } = tools.app;
    const ranBefore = tools.eventsOf("workspace:ran").length;
    const ran = () => tools.eventsOf("workspace:ran").slice(ranBefore);
    const errorLines = () =>
      consoleView.lines().filter(line => line.kind === "entry" && line.level === "error");

    // 1. the top bar pause button
    expect(link.status().kind).toBe("live");
    await click(elementIn(live.page.root, '[data-ui="top-bar"] [data-action="pause"]'));
    await until(() => ran().length === 1, "the pause run");
    await until(() => link.status().kind === "paused", "the link paused");

    // 2. the step key
    await pressKey(".");
    await until(() => ran().length === 2, "the step run");

    // 4, run before 3: flowView steps only while paused, and 3 resumes.
    const stepped = await flowView.focus.step();
    expect(stepped).toBeDefined();
    expect(ran()).toHaveLength(3);

    // 3. the palette item
    workspace.palette.open("resume");
    await until(
      () => live.page.root.querySelector('[data-ui="palette"] [role="option"]') !== null,
      "the palette options"
    );
    const option = [
      ...live.page.root.querySelectorAll<HTMLElement>('[data-ui="palette"] [role="option"]')
    ].find(item => item.textContent.includes("Resume the game"));
    if (option === undefined) throw new Error("no Resume item in the palette");
    await click(option);
    await until(() => ran().length === 4, "the resume run");
    await until(() => link.status().kind === "live", "the link live");

    // 5. panels.run with no origin
    const commitBefore = stateView.lastCommit();
    const errorsBefore = errorLines().length;
    await panels.run("game.answer", { intent: "play" });
    // The headless game moves only when a test steps it: the commit reaches the watch on a frame.
    await live.game.frames(2);
    await until(() => stateView.lastCommit() !== commitBefore, "a new commit in stateView");

    // 6. a failing command from the palette origin
    await expect(panels.run("tiny.fail", undefined, "palette")).rejects.toThrow("boom");

    // 7. a bound key runs tiny.bump
    const unbind = workspace.keys.bind({
      keys: "b",
      label: "Bump",
      run: () => {
        panels.run("tiny.bump", undefined, "key").catch(() => undefined);
      }
    });
    await pressKey("b");
    await until(() => ran().length === 7, "the bump run");
    unbind();

    const events = ran();
    expect(events.map(event => [event.id, event.origin])).toEqual([
      ["game.pause", "topbar"],
      ["game.step", "key"],
      ["game.step", "panel"],
      ["game.resume", "palette"],
      ["game.answer", "panel"],
      ["tiny.fail", "palette"],
      ["tiny.bump", "key"]
    ]);
    for (const event of events.slice(0, 5)) {
      expect(event).toMatchObject({ ok: true, result: { state: expect.any(Object) } });
    }
    expect(events[5]).toMatchObject({ ok: false, error: { code: -32_000 } });
    expect(events[6]).toMatchObject({ ok: true });

    const added = errorLines().slice(errorsBefore);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ source: "editor", event: "tiny.fail" });
    expect(added[0]).toMatchObject({ message: "-32000 tiny.fail: boom" });
    expect(realErrors(...appsOf(live))).toEqual([]);
    expect(unhandled?.list).toEqual([]);
  });
});
