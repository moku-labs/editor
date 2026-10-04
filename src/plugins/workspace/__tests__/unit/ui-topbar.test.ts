// @vitest-environment happy-dom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wireError } from "../../../registry/protocol";
import { runCommand } from "../../commands";
import { LinkPill, pillText } from "../../ui/LinkPill";
import { TopBar } from "../../ui/TopBar";
import { createCtx, flush, manifestOf, resultOf, type TestCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// B1 top bar, the link pill (D7), the session chip, D1 and D2 popovers
// ─────────────────────────────────────────────────────────────────────────────

let ctx: TestCtx;
let root: HTMLElement;

/**
 * Renders the top bar.
 */
function mount(): void {
  act(() => {
    render(h(TopBar, { ctx }), root);
  });
  ctx.state.dom.root = root;
}

/**
 * Re-renders after a state change.
 */
function bump(): void {
  act(() => {
    ctx.state.ui.bump();
  });
}

/**
 * A top-bar control by its data-action.
 *
 * @param name - The action.
 * @returns The button.
 */
function control(name: string): HTMLButtonElement {
  const button = root.querySelector<HTMLButtonElement>(`[data-action="${name}"]`);
  if (button === null) throw new Error(`no ${name}`);
  return button;
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"]
  });
  vi.setSystemTime(100_000);
  ctx = createCtx({ defaultWorkspace: "flow" });
  root = document.createElement("div");
  document.body.append(root);
});

