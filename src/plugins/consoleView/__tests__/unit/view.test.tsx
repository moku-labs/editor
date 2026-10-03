// @vitest-environment happy-dom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PanelTools } from "../../../panels/types";
import type { LinkStatus } from "../../../registry/protocol";
import { createConsoleApi } from "../../api";
import { onCommandRan } from "../../handlers";
import { startConsole } from "../../lifecycle";
import { createConsolePanel } from "../../panel";
import type { ConsoleApi } from "../../types";
import { createCtx, type TestCtx, TRACE, traceValue } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The Console workspace in happy-dom: toolbar (levels with counts, search,
// Clear, Preserve log), the windowed log table (frame links, hits, meta rows,
// fresh errors, keyboard, "N new lines" pill), the detail drawer and the three
// empty states. No class attribute anywhere.
// ─────────────────────────────────────────────────────────────────────────────

let ctx: TestCtx;
let api: ConsoleApi;
let host: HTMLElement;

const LIVE: LinkStatus = { kind: "live", frame: 1840 };

function toolsOf(status: LinkStatus): PanelTools<Readonly<Record<string, string>>> {
  return {
    run: {},
    status,
    channel: ctx.link.api,
    files: ctx.link.api.files,
    workspace: ctx.workspace.api
  };
}

function show(status: LinkStatus = LIVE): void {
  const panel = createConsolePanel(ctx);
  act(() => {
    render(panel.view({}, toolsOf(status)), host);
  });
}

function q<T extends Element = HTMLElement>(selector: string): T | null {
  return host.querySelector<T>(selector);
}

function all(selector: string): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>(selector)];
}

function texts(selector: string): string[] {
  return all(selector).map(element => element.textContent ?? "");
}

function key(element: Element | null, name: string): void {
  act(() => {
    element?.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
  });
}

function click(element: Element | null | undefined): void {
  act(() => {
    (element as HTMLElement | undefined)?.click();
  });
}

function deliver(value = traceValue()): void {
  act(() => {
    ctx.link.send("game.log", value);
  });
}

beforeEach(() => {
  ctx = createCtx();
  api = createConsoleApi(ctx);
  host = document.createElement("div");
  host.dataset.panel = "console";
  document.body.append(host);
  startConsole(ctx);
});

afterEach(() => {
  act(() => {
    render(undefined, host);
  });
  host.remove();
  vi.restoreAllMocks();
});

