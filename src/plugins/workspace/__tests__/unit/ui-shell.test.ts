// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"navigation":{"disableChildFrameNavigation":true}}}
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceApi } from "../../api";
import { initWorkspace, stopWorkspace } from "../../lifecycle";
import type { WorkspaceApi } from "../../types";
import { badgeSpeech, clockTime, inputText, schemaText } from "../../ui/text";
import { createCtx, flush, keyEvent, manifestOf, type TestCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The mounted shell: grid, hosts, rail, F3 stale bar, F4 cards, E1 palette
// ─────────────────────────────────────────────────────────────────────────────

let ctx: TestCtx;
let api: WorkspaceApi;
let root: HTMLElement;

/**
 * Re-renders after a state change.
 */
function bump(): void {
  act(() => {
    ctx.state.ui.bump();
  });
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"]
  });
  vi.setSystemTime(1_000_000);
  localStorage.clear();
  history.replaceState(history.state, "", "/__editor");
  ctx = createCtx();
  initWorkspace(ctx);
  api = createWorkspaceApi(ctx);
  root = document.createElement("div");
  document.body.append(root);
  act(() => api.mount(root));
});

afterEach(() => {
  act(() => stopWorkspace(ctx));
  document.body.innerHTML = "";
  vi.useRealTimers();
});

/**
 * The stale bar.
 *
 * @returns The element.
 */
function staleBar(): HTMLElement | null {
  return root.querySelector("[data-ui='stale-bar']");
}

/**
 * The palette input.
 *
 * @returns The input.
 */
function input(): HTMLInputElement {
  const element = root.querySelector<HTMLInputElement>("[data-ui='palette'] input");
  if (element === null) throw new Error("palette closed");
  return element;
}

/**
 * Types into the palette.
 *
 * @param text - The query.
 */
