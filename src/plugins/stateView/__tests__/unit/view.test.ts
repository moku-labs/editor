// @vitest-environment happy-dom
/* eslint-disable unicorn/no-null -- null is a JSON value on the wire */
import type { ComponentChild } from "preact";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PanelTools } from "../../../panels/types";
import type { Json, LinkStatus } from "../../../registry/protocol";
import { createStateViewApi } from "../../api";
import { createStatePanel } from "../../panel";
import { acceptModel } from "../../tracker";
import type { StateViewApi } from "../../types";
import { JsonTree } from "../../view/JsonTree";
import { GRAPH, HISTORY, MODEL_AFTER, MODEL_BEFORE, POSITION } from "../fixtures";
import { createCtx, type TestCtx } from "../helpers";

let ctx: TestCtx;
let api: StateViewApi;
let root: HTMLElement;

/**
 * The panel tools a view gets.
 *
 * @param status - The link status.
 * @returns The tools.
 */
function toolsOf(status: LinkStatus): PanelTools<Readonly<Record<string, string>>> {
  return {
    run: {},
    status,
    channel: ctx.link.api,
    files: ctx.link.api.files,
    workspace: undefined
  } as unknown as PanelTools<Readonly<Record<string, string>>>;
}

/**
 * Renders a vnode into the root inside act().
 *
 * @param vnode - What to render.
 */
function show(vnode: ComponentChild): void {
  act(() => {
    render(vnode, root);
  });
}

/**
 * Renders the State panel view.
 *
 * @param model - The game.model value.
 * @param status - The link status.
 */
function showPanel(model: Json = MODEL_AFTER, status?: LinkStatus): void {
  show(
    createStatePanel(ctx).view(
      { model, position: POSITION, history: HISTORY },
      toolsOf(status ?? { kind: "live", frame: 1840 })
    )
  );
}

/**
 * The element matching a selector, or a failure.
 *
 * @param selector - CSS selector.
 * @returns The element.
 */
function find(selector: string): HTMLElement {
  const found = root.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`nothing matches ${selector}`);
  return found;
}

/**
 * A tree row by pointer.
 *
 * @param pointer - The JSON pointer.
 * @returns The row.
 */
function row(pointer: string): HTMLElement {
  return find(`[role="treeitem"][data-pointer="${pointer}"]`);
}

/**
 * The text of the Runner property with a label.
 *
 * @param label - The dt text.
 * @returns The dd text.
 */
function propValue(label: string): string | null | undefined {
  return [...root.querySelectorAll("dt")].find(term => term.textContent === label)
    ?.nextElementSibling?.textContent;
}

/**
 * Mounts a JsonTree on a value.
 *
 * @param value - The value.
 * @param pageSize - Children per page.
 */
function showTree(value: Json, pageSize = 100): void {
  show(h(JsonTree, { api, pageSize, value, root: "player", commit: undefined }));
}

/**
 * Presses a key on an element inside act().
 *
 * @param element - The element.
 * @param key - The key.
 */