describe("Console toolbar", () => {
  it("shows the level filter with counts, warn amber and error red when non-zero", () => {
    deliver();
    show();

    const radios = all("[role='radiogroup'] [role='radio']");
    expect(radios.map(radio => radio.dataset.level)).toEqual(["all", "info", "warn", "error"]);
    expect(texts("[role='radio'] [data-count]")).toEqual(["8", "6", "2", "0"]);
    expect(q("[role='radio'][data-level='all']")?.getAttribute("aria-checked")).toBe("true");
    expect(q("[data-level='warn'] [data-count]")?.dataset.tone).toBe("warn");
    expect(q("[data-level='error'] [data-count]")?.dataset.tone).toBeUndefined();

    click(q("[role='radio'][data-level='warn']"));
    expect(api.filter().level).toBe("warn");
    expect(q("[role='radio'][data-level='warn']")?.getAttribute("aria-checked")).toBe("true");
    expect(all("tr[data-key]")).toHaveLength(2);
  });

  it("'/' focuses the search field; typing filters; Esc clears and blurs it", () => {
    deliver();
    show();
    const search = q<HTMLInputElement>("input[aria-label='Search the log']");
    expect(search?.placeholder).toBe("Search the log");

    act(() => ctx.workspace.bindings[0]?.run(new KeyboardEvent("keydown", { key: "/" })));
    expect(document.activeElement).toBe(search);

    act(() => {
      if (search === null) return;
      search.value = "texture";
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(api.filter().query).toBe("texture");
    expect(texts("mark[data-hit]")).toEqual(["texture", "texture"]);

    key(search, "Escape");
    expect(api.filter().query).toBe("");
    expect(document.activeElement).not.toBe(search);
    expect(all("mark[data-hit]")).toHaveLength(0);
  });

  it("Clear empties the console to one meta row; Preserve log is a switch", () => {
    deliver();
    show();
    const clear = q<HTMLButtonElement>("button[title='Clear the console']");
    expect(clear?.textContent).toBe("Clear");
    click(clear);
    expect(texts("tr[data-meta]")).toEqual(["Console cleared"]);

    const preserve = q("[role='switch']");
    expect(preserve?.getAttribute("aria-checked")).toBe("false");
    click(preserve);
    expect(preserve?.getAttribute("aria-checked")).toBe("true");
    expect(api.preserve()).toBe(true);
  });
});

describe("Console log table", () => {
  it("renders Frame, Level, Source, Message rows with level tags", () => {
    deliver();
    show();

    expect(texts("thead th")).toEqual(["Frame", "Level", "Source", "Message"]);
    const rows = all("tr[data-key]");
    expect(rows).toHaveLength(8);
    expect(q("[role='grid']")?.getAttribute("aria-rowcount")).toBe("9");
    const warn = rows[4];
    expect(warn?.dataset.level).toBe("warn");
    expect(warn?.querySelector<HTMLElement>("[data-tag]")?.dataset.tag).toBe("warn");
    expect(warn?.querySelector("[data-col='source']")?.textContent).toBe("assets");
    expect(warn?.querySelector("[data-col='message']")?.textContent).toBe(
      'missing texture {"key":"ui.gear"}'
    );
    expect(rows[0]?.querySelector<HTMLElement>("[data-tag]")?.dataset.tag).toBe("mut");
  });

  it("frame cells link to Flow: exact '1778', inexact '≤1840' with a tooltip", () => {
    deliver();
    show();
    const links = all("button[data-frame-link]");
    expect(links[0]?.textContent).toBe("≤1840");
    expect(links[0]?.title).toBe(
      "Logged at or before frame 1840. The engine log carries no frame yet."
    );
    expect(links[7]?.textContent).toBe("1778");

    click(links[7]);
    expect(ctx.emit).toHaveBeenCalledWith("workspace:focus-frame", { frame: 1778 });
    // The frame click does not open the drawer.
    expect(q("[data-part='drawer']")).toBeNull();
  });

  it("lines without a frame show a dash", () => {
    ctx.link.current = { kind: "connecting" };
    deliver(traceValue([{ level: "info", event: "flow: boot", ts: 1 }]));
    show({ kind: "connecting" });
    expect(q("[data-col='frame']")?.textContent).toBe("—");
    expect(q("button[data-frame-link]")).toBeNull();
  });

  it("meta rows span the row and show their text", () => {
    deliver();
    api.setPreserve(true);
    deliver(traceValue([{ level: "info", event: "flow: boot", ts: 99 }]));
    api.setPreserve(false);
    deliver(traceValue([{ level: "info", event: "flow: boot again", ts: 100 }]));
    show();
    expect(texts("tr[data-meta]")).toEqual([
      "Log cleared: the game page reloaded. Turn on Preserve log to keep it."
    ]);

    api.setPreserve(true);
    act(() => {
      ctx.link.send("game.log", traceValue([{ level: "info", event: "flow: third", ts: 101 }]));
    });
    expect(texts("tr[data-meta]")).toEqual([
      "Log cleared: the game page reloaded. Turn on Preserve log to keep it.",
      "Game page reloaded · log preserved"
    ]);
  });

  it("marks a fresh error row, and not an old one", () => {
    show();
    const failed = {
      id: "game.step",
      input: undefined,
      origin: "topbar" as const,
      at: Date.now(),
      ok: false as const,
      error: { code: -32_602, message: "[moku-editor] game.step: frames must be a number" }
    };
    act(() => onCommandRan(ctx)(failed));
    const row = q("tr[data-level='error']");
    expect(row?.hasAttribute("data-fresh")).toBe(true);
    expect(row?.querySelector("[data-col='message']")?.textContent).toBe(
      "-32602 game.step: frames must be a number"
    );

    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 5000);
    act(() => api.setFilter({ level: "error" }));
    expect(q("tr[data-level='error']")?.hasAttribute("data-fresh")).toBe(false);
  });

  it("a row click opens the drawer; arrows move the selection; Esc closes it", () => {
    deliver();
    show();
    click(all("tr[data-key]")[4]);
    expect(api.selected()?.key).toBe(5);
    expect(q("tr[data-key='5']")?.getAttribute("aria-selected")).toBe("true");

    const drawer = q("[data-part='drawer']");
    expect(drawer?.querySelector("[data-field='event']")?.textContent).toBe(
      "assets: missing texture"
    );
    expect(drawer?.querySelector("pre")?.textContent).toBe('{\n  "key": "ui.gear"\n}');

    const grid = q("[role='grid']");
    key(grid, "ArrowDown");
    expect(api.selected()?.key).toBe(6);
    key(grid, "ArrowUp");
    key(grid, "ArrowUp");
    expect(api.selected()?.key).toBe(4);

    key(grid, "Escape");
    expect(api.selected()).toBeUndefined();
    expect(q("[data-part='drawer']")).toBeNull();

    key(grid, "Enter");
    expect(api.selected()?.key).toBe(1);
    key(grid, "ArrowUp");
    expect(api.selected()?.key).toBe(1);
  });

  it("the drawer shows time, frame link and closes with its button or Esc", () => {
    deliver();
    show();
    act(() => api.select(8));
    const drawer = q("[data-part='drawer']");
    expect(drawer?.querySelector("[data-field='source']")?.textContent).toBe("flow");
    expect(drawer?.querySelector("[data-field='time']")?.textContent).toMatch(
      /^\d{2}:\d{2}:\d{2}\.\d{3}$/
    );
    click(drawer?.querySelector("button[data-frame-link]"));
    expect(ctx.emit).toHaveBeenCalledWith("workspace:focus-frame", { frame: 1778 });

    click(q("button[aria-label='Close details']"));
    expect(api.selected()).toBeUndefined();

    act(() => api.select(2));
    key(q("[data-part='drawer']"), "Escape");
    expect(api.selected()).toBeUndefined();
  });

  it("Esc in the search closes the drawer first, then clears the search", () => {
    deliver();
    show();
    act(() => api.setFilter({ query: "flow" }));
    act(() => api.select(1));
    const search = q<HTMLInputElement>("input[aria-label='Search the log']");
    key(search, "Escape");
    expect(api.selected()).toBeUndefined();
    expect(api.filter().query).toBe("flow");
    key(search, "Escape");
    expect(api.filter().query).toBe("");
  });

  it("the drawer of a line without frame or data shows a dash and no JSON; other keys do nothing", () => {
    ctx.link.current = { kind: "connecting" };
    deliver(traceValue([{ level: "debug", event: "tick", ts: 1 }]));
    show();
    act(() => api.select(1));
    const drawer = q("[data-part='drawer']");
    expect(drawer?.querySelector("[data-field='frame']")?.textContent).toBe("—");
    expect(drawer?.querySelector("pre")).toBeNull();
    expect(drawer?.querySelector("[data-field='source']")?.textContent).toBe("game");
    key(drawer, "a");
    expect(api.selected()?.key).toBe(1);
  });

  it("arrow keys keep the selected row in view; keys outside the grid rules do nothing", () => {
    const many = Array.from({ length: 100 }, (_, index) => ({
      level: "info" as const,
      event: `flow: line ${index}`,
      ts: index + 1
    }));
    deliver(traceValue(many));
    show();
    const scroller = q<HTMLElement>("[data-scroller]");
    const grid = q("[role='grid']");
    if (scroller === null) throw new Error("no scroller");
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 270 });

    act(() => api.select(20));
    key(grid, "ArrowDown");
    expect(api.selected()?.key).toBe(21);
    expect(scroller.scrollTop).toBe(20 * 27 + 54 - 270);

    scroller.scrollTop = 2000;
    key(grid, "ArrowUp");
    expect(api.selected()?.key).toBe(20);
    expect(scroller.scrollTop).toBe(19 * 27);

    key(grid, "Home");
    act(() => api.select());
    key(grid, "Escape");
    expect(api.selected()).toBeUndefined();
    key(grid, "ArrowUp");
    expect(api.selected()?.key).toBe(100);

    // Enter on a frame button is the button's own; it does not move the selection.
    act(() => api.select());
    key(q("button[data-frame-link]"), "Enter");
    expect(api.selected()).toBeUndefined();
  });

  it("a click outside any line row selects nothing", () => {
    deliver();
    show();
    click(q("thead th"));
    expect(api.selected()).toBeUndefined();
  });

  it("the drawer of a meta row shows its text", () => {
    deliver();
    act(() => api.clear());
    show();
    act(() => api.select(9));
    expect(q("[data-part='drawer']")?.textContent).toContain("Console cleared");
  });

  it("renders only the rows in view ± 20 with spacers", () => {
    const many = Array.from({ length: 300 }, (_, index) => ({
      level: "info" as const,
      event: `flow: line ${index}`,
      ts: index + 1
    }));
    deliver(traceValue(many));
    show();
    const rows = all("tr[data-key]");
    expect(rows.length).toBeLessThan(80);
    expect(rows[0]?.dataset.key).toBe("1");
    const spacers = all("[data-spacer] td");
    expect(spacers.at(-1)?.style.height).toBe(`${(300 - rows.length) * 27}px`);
  });

  it("shows the 'N new lines' pill when scrolled up, and scrolls down on click", () => {
    deliver(traceValue(TRACE.slice(0, 3)));
    show();
    const grid = q<HTMLElement>("[data-scroller]");
    if (grid === null) throw new Error("no scroller");
    Object.defineProperty(grid, "scrollHeight", { configurable: true, value: 2000 });
    Object.defineProperty(grid, "clientHeight", { configurable: true, value: 400 });
    act(() => {
      grid.scrollTop = 100;
      grid.dispatchEvent(new Event("scroll"));
    });

    deliver(traceValue(TRACE.slice(0, 5)));
    expect(q("button[data-pill]")?.textContent).toBe("2 new lines ↓");
    deliver(traceValue(TRACE.slice(0, 6)));
    expect(q("button[data-pill]")?.textContent).toBe("3 new lines ↓");

    click(q("button[data-pill]"));
    expect(grid.scrollTop).toBe(2000);
    expect(q("button[data-pill]")).toBeNull();

    // At the bottom, new lines keep it there.
    act(() => {
      grid.scrollTop = 1600;
      grid.dispatchEvent(new Event("scroll"));
    });
    deliver(traceValue(TRACE.slice(0, 7)));
    expect(q("button[data-pill]")).toBeNull();
    expect(grid.scrollTop).toBe(2000);

    act(() => {
      grid.scrollTop = 0;
      grid.dispatchEvent(new Event("scroll"));
    });
    deliver();
    expect(q("button[data-pill]")?.textContent).toBe("1 new line ↓");
  });
});