afterEach(() => {
  act(() => {
    render(undefined, root);
  });
  root.remove();
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/**
 * The visible label of a switch (its text without the track).
 *
 * @param name - The switch action.
 * @returns The label.
 */
function label(name: string): string {
  return control(name).textContent ?? "";
}

describe("TopBar", () => {
  it("shows the game name, the registry icon with its counts in the title, and the search box", () => {
    ctx.link.manifestValue = manifestOf();
    mount();
    expect(root.querySelector("[data-game-name]")?.textContent).toBe("merge-game 0.0.0");
    expect(control("registry").title).toBe("Registry · 1 source · 4 commands");
    expect(control("registry").textContent).toBe("Registry");
    expect(control("registry").querySelector("[data-icon='registry']")).not.toBeNull();
    expect(root.querySelector("[data-search]")?.textContent).toContain(
      "Jump to node, file, style, texture…"
    );
  });

  it("Step is inert unless paused, with the tooltip; when paused it runs game.step origin topbar", async () => {
    ctx.state.link = { kind: "live", frame: 3 };
    mount();
    const step = control("step");
    expect(step.getAttribute("aria-disabled")).toBe("true");
    expect(step.title).toBe("Pause the game to step frames (P)");
    act(() => step.click());
    expect(ctx.link.run).not.toHaveBeenCalled();

    ctx.state.link = { kind: "paused", frame: 3 };
    bump();
    expect(control("step").getAttribute("aria-disabled")).toBe("false");
    act(() => control("step").click());
    await flush();
    expect(ctx.emit).toHaveBeenCalledWith(
      "workspace:ran",
      expect.objectContaining({ id: "game.step", origin: "topbar" })
    );
  });

  it("Pause / Resume follows the status and is inert without a game", async () => {
    mount();
    expect(control("pause").getAttribute("aria-disabled")).toBe("true");
    ctx.state.link = { kind: "paused", frame: 1 };
    bump();
    expect(control("pause").textContent).toContain("Resume");
    act(() => control("pause").click());
    await flush();
    expect(ctx.link.run).toHaveBeenCalledWith("game.resume", undefined);
  });

  it("the Game switch toggles the preview and is inert in Game with its tooltip", () => {
    mount();
    const game = control("game");
    expect(game.getAttribute("role")).toBe("switch");
    expect(game.getAttribute("aria-checked")).toBe("true");
    act(() => game.click());
    expect(ctx.state.previews.flow.visible).toBe(false);
    expect(control("game").getAttribute("aria-checked")).toBe("false");

    ctx.state.active = "game";
    bump();
    expect(control("game").getAttribute("aria-disabled")).toBe("true");
    expect(control("game").title).toBe("The Game workspace always shows the game");
    expect(control("game").getAttribute("aria-checked")).toBe("true");
    act(() => control("game").click());
    expect(ctx.state.previews.flow.visible).toBe(false);
  });

  it("the Overlay switch is off by default, inert without editor.overlay, runs it when live", async () => {
    mount();
    const overlay = control("overlay");
    expect(overlay.getAttribute("aria-checked")).toBe("false");
    expect(overlay.getAttribute("aria-disabled")).toBe("true");

    ctx.state.link = { kind: "live", frame: 1 };
    ctx.link.manifestValue = manifestOf();
    bump();
    act(() => control("overlay").click());
    await flush();
    expect(ctx.link.run).toHaveBeenCalledWith("editor.overlay", { on: true });
    expect(ctx.emit).toHaveBeenCalledWith(
      "workspace:ran",
      expect.objectContaining({ id: "editor.overlay", origin: "topbar" })
    );
  });

  it("the Reference mode button toggles it and shows its state", () => {
    mount();
    const reference = control("reference");
    expect(reference.title).toBe("Reference mode (R) — pick game elements for the chat");
    expect(reference.getAttribute("aria-pressed")).toBe("false");
    expect(reference.textContent).toBe("Reference mode");
    expect(reference.querySelector("[data-icon='target']")).not.toBeNull();

    act(() => reference.click());
    expect(ctx.state.reference).toBe(true);
    expect(ctx.emit).toHaveBeenCalledWith("workspace:reference", { on: true });
    expect(control("reference").getAttribute("aria-pressed")).toBe("true");
  });

  it("splits the game name from its version", () => {
    ctx.link.manifestValue = manifestOf();
    mount();
    expect(root.querySelector("[data-game-name] [data-part='name']")?.textContent).toBe(
      "merge-game"
    );
    expect(root.querySelector("[data-game-name] [data-part='version']")?.textContent).toBe("0.0.0");
  });

  it("the search box opens the palette; the theme button toggles the theme", () => {
    mount();
    act(() => root.querySelector<HTMLButtonElement>("[data-search]")?.click());
    expect(ctx.state.palette.open).toBe(true);
    act(() => control("theme").click());
    expect(ctx.state.theme.chosen).toBe("dark");
  });

  it("D2: the registry button opens and closes the registry popover", () => {
    const manifest = manifestOf(["game.step"]);
    ctx.link.manifestValue = {
      ...manifest,
      commands: [...manifest.commands, { id: "flow.go", title: "Go", input: {}, effect: "route" }]
    };
    mount();
    act(() => control("registry").click());
    expect(ctx.state.popover).toBe("registry");
    const popover = root.querySelector("[data-ui='registry-popover']");
    expect(popover?.textContent).toContain(
      "Registry · merge-game 0.0.0 · what the game registered"
    );
    expect(popover?.textContent).toContain("Sources 1");
    expect(popover?.textContent).toContain("Commands 2");
    expect(popover?.querySelector("[data-tag='acc']")?.textContent).toBe("route");

    act(() => popover?.querySelector<HTMLButtonElement>("[aria-label='Close']")?.click());
    expect(ctx.state.popover).toBeUndefined();
    act(() => control("registry").click());
    act(() => control("registry").click());
    expect(ctx.state.popover).toBeUndefined();
  });

  it("D2 without a manifest says no game is connected", () => {
    ctx.state.popover = "registry";
    mount();
    expect(root.querySelector("[data-ui='registry-popover']")?.textContent).toContain(
      "No game connected."
    );
  });
});

describe("D1 step popover", () => {
  it("shows the ok result with the run state and closes after 4 s", async () => {
    ctx.link.run.mockResolvedValue(resultOf({ stepped: 1 }, 1841));
    mount();
    await act(async () => {
      await runCommand(ctx, "game.step", { frames: 1 }, "topbar");
    });
    const popover = root.querySelector("[data-ui='step-popover']");
    expect(popover?.textContent).toContain("ok · game.step · frames: 1");
    expect(popover?.textContent).toContain(
      '{ path: "board/awaitIntent", frame: 1841, tainted: false }'
    );
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(ctx.state.popover).toBeUndefined();
  });

  it("shows the error field and the code with the bare message", async () => {
    ctx.link.run.mockRejectedValue(
      wireError(-32_602, "game.step: frames must be a number", {
        reason: "invalid_input",
        retryable: false,
        field: "frames"
      })
    );
    mount();
    await act(async () => {
      await runCommand(ctx, "game.step", { frames: "x" }, "key").catch(() => {});
    });
    const text = root.querySelector("[data-ui='step-popover']")?.textContent ?? "";
    expect(text).toContain("error · field: frames");
    expect(text).toContain("-32602 game.step: frames must be a number");
    expect(text).not.toContain("[moku-editor]");
    expect(text).toContain("Logged in Console");
  });

  it("an error without a field names the command", async () => {
    ctx.link.run.mockRejectedValue(wireError(-32_000, "boom"));
    mount();
    await act(async () => {
      await runCommand(ctx, "game.step", undefined, "key").catch(() => {});
    });
    expect(root.querySelector("[data-ui='step-popover']")?.textContent).toContain(
      "error · game.step"
    );
  });
});

describe("LinkPill", () => {
  it("renders every status with its D7 note", () => {
    const now = 100_000;
    expect(pillText({ kind: "connecting" }, now).text).toBe("Connecting");
    expect(pillText({ kind: "live", frame: 1840 }, now).text).toBe("Live · f1840");
    expect(pillText({ kind: "paused", frame: 1840 }, now).text).toBe("Paused · f1840");
    expect(pillText({ kind: "silent", since: now - 65_000, lastFrame: 9 }, now).text).toBe(
      "No heartbeat · 65 s"
    );
    const lost = pillText(
      { kind: "lost", reason: "game_reloaded", lastFrame: 9, retryInMs: 1000 },
      now
    );
    expect(lost).toEqual({
      text: "Lost · retry in 1 s",
      note: "Game page reloaded · reconnecting in 1 s"
    });
    expect(pillText({ kind: "empty" }, now).text).toBe("No game");
  });

  it("lost shows Retry now, which calls link.retry()", () => {
    ctx.state.link = { kind: "lost", reason: "socket_closed", lastFrame: 2, retryInMs: 2000 };
    act(() => {
      render(h(LinkPill, { ctx }), root);
    });
    const pill = root.querySelector<HTMLElement>("[data-ui='link-pill']");
    expect(pill?.dataset.kind).toBe("lost");
    expect(pill?.title).toBe("Connection to the editor server closed · reconnecting in 2 s");
    act(() => pill?.querySelector("button")?.click());
    expect(ctx.link.retry).toHaveBeenCalledTimes(1);
  });
});

describe("SessionChip", () => {
  it("shows no session, then the short id with the connect time", () => {
    mount();
    expect(root.querySelector("[data-ui='session-chip']")?.textContent).toBe("no session");

    ctx.link.sessionList = [
      { id: "s-7f3a", game: "merge-game", page: "/", embedded: true, connectedAt: 0 }
    ];
    bump();
    const chip = root.querySelector<HTMLButtonElement>("[data-ui='session-chip'] button");
    expect(chip?.textContent).toBe("s-7f3a");
    expect(chip?.title).toMatch(/^connected \d\d:\d\d:\d\d$/);
    act(() => chip?.click());
    expect(ctx.state.popover).toBeUndefined();
  });

  it("with two sessions opens a menu whose rows choose a session", async () => {
    ctx.link.sessionList = [
      { id: "s-1", game: "merge-game", page: "/a", embedded: true, connectedAt: 0 },
      { id: "s-2", game: "merge-game", page: "/b", embedded: false, connectedAt: 0 }
    ];
    mount();
    const chip = root.querySelector<HTMLButtonElement>("[data-ui='session-chip'] > button");
    act(() => chip?.click());
    expect(ctx.state.popover).toBe("session");
    const rows = root.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain("embedded");
    act(() => rows[1]?.click());
    await flush();
    expect(ctx.link.choose).toHaveBeenCalledWith("s-2");
    expect(ctx.state.popover).toBeUndefined();

    act(() => chip?.click());
    act(() => chip?.click());
    expect(ctx.state.popover).toBeUndefined();
  });

  it("a failed choose is a warn", async () => {
    ctx.link.sessionList = [
      { id: "s-1", game: "g", page: "/a", embedded: true, connectedAt: 0 },
      { id: "s-2", game: "g", page: "/b", embedded: false, connectedAt: 0 }
    ];
    ctx.link.choose.mockRejectedValue(new Error("gone"));
    ctx.state.popover = "session";
    mount();
    act(() => root.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']")[0]?.click());
    await flush();
    expect(ctx.log.warn).toHaveBeenCalledWith(
      "workspace:choose-failed",
      expect.objectContaining({ session: "s-1" })
    );
  });
});

describe("TopBar at 900 px and wider", () => {
  beforeEach(() => {
    vi.stubGlobal("innerWidth", 960);
  });

  it("keeps the full bar: session chip, labelled switches, no ⋯ menu", () => {
    mount();
    const bar = root.querySelector<HTMLElement>("[data-ui='top-bar']");
    expect(bar?.dataset.layout).toBe("wide");
    expect(root.querySelector("[data-ui='session-chip']")).not.toBeNull();
    expect(label("game")).toBe("Preview");
    expect(label("overlay")).toBe("Overlay");
    expect(label("hot-reload")).toBe("Hot reload");
    expect(control("game").title).toBe("Game preview (G)");
    expect(root.querySelector("[data-action='more']")).toBeNull();
    expect(root.querySelector("[data-search] > span")?.textContent).toBe(
      "Jump to node, file, style, texture…"
    );
  });

  it("names the registry counts in the title, no game connected without a manifest", () => {
    mount();
    expect(control("registry").title).toBe("Registry · no game connected");
  });

  it("the Hot reload switch shows link's state; only the bin owns it", async () => {
    mount();
    expect(control("hot-reload").getAttribute("aria-disabled")).toBe("true");
    expect(control("hot-reload").title).toBe("Hot reload (H): waiting for the editor server");

    ctx.link.hotReload.mockReturnValue({ hmr: false, owner: "server" });
    bump();
    expect(control("hot-reload").getAttribute("aria-checked")).toBe("false");
    expect(control("hot-reload").getAttribute("aria-disabled")).toBe("true");
    act(() => control("hot-reload").click());
    expect(ctx.link.setHotReload).not.toHaveBeenCalled();

    ctx.link.hotReload.mockReturnValue({ hmr: true, owner: "bin" });
    bump();
    expect(control("hot-reload").getAttribute("aria-checked")).toBe("true");
    expect(control("hot-reload").getAttribute("aria-disabled")).toBe("false");
    await act(async () => {
      control("hot-reload").click();
      await flush();
    });
    expect(ctx.link.setHotReload).toHaveBeenCalledWith(false);
    expect(control("hot-reload").title).toBe(
      "Hot reload (H): on · Bun reloads the game after a save and keeps its state · Start the bin with --no-hmr to turn hot reload off"
    );
    expect(ctx.state.toasts.map(toast => toast.message)).toEqual([
      "Start the bin with --no-hmr to turn hot reload off"
    ]);
  });

  it("switches to the compact bar when the window narrows below 900 px", () => {
    mount();
    vi.stubGlobal("innerWidth", 899);
    bump();
    expect(root.querySelector<HTMLElement>("[data-ui='top-bar']")?.dataset.layout).toBe("compact");
  });
});

describe("TopBar below 900 px (compact)", () => {
  beforeEach(() => {
    vi.stubGlobal("innerWidth", 720);
    ctx.link.manifestValue = manifestOf();
  });

  it("keeps logo, game name, link pill, pause, step, the search icon and the ⋯ menu button only", () => {
    mount();
    const bar = root.querySelector<HTMLElement>("[data-ui='top-bar']");
    expect(bar?.dataset.layout).toBe("compact");
    const actions = [
      ...root.querySelectorAll<HTMLElement>("[data-ui='top-bar'] > [data-action]")
    ].map(element => element.dataset.action);
    expect(actions).toEqual(["pause", "step", "more"]);
    expect(root.querySelector("[data-logo]")).not.toBeNull();
    expect(root.querySelector("[data-game-name]")?.textContent).toContain("merge-game");
    expect(root.querySelector("[data-ui='link-pill']")).not.toBeNull();
    expect(root.querySelector("[data-ui='session-chip']")).toBeNull();
    const search = root.querySelector<HTMLButtonElement>("[data-search]");
    expect(search?.getAttribute("aria-label")).toMatch(
      /^Jump to node, file, style, texture \(.+K\)$/
    );
    expect(search?.textContent).toBe("");
    act(() => search?.click());
    expect(ctx.state.palette.open).toBe(true);
  });

  it("the link pill carries the session id in its title and opens the session menu", async () => {
    ctx.state.link = { kind: "live", frame: 12 };
    ctx.link.sessionList = [
      { id: "s-7f3a9c21d4", game: "merge-game", page: "/a", embedded: true, connectedAt: 0 },
      { id: "s-2", game: "merge-game", page: "/b", embedded: false, connectedAt: 0 }
    ];
    mount();
    const pill = root.querySelector<HTMLElement>("[data-ui='link-pill']");
    expect(pill?.title).toMatch(
      /^Game connected · frame 12 · session s-7f3a9c21d4 · connected \d\d:\d\d:\d\d$/
    );
    const status = pill?.querySelector<HTMLButtonElement>("[data-part='status']");
    expect(status?.dataset.popoverAnchor).toBe("session");
    expect(status?.getAttribute("aria-haspopup")).toBe("menu");

    act(() => status?.click());
    expect(ctx.state.popover).toBe("session");
    const rows = root.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']");
    expect(rows).toHaveLength(2);
    act(() => rows[1]?.click());
    await flush();
    expect(ctx.link.choose).toHaveBeenCalledWith("s-2");
  });

  it("with one session the pill only names it", () => {
    ctx.link.sessionList = [
      { id: "s-1", game: "merge-game", page: "/a", embedded: true, connectedAt: 0 }
    ];
    mount();
    const status = root.querySelector<HTMLButtonElement>(
      "[data-ui='link-pill'] [data-part='status']"
    );
    expect(status?.getAttribute("aria-haspopup")).toBeNull();
    act(() => status?.click());
    expect(ctx.state.popover).toBeUndefined();
  });
});

/**
 * Renders the top bar and opens the ⋯ menu.
 */
function openMenu(): void {
  mount();
  act(() => control("more").click());
}

/**
 * One menu row as "label · state · key".
 *
 * @param row - The row.
 * @returns The text.
 */
function rowText(row: Element): string {
  return [...row.children].map(child => child.textContent).join(" · ");
}

describe("the ⋯ menu", () => {
  beforeEach(() => {
    vi.stubGlobal("innerWidth", 480);
    ctx.link.manifestValue = manifestOf();
  });

  it("opens a top-layer menu holding every action with its state and key", () => {
    openMenu();
    expect(ctx.state.popover).toBe("more");
    expect(control("more").getAttribute("aria-expanded")).toBe("true");
    const menu = root.querySelector<HTMLElement>("[data-ui='more-menu']");
    expect(menu?.getAttribute("popover")).toBe("manual");
    expect(menu?.getAttribute("role")).toBe("menu");
    const rows = [...(menu?.querySelectorAll("[role^='menuitem']") ?? [])];
    expect(rows.map(row => rowText(row))).toEqual([
      "Game preview · on · G",
      "Overlay in game · off · O",
      "Reference mode · off · R",
      "Hot reload · unknown · H",
      "Registry · 1 · 4",
      "Density · auto",
      "Theme · light"
    ]);
    expect(rows.slice(0, 4).map(row => row.getAttribute("role"))).toEqual([
      "menuitemcheckbox",
      "menuitemcheckbox",
      "menuitemcheckbox",
      "menuitemcheckbox"
    ]);
  });

  it("a toggle row switches its action and the menu stays open", () => {
    ctx.state.active = "flow";
    openMenu();
    act(() => control("reference").click());
    expect(ctx.state.reference).toBe(true);
    expect(control("reference").getAttribute("aria-checked")).toBe("true");
    act(() => control("game").click());
    expect(ctx.state.previews.flow.visible).toBe(false);
    expect(ctx.state.popover).toBe("more");
  });

  it("a row that cannot act now is inert with its reason", () => {
    ctx.state.active = "game";
    openMenu();
    expect(control("game").getAttribute("aria-disabled")).toBe("true");
    expect(control("game").title).toBe("The Game workspace always shows the game");
    expect(control("overlay").getAttribute("aria-disabled")).toBe("true");
    act(() => control("overlay").click());
    expect(ctx.state.overlayInGame).toBe(false);
  });

  it("Registry closes the menu and opens the registry popover; Density cycles; Theme toggles", () => {
    openMenu();
    act(() => control("density").click());
    expect(ctx.state.density.chosen).toBe("compact");
    expect(rowText(control("density"))).toBe("Density · compact");
    act(() => control("theme").click());
    expect(ctx.state.theme.chosen).toBe("dark");
    act(() => control("registry").click());
    expect(ctx.state.popover).toBe("registry");
  });

  it("the Hot reload row asks link and toasts a refusal", async () => {
    ctx.link.hotReload.mockReturnValue({ hmr: true, owner: "bin" });
    openMenu();
    expect(rowText(control("hot-reload"))).toBe("Hot reload · on · H");
    await act(async () => {
      control("hot-reload").click();
      await flush();
    });
    expect(ctx.link.setHotReload).toHaveBeenCalledWith(false);
    expect(ctx.state.toasts).toHaveLength(1);
  });

  it("closes on a second ⋯ click and on a press outside it", () => {
    openMenu();
    act(() => control("more").click());
    expect(ctx.state.popover).toBeUndefined();

    act(() => control("more").click());
    expect(ctx.state.popover).toBe("more");
    act(() => {
      control("reference").dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(ctx.state.popover).toBe("more");
    act(() => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(ctx.state.popover).toBeUndefined();
  });

  it("ArrowDown and ArrowUp move the focus through the rows", () => {
    openMenu();
    const menu = root.querySelector<HTMLElement>("[data-ui='more-menu']");
    const rows = [...(menu?.querySelectorAll<HTMLElement>("[role^='menuitem']") ?? [])];
    rows[0]?.focus();
    act(() => {
      menu?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(document.activeElement).toBe(rows[1]);
    act(() => {
      menu?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    });
    act(() => {
      menu?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    });
    expect(document.activeElement).toBe(rows.at(-1));
  });

  it("the registry popover anchors to the ⋯ button in the compact bar", () => {
    mount();
    act(() => control("more").click());
    act(() => control("registry").click());
    expect(root.querySelector("[data-ui='registry-popover']")?.textContent).toContain("Sources 1");
    expect(control("more").dataset.popoverAnchor).toBe("more");
  });
});