function press(element: Element, key: string): void {
  act(() => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

/**
 * Clicks an element inside act().
 *
 * @param element - The element.
 */
function click(element: Element): void {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(() => {
  ctx = createCtx();
  api = createStateViewApi(ctx);
  root = document.createElement("div");
  root.dataset.panel = "state";
  document.body.append(root);
});

afterEach(() => {
  act(() => {
    render(undefined, root);
  });
  document.body.innerHTML = "";
});

describe("StateView", () => {
  it("titles the workspace with the frame and the ~f commit frame", () => {
    acceptModel(ctx, MODEL_BEFORE);
    acceptModel(ctx, MODEL_AFTER);
    showPanel();
    expect(find("[data-part='title']").textContent).toBe(
      "State · player and session at frame 1840 · last commit ~f1503"
    );
    expect(find("[data-part='title'] abbr").getAttribute("title")).toBe(
      "Frame of the heartbeat when the commit arrived. The engine does not report the commit frame yet."
    );
  });

  it("titles without a frame or a commit while connecting", () => {
    showPanel(MODEL_AFTER, { kind: "connecting" });
    expect(find("[data-part='title']").textContent).toBe("State · player and session");
  });

  it("marks changed rows with data-changed and a was chip, ancestors with data-has-change", () => {
    acceptModel(ctx, MODEL_BEFORE);
    acceptModel(ctx, MODEL_AFTER);
    showPanel();
    click(find("[data-part='expand-all']"));
    const energy = row("/player/merge/energy/value");
    expect(energy.dataset.changed).toBe("");
    expect(energy.querySelector("[data-part='was']")?.textContent).toBe("was 8");
    expect(
      row("/player/merge/board/items/0").querySelector("[data-part='added']")?.textContent
    ).toBe("added");
    expect(row("/player/merge").dataset.hasChange).toBe("");
    expect(row("/player/merge").dataset.changed).toBeUndefined();
    expect(row("/player/claimed").dataset.hasChange).toBeUndefined();
    expect(energy.querySelector("[data-kind='number']")?.textContent).toBe("7");
  });

  it("opens rows to expandDepth and collapses everything on Collapse all", () => {
    acceptModel(ctx, MODEL_AFTER);
    showPanel();
    expect(row("/player").getAttribute("aria-expanded")).toBe("true");
    expect(row("/player/merge").getAttribute("aria-level")).toBe("2");
    expect(root.querySelector("[data-pointer='/player/merge/energy/value']")).toBeNull();
    expect(row("/player/merge/energy").textContent).toContain("{3}");
    click(find("[data-part='collapse-all']"));
    expect(row("/player").getAttribute("aria-expanded")).toBe("false");
    expect(root.querySelector("[data-pointer='/player/merge']")).toBeNull();
  });

  it("shows the session tree with the not saved tag", () => {
    showPanel();
    expect(find("[data-part='session-card'] [data-tag='mut']").textContent).toBe("not saved");
    expect(row("/session/taps").textContent).toContain("3");
    expect(row("/session/selected").querySelector("[data-kind='string']")?.textContent).toBe(
      '"i3"'
    );
  });

  it("renders empty columns for a value that is no snapshot", () => {
    showPanel("nope");
    expect(root.querySelectorAll("[role='tree']")).toHaveLength(0);
  });

  it("renders without any class attribute", () => {
    acceptModel(ctx, MODEL_BEFORE);
    acceptModel(ctx, MODEL_AFTER);
    showPanel();
    expect(root.querySelectorAll("[class]")).toHaveLength(0);
  });

  it("re-renders when the tracker changes", () => {
    showPanel();
    expect(root.querySelector("[data-part='patches']")).toBeNull();
    act(() => {
      acceptModel(ctx, MODEL_BEFORE);
      acceptModel(ctx, MODEL_AFTER);
    });
    expect(root.querySelectorAll("[data-part='patches'] > li")).toHaveLength(4);
  });
});

describe("StateView narrow layout", () => {
  it("keeps the four cards in reading order: Player, Last commit, Session, Runner", () => {
    showPanel();
    const labels = [...root.querySelectorAll("[data-card]")].map(card =>
      card.getAttribute("aria-label")
    );
    expect(labels).toEqual(["Player", "Last commit", "Session", "Runner"]);
  });

  it("gives every card a collapse toggle in its head that marks the card collapsed", () => {
    acceptModel(ctx, MODEL_BEFORE);
    acceptModel(ctx, MODEL_AFTER);
    showPanel();
    for (const card of root.querySelectorAll<HTMLElement>("[data-card]")) {
      const label = card.getAttribute("aria-label") ?? "";
      const toggle = card.querySelector<HTMLButtonElement>(
        ":scope > [data-part='head'] > [data-action='toggle-card']"
      );
      expect(toggle?.getAttribute("aria-expanded"), label).toBe("true");
      expect(toggle?.getAttribute("aria-label")).toBe(`Collapse ${label}`);
      expect(card.dataset.collapsed).toBeUndefined();
      if (toggle === null) continue;

      click(toggle);
      expect(card.dataset.collapsed, label).toBe("");
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(toggle.getAttribute("aria-label")).toBe(`Expand ${label}`);

      click(toggle);
      expect(card.dataset.collapsed).toBeUndefined();
    }
  });

  it("keeps a collapsed Last commit card collapsed when the first commit arrives", () => {
    showPanel();
    click(find("[data-part='patch-list'] [data-action='toggle-card']"));
    act(() => {
      acceptModel(ctx, MODEL_BEFORE);
      acceptModel(ctx, MODEL_AFTER);
    });
    expect(find("[data-part='patch-list']").dataset.collapsed).toBe("");
    expect(root.querySelectorAll("[data-part='patches'] > li")).toHaveLength(4);
  });
});

describe("PatchList", () => {
  it("lists the patches with op tags, the ~f frame and the count", () => {
    acceptModel(ctx, MODEL_BEFORE);
    acceptModel(ctx, MODEL_AFTER);
    showPanel();
    const list = find("[data-part='patch-list']");
    expect(list.querySelector("[data-part='frame']")?.textContent).toBe("~f1503");
    expect(list.querySelector("[data-part='count']")?.textContent).toBe("4 patches");
    const items = [...list.querySelectorAll<HTMLElement>("[data-part='patches'] > li")];
    expect(items.map(item => item.dataset.op)).toEqual(["add", "replace", "replace", "replace"]);
    expect(items[0]?.querySelector("[data-tag='ok']")?.textContent).toBe("add");
    expect(items[1]?.querySelector("[data-tag='acc']")?.textContent).toBe("replace");
    expect(items[1]?.querySelector("[data-part='pointer']")?.textContent).toBe(
      "/player/merge/energy/value"
    );
    expect(items[1]?.querySelector("s")?.textContent).toBe("8");
    expect(items[1]?.querySelector("[data-part='value']")?.textContent).toBe("7");
  });

  it("shows +N more, rng advanced and a cut value with its full title", () => {
    ctx = createCtx({ maxPatches: 1 });
    api = createStateViewApi(ctx);
    acceptModel(ctx, { player: { a: 1, b: 2 }, session: { s: "x".repeat(200) }, rng: 1 });
    acceptModel(ctx, { player: { a: 2, b: 3 }, session: { s: "y".repeat(200) }, rng: 2 });
    showPanel({ player: { a: 2, b: 3 }, session: {}, rng: 2 });
    expect(find("[data-part='more']").textContent).toBe("+2 more patches");
    expect(find("[data-part='meta']").textContent).toBe("rng advanced");
    expect(find("[data-part='count']").textContent).toBe("3 patches");
  });

  it("cuts long values at 120 chars and keeps the full value in title", () => {
    acceptModel(ctx, { player: { s: "x" }, session: {} });
    acceptModel(ctx, { player: { s: "y".repeat(200) }, session: {} });
    showPanel({ player: {}, session: {} });
    const value = find("[data-part='patches'] [data-part='value']");
    expect(value.textContent).toHaveLength(120);
    expect(value.textContent?.endsWith("…")).toBe(true);
    expect(value.getAttribute("title")).toBe(JSON.stringify("y".repeat(200)));
  });

  it("strikes the old value of a remove and says 1 patch", () => {
    acceptModel(ctx, { player: { a: 1, b: 2 }, session: {} });
    acceptModel(ctx, { player: { a: 1 }, session: {} });
    showPanel({ player: { a: 1 }, session: {} });
    expect(find("[data-part='count']").textContent).toBe("1 patch");
    expect(find("[data-part='patches'] [data-tag='err']").textContent).toBe("remove");
    expect(find("[data-part='patches'] s").textContent).toBe("2");
  });

  it("says why there is no commit, by note", () => {
    showPanel();
    expect(find("[data-part='patch-list'] [data-part='empty']").textContent).toBe("");
    acceptModel(ctx, MODEL_BEFORE);
    showPanel();
    expect(find("[data-part='empty']").textContent).toBe(
      "No commit seen yet · patches appear after the next commit"
    );
    act(() => {
      ctx.state.note = "reloaded";
      for (const listener of ctx.state.listeners) listener();
    });
    expect(find("[data-part='empty']").textContent).toBe(
      "Game page reloaded · waiting for the next commit"
    );
  });
});

describe("RunnerCard", () => {
  it("shows path, flow · node, the derived stack, link, taint, last edge and the gate tags", () => {
    ctx.state.graph = GRAPH;
    ctx.state.tainted = false;
    showPanel();
    const card = find("[data-part='runner-card']");
    const props = Object.fromEntries(
      [...card.querySelectorAll("dt")].map(term => [
        term.textContent,
        term.nextElementSibling?.textContent
      ])
    );
    expect(props).toEqual({
      path: "board/awaitIntent",
      "flow · node": "board · awaitIntent",
      stack: "main/board › board/awaitIntent",
      link: "live at frame 1840",
      tainted: "clean",
      "last edge": 'board/merge · rejected {"reason":"empty"}'
    });
    expect(card.querySelector("[data-part='gate-title']")?.textContent).toBe("Gate waits for 3");
    expect(
      [...card.querySelectorAll("[data-part='gate'] [data-tag]")].map(tag => tag.textContent)
    ).toEqual(["tap", "merge", "leave"]);
  });

  it("falls back to the raw path, shows tainted, unknown and the other link kinds", () => {
    ctx.state.tainted = true;
    showPanel(MODEL_AFTER, { kind: "paused", frame: 12 });
    expect(propValue("stack")).toBe("board/awaitIntent");
    expect(propValue("link")).toBe("paused at frame 12");
    expect(find("[data-part='runner-card'] [data-tag='err']").textContent).toBe("tainted");
    ctx.state.tainted = undefined;
    for (const [status, text] of [
      [{ kind: "connecting" }, "connecting"],
      [{ kind: "silent", since: 1, lastFrame: 9 }, "silent at frame 9"],
      [{ kind: "lost", reason: "socket_closed", lastFrame: 9, retryInMs: 1000 }, "lost at frame 9"],
      [{ kind: "empty" }, "no game"]
    ] as const) {
      showPanel(MODEL_AFTER, status);
      expect(propValue("link")).toBe(text);
    }
    expect(propValue("tainted")).toBe("unknown");
  });

  it("handles a position and a history without the expected fields", () => {
    show(
      createStatePanel(ctx).view(
        { model: MODEL_AFTER, position: null, history: [] },
        toolsOf({ kind: "live", frame: 1 })
      )
    );
    const card = find("[data-part='runner-card']");
    expect(card.querySelector("[data-part='gate-title']")?.textContent).toBe("Gate waits for 0");
    expect([...card.querySelectorAll("dd")].map(item => item.textContent)).toContain("—");
  });
});

describe("JsonTree keyboard and paging", () => {
  it("moves focus with ↑/↓, Home and End and keeps one tab stop", () => {
    showTree({ a: 1, b: { c: 2 }, d: 3 });
    const first = row("/player");
    expect(first.getAttribute("tabindex")).toBe("0");
    expect(root.querySelectorAll("[tabindex='0']")).toHaveLength(1);
    first.focus();
    press(first, "ArrowDown");
    expect(document.activeElement).toBe(row("/player/a"));
    press(row("/player/a"), "End");
    expect(document.activeElement).toBe(row("/player/d"));
    press(row("/player/d"), "ArrowUp");
    expect(document.activeElement).toBe(row("/player/b/c"));
    press(row("/player/b/c"), "Home");
    expect(document.activeElement).toBe(row("/player"));
    press(row("/player"), "ArrowUp");
    expect(document.activeElement).toBe(row("/player"));
  });

  it("→ opens a closed row then moves to its first child; ← closes it then moves to the parent", () => {
    showTree({ b: { c: { d: 1 } } });
    const closed = row("/player/b/c");
    expect(closed.getAttribute("aria-expanded")).toBe("false");
    press(closed, "ArrowRight");
    expect(row("/player/b/c").getAttribute("aria-expanded")).toBe("true");
    press(row("/player/b/c"), "ArrowRight");
    expect(document.activeElement).toBe(row("/player/b/c/d"));
    press(row("/player/b/c/d"), "ArrowRight");
    expect(document.activeElement).toBe(row("/player/b/c/d"));
    press(row("/player/b/c/d"), "ArrowLeft");
    expect(document.activeElement).toBe(row("/player/b/c"));
    press(row("/player/b/c"), "ArrowLeft");
    expect(row("/player/b/c").getAttribute("aria-expanded")).toBe("false");
    press(row("/player"), "ArrowLeft");
    expect(row("/player").getAttribute("aria-expanded")).toBe("false");
    press(row("/player"), "ArrowLeft");
    press(row("/player"), "x");
    expect(document.activeElement).toBe(row("/player"));
  });

  it("toggles a container on click and focuses the row", () => {
    showTree({ b: { c: 1 } });
    click(row("/player/b"));
    expect(row("/player/b").getAttribute("aria-expanded")).toBe("false");
    expect(row("/player/b").getAttribute("tabindex")).toBe("0");
    click(row("/player/b"));
    expect(row("/player/b").getAttribute("aria-expanded")).toBe("true");
  });

  it("pages large containers with a Show N more row", () => {
    showTree([1, 2, 3, 4, 5], 2);
    expect(root.querySelectorAll("[role='treeitem']")).toHaveLength(4);
    const more = find("[data-part='show-more']");
    expect(more.textContent).toBe("Show 2 more");
    click(more);
    expect(find("[data-part='show-more']").textContent).toBe("Show 1 more");
    click(find("[data-part='show-more']"));
    expect(root.querySelector("[data-part='show-more']")).toBeNull();
    expect(row("/player/4").textContent).toContain("5");
  });

  it("moves focus onto a Show more row and back", () => {
    showTree([1, 2, 3], 1);
    press(row("/player"), "End");
    expect((document.activeElement as HTMLElement | null)?.dataset.part).toBe("show-more-row");
    press(document.activeElement as Element, "ArrowLeft");
    expect(document.activeElement).toBe(row("/player"));
  });
});