describe("Console empty states", () => {
  it("no game ever connected and no lines", () => {
    show({ kind: "connecting" });
    expect(q("[data-empty]")?.textContent).toBe(
      "No game connected. The log starts when a game connects."
    );
  });

  it("connected and no entry lines", () => {
    deliver([]);
    show();
    expect(q("[data-empty]")?.textContent).toBe(
      "The log is empty. Lines appear here as the game logs."
    );
  });

  it("a live link counts as connected", () => {
    show();
    expect(q("[data-empty]")?.textContent).toBe(
      "The log is empty. Lines appear here as the game logs."
    );
  });

  it("lines exist but none visible", () => {
    deliver();
    act(() => api.setFilter({ level: "error" }));
    show();
    expect(q("[data-empty]")?.textContent).toBe("No lines match this filter.");
    expect(q("[role='grid']")).toBeNull();
  });

  it("re-renders on link status changes without reading", () => {
    show({ kind: "connecting" });
    expect(q("[data-empty]")).not.toBeNull();
    expect(ctx.link.api.read).not.toHaveBeenCalled();
  });
});

describe("Console markup", () => {
  it("uses no class attribute anywhere and only data-part scopes", () => {
    deliver();
    act(() => api.select(5));
    show();
    expect(all("[class]")).toHaveLength(0);
    expect(all("[data-part]").map(element => element.dataset.part)).toEqual(
      expect.arrayContaining(["console", "toolbar", "logtable", "drawer"])
    );
  });

  it("renders log text as text, never as markup", () => {
    deliver(traceValue([{ level: "info", event: "flow: <b>bold</b>", ts: 1 }]));
    show();
    expect(all("b")).toHaveLength(0);
    expect(q("[data-col='message']")?.textContent).toBe("<b>bold</b>");
  });
});