function type(text: string): void {
  act(() => {
    input().value = text;
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/**
 * Presses a key in the palette input.
 *
 * @param key - The key.
 * @param init - Modifiers.
 */
function press(key: string, init: KeyboardEventInit = {}): void {
  act(() => {
    input().dispatchEvent(keyEvent(key, init));
  });
}

describe("Shell", () => {
  it("renders the top bar, the rail, the hosts and one frame layer outside the root", () => {
    expect(root.querySelector<HTMLElement>("[data-ui='shell']")?.dataset.workspace).toBe("game");
    expect(root.querySelector("[data-ui='top-bar']")).not.toBeNull();
    expect(root.querySelectorAll("[data-workspace-host]")).toHaveLength(6);
    expect(document.querySelectorAll("[data-frame-layer]")).toHaveLength(1);
    expect(root.querySelector("[data-frame-layer]")).toBeNull();
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("a second mount moves the shell and the hosts; the iframe node stays", () => {
    const iframe = document.querySelector("iframe[data-game-frame]");
    const host = api.host("flow");
    const other = document.createElement("div");
    document.body.append(other);
    act(() => api.mount(other));
    expect(root.childElementCount).toBe(0);
    expect(other.contains(host)).toBe(true);
    expect(document.querySelectorAll("iframe[data-game-frame]")).toHaveLength(1);
    expect(document.querySelector("iframe[data-game-frame]")).toBe(iframe);
  });

  it("shows only the active host", () => {
    act(() => api.show("render"));
    expect(api.host("render").hidden).toBe(false);
    expect(api.host("flow").hidden).toBe(true);
  });

  it("F4: connecting card before the first session, hosts inert; none once live", () => {
    const card = root.querySelector<HTMLElement>("[data-ui='status-card']");
    expect(card?.dataset.kind).toBe("connecting");
    expect(card?.textContent).toContain(`Waiting for the game at ${api.gameFrame().url}`);
    expect(root.querySelector("[data-shell-hosts]")?.hasAttribute("inert")).toBe(true);

    ctx.state.link = { kind: "live", frame: 1 };
    ctx.state.everLive = true;
    bump();
    expect(root.querySelector<HTMLElement>("[data-ui='status-card']")?.hidden).toBe(true);
    expect(root.querySelector("[data-shell-hosts]")?.hasAttribute("inert")).toBe(false);
  });

  it("F4: no boot tag (lost no_boot) shows the empty card, not the connecting one", () => {
    ctx.state.link = { kind: "lost", reason: "no_boot", lastFrame: 0, retryInMs: 0 };
    bump();
    const card = root.querySelector<HTMLElement>("[data-ui='status-card']");
    expect(card?.hidden).toBe(false);
    expect(card?.dataset.kind).toBe("empty");
    expect(root.querySelector("[data-shell-hosts]")?.hasAttribute("inert")).toBe(true);
  });

  it("F4: empty card with the URL; Copy writes it and toasts", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    ctx.state.link = { kind: "empty" };
    bump();
    const card = root.querySelector<HTMLElement>("[data-ui='status-card']");
    expect(card?.textContent).toContain("No game connected");
    act(() => card?.querySelector("button")?.click());
    await flush();
    expect(writeText).toHaveBeenCalledWith(api.gameFrame().url);
    expect(ctx.state.toasts.at(-1)?.message).toBe("Copied URL");
    vi.unstubAllGlobals();
  });

  it("F3: the stale bar shows for silent and lost after the game was live", () => {
    ctx.state.everLive = true;
    ctx.state.link = { kind: "silent", since: 1_000_000 - 6000, lastFrame: 1840 };
    bump();
    expect(staleBar()?.dataset.tone).toBe("warn");
    expect(staleBar()?.textContent).toContain(
      "Stale · data from frame 1840 · no heartbeat for 6 s · the game tab may be in the background"
    );

    ctx.state.link = { kind: "lost", reason: "game_reloaded", lastFrame: 1840, retryInMs: 1000 };
    bump();
    expect(staleBar()?.dataset.tone).toBe("error");
    expect(staleBar()?.textContent).toContain(
      "Stale · data from frame 1840 · game page reloaded, reconnecting in 1 s"
    );
    act(() => staleBar()?.querySelector("button")?.click());
    expect(ctx.link.retry).toHaveBeenCalledTimes(1);

    ctx.state.link = { kind: "live", frame: 1841 };
    bump();
    expect(staleBar()?.hidden).toBe(true);
  });

  it("F3 (U9 B7): an expected reload hides the stale bar; the red bar comes back on a real loss", () => {
    ctx.state.everLive = true;
    ctx.state.link = {
      kind: "lost",
      reason: "socket_closed",
      lastFrame: 1825,
      retryInMs: 1000,
      reloading: true
    };
    bump();
    expect(staleBar()?.hidden).toBe(true);
    expect(staleBar()?.textContent).toBe("");
    expect(root.querySelector("[data-tone='error']")).toBeNull();

    ctx.state.link = { kind: "lost", reason: "socket_closed", lastFrame: 1825, retryInMs: 1000 };
    bump();
    expect(staleBar()?.hidden).toBe(false);
    expect(staleBar()?.dataset.tone).toBe("error");
  });
});

describe("Rail", () => {
  it("marks the active workspace, carries tooltips and badges, and shows on click", () => {
    const buttons = root.querySelectorAll<HTMLButtonElement>(
      "nav[aria-label='Workspaces'] [data-workspace]"
    );
    expect(buttons).toHaveLength(6);
    expect(buttons[0]?.getAttribute("aria-current")).toBe("page");
    expect(buttons[0]?.tabIndex).toBe(0);
    expect(buttons[1]?.tabIndex).toBe(-1);
    expect(buttons[0]?.dataset.workspace).toBe("game");
    expect(buttons[0]?.title).toMatch(/^Game (⌘|Ctrl\+)1$/);
    expect(buttons[1]?.title).toMatch(/^Flow (⌘|Ctrl\+)2$/);

    act(() => api.badge("console", { count: 3, tone: "error", label: "2 warn · 1 error" }));
    const consoleButton = root.querySelector<HTMLButtonElement>("[data-workspace='console']");
    expect(consoleButton?.getAttribute("aria-label")).toBe("Console, 2 warnings, 1 error");
    expect(consoleButton?.querySelector("[data-badge]")?.textContent).toBe("3");

    act(() => consoleButton?.click());
    expect(ctx.state.active).toBe("console");
    expect(ctx.emit).toHaveBeenCalledWith("workspace:changed", { ws: "console" });
  });

  it("↑/↓ move the focus between rail buttons; Commands opens the palette", () => {
    const nav = root.querySelector<HTMLElement>("nav[aria-label='Workspaces']");
    const buttons = root.querySelectorAll<HTMLButtonElement>("[data-workspace]");
    buttons[0]?.focus();
    act(() => {
      nav?.dispatchEvent(keyEvent("ArrowDown"));
    });
    expect(document.activeElement).toBe(buttons[1]);
    act(() => {
      buttons[1]?.dispatchEvent(keyEvent("ArrowUp"));
      buttons[1]?.dispatchEvent(keyEvent("ArrowUp"));
    });
    expect(document.activeElement).toBe(buttons[5]);

    act(() => root.querySelector<HTMLButtonElement>("[data-commands]")?.click());
    expect(ctx.state.palette.open).toBe(true);
  });
});

describe("Palette", () => {
  beforeEach(() => {
    ctx.link.manifestValue = manifestOf();
    for (let index = 0; index < 25; index += 1) {
      api.palette.add({
        id: `node:${index}`,
        group: "Nodes",
        label: `board/node${index}`,
        run: vi.fn()
      });
    }
    act(() => api.palette.open());
  });

  it("is a modal dialog with a combobox, groups with totals and the footer counts", () => {
    const dialog = root.querySelector<HTMLDialogElement>("dialog[data-ui='palette']");
    expect(dialog?.open).toBe(true);
    expect(input().getAttribute("role")).toBe("combobox");
    expect(input().placeholder).toBe(
      "Jump to a node, file, style, texture, panel or run a command"
    );
    const heads = [...root.querySelectorAll("[role='listbox'] h3")].map(head => head.textContent);
    expect(heads).toEqual(["Commands 20", "Nodes 25"]);
    expect(root.querySelectorAll("[role='option']")).toHaveLength(6);
    expect(root.querySelector("[data-ui='palette'] footer")?.textContent).toContain(
      "25 nodes · 0 textures · 4 game commands"
    );
    expect(input().getAttribute("aria-activedescendant")).toBe("moku-palette-option-0");
  });

  it("highlights matches, shows up to 8 per group and the empty text", () => {
    type("node1");
    const options = root.querySelectorAll("[role='option']");
    expect(options.length).toBeLessThanOrEqual(8);
    expect(options[0]?.querySelector("mark")?.textContent).toBe("node1");

    type("qqqq");
    expect(root.querySelector("[data-ui='palette'] [data-empty]")?.textContent).toBe(
      "No match. Try a node name, a file or a texture key."
    );
  });

  it("disabled items show their reason dimmed and do not run", () => {
    type("step 1");
    const step = root.querySelector("[role='option']");
    expect(step?.getAttribute("aria-disabled")).toBe("true");
    expect(step?.querySelector("[data-reason]")?.textContent).toBe(
      "Pause the game to step frames (P)"
    );
    press("Enter");
    expect(ctx.state.palette.open).toBe(true);
  });

  it("↑/↓ move the active option, ↵ runs it and closes, ⇧↵ runs the alt", () => {
    const alt = vi.fn();
    const run = vi.fn();
    api.palette.add({
      id: "file:a",
      group: "Files",
      label: "zz-file.ts",
      run,
      alt: { label: "Open in Files", run: alt }
    });
    type("zz-file");
    expect(root.querySelector("[data-ui='palette'] [data-chip]")?.textContent).toBe(
      "Open in Files ⇧↵"
    );
    press("ArrowDown");
    press("ArrowUp");
    press("Enter", { shiftKey: true });
    expect(alt).toHaveBeenCalledTimes(1);
    expect(ctx.state.palette.open).toBe(false);

    act(() => api.palette.open("zz-file"));
    press("Enter");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("a click runs an option; ⌘K and cancel close the palette", () => {
    const run = vi.fn();
    api.palette.add({ id: "style:a", group: "Styles", label: "ui.number", run });
    type("ui.number");
    act(() => root.querySelector<HTMLElement>("[role='option']")?.click());
    expect(run).toHaveBeenCalledTimes(1);

    act(() => api.palette.open());
    press("k", { metaKey: true, ctrlKey: true });
    expect(ctx.state.palette.open).toBe(false);

    act(() => api.palette.open());
    act(() => {
      root.querySelector("dialog")?.dispatchEvent(new Event("cancel", { cancelable: true }));
    });
    expect(ctx.state.palette.open).toBe(false);
  });

  it("pointer movement makes an option active", () => {
    const options = root.querySelectorAll("[role='option']");
    act(() => {
      options[2]?.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
    });
    expect(ctx.state.palette.index).toBe(2);
  });
});

describe("text helpers", () => {
  it("formats inputs, schemas, badges and clock times", () => {
    expect(inputText({ frames: 1 })).toBe("frames: 1");
    expect(inputText(undefined)).toBe("no input");
    expect(inputText({})).toBe("no input");
    expect(inputText(3)).toBe("3");
    expect(schemaText({ frames: "number", id: "string?" })).toBe("frames: number, id: string?");
    expect(schemaText({})).toBe("—");
    expect(badgeSpeech("1 warn · 2 error · 3 info")).toBe("1 warning, 2 errors, 3 info");
    expect(clockTime(0)).toMatch(/^\d\d:\d\d:\d\d$/);
  });
});
