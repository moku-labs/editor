// @vitest-environment happy-dom
/* eslint-disable unicorn/no-null -- null is a JSON value of the published directory */
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeSourcePlugin } from "../../../activeSource";
import type { DeviceDirectory } from "../../../connect/protocol";
import { linkPlugin } from "../../../link";
import { workspacePlugin } from "../..";
import { registerBuiltIns } from "../../keys/builtins";
import { dispatchKey } from "../../keys/keymap";
import { TopBar } from "../../ui/TopBar";
import {
  A26,
  createCtx,
  deviceSessionOf,
  flush,
  IPHONE,
  keyEvent,
  ownSessionOf,
  type TestCtx,
  useDeviceSource
} from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// W8/W9 the source pill of the top bar and its menu, and the session menu: every
// source switch goes through activeSource; only another page goes to link.
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
 * The source pill.
 *
 * @returns The element.
 */
function pill(): HTMLElement {
  const element = root.querySelector<HTMLElement>("[data-ui='source-pill']");
  if (element === null) throw new Error("no source pill");
  return element;
}

/**
 * Opens the source menu and returns its rows.
 *
 * @returns The rows.
 */
function openMenu(): HTMLButtonElement[] {
  act(() => pill().querySelector<HTMLButtonElement>("button")?.click());
  return [...root.querySelectorAll<HTMLButtonElement>("[data-ui='source-menu'] button")];
}

/**
 * A directory where adb matched the Galaxy A26 by its marketing name.
 *
 * @returns The directory.
 */
function directory(): DeviceDirectory {
  return {
    v: 1,
    mode: {
      on: true,
      owner: "connect",
      listen: { port: 47_600, adb: "127.0.0.1:47600", lan: null }
    },
    confirmIn: "page",
    adb: { available: true },
    wire: [
      {
        serial: "R5CX30ABCDE",
        state: "device",
        transport: "usb",
        model: "SM-A266B",
        name: "Galaxy A26",
        os: "Android 15",
        phase: "linked",
        device: A26.id
      }
    ],
    asking: [],
    linked: [],
    at: 1
  };
}

beforeEach(() => {
  vi.stubGlobal("innerWidth", 1440);
  ctx = createCtx({ defaultWorkspace: "flow" });
  ctx.link.ownSession.mockReturnValue("s-1");
  root = document.createElement("div");
  document.body.append(root);
});

afterEach(() => {
  act(() => {
    render(undefined, root);
  });
  root.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("workspace depends on activeSource (W8)", () => {
  it("lists activeSourcePlugin among its dependencies, after link", () => {
    expect(workspacePlugin.spec.depends).toEqual([linkPlugin, activeSourcePlugin]);
  });
});

describe("the source pill (W9)", () => {
  it("names the source: Local preview, a device by wire or on the network, another page", () => {
    ctx.link.sessionList = [ownSessionOf("s-1")];
    ctx.source.currentValue = { kind: "local", session: "s-1" };
    mount();
    expect(pill().dataset.kind).toBe("local");
    expect(pill().textContent).toBe("Local preview");

    useDeviceSource(ctx, deviceSessionOf("s-9"), "Galaxy A26");
    bump();
    expect(pill().dataset.kind).toBe("device");
    expect(pill().textContent).toBe("Galaxy A26 · by wire");

    useDeviceSource(ctx, deviceSessionOf("s-12", IPHONE), "IPHONE15,4");
    bump();
    expect(pill().textContent).toBe("IPHONE15,4 · on the network");

    ctx.source.currentValue = { kind: "page", session: "s-3" };
    ctx.source.labelValue = { ...ctx.source.labelValue, name: "merge-game 0.0.0", kind: "page" };
    bump();
    expect(pill().dataset.kind).toBe("page");
    expect(pill().textContent).toBe("merge-game 0.0.0 · another page");
  });

  it("the dot is live while the source's session is listed and heard, away otherwise", () => {
    useDeviceSource(ctx, deviceSessionOf("s-9"), "Galaxy A26");
    mount();
    expect(pill().dataset.state).toBe("live");

    ctx.link.sessionList = [
      { ...deviceSessionOf("s-9"), heartbeat: { frame: 12, paused: false, silent: true } }
    ];
    bump();
    expect(pill().dataset.state).toBe("away");

    ctx.link.sessionList = [];
    bump();
    expect(pill().dataset.state).toBe("away");

    // A page without a local preview session yet.
    ctx.source.currentValue = { kind: "local", session: null };
    bump();
    expect(pill().dataset.state).toBe("away");
  });

  it("the menu lists the local preview and every linked device; Use calls useDevice, not link.choose", async () => {
    // Bug: the chip switching sessions behind activeSource's back, so the local game keeps running.
    ctx.link.sessionList = [
      ownSessionOf("s-1"),
      deviceSessionOf("s-9"),
      deviceSessionOf("s-12", IPHONE)
    ];
    ctx.link.directoryValue = directory();
    ctx.source.currentValue = { kind: "local", session: "s-1" };
    mount();

    const rows = openMenu();
    expect(ctx.state.popover).toBe("source");
    const sources = rows.filter(row => row.getAttribute("role") === "menuitemradio");
    expect(sources.map(row => row.querySelector("[data-part='name']")?.textContent)).toEqual([
      "Local preview",
      "Galaxy A26",
      "IPHONE15,4"
    ]);
    expect(sources.map(row => row.getAttribute("aria-checked"))).toEqual([
      "true",
      "false",
      "false"
    ]);
    expect(sources[1]?.textContent).toContain("by wire · 127.0.0.1");
    expect(sources[2]?.textContent).toContain("on the network · 192.168.1.42");
    expect(sources[1]?.querySelector("[data-part='use']")?.textContent).toBe("Use");

    act(() => sources[1]?.click());
    await flush();
    expect(ctx.source.useDevice).toHaveBeenCalledWith("s-9");
    expect(ctx.link.choose).not.toHaveBeenCalled();
    expect(ctx.state.popover).toBeUndefined();
  });

  it("Use on the local preview calls useLocal; without its session the row cannot act", async () => {
    useDeviceSource(ctx, deviceSessionOf("s-9"), "Galaxy A26");
    ctx.link.sessionList = [ownSessionOf("s-1"), deviceSessionOf("s-9")];
    mount();
    let local = openMenu()[0];
    expect(local?.querySelector("[data-part='use']")).not.toBeNull();
    act(() => local?.click());
    await flush();
    expect(ctx.source.useLocal).toHaveBeenCalledOnce();

    ctx.link.ownSession.mockReturnValue(undefined);
    ctx.link.sessionList = [deviceSessionOf("s-9")];
    local = openMenu()[0];
    expect(local?.getAttribute("aria-disabled")).toBe("true");
    expect(local?.textContent).toContain("Not started");
    act(() => local?.click());
    await flush();
    expect(ctx.source.useLocal).toHaveBeenCalledOnce();
  });

  it("Connect device… shows Render and asks activeSource to open the Connect panel", () => {
    mount();
    const connect = openMenu().find(row => row.dataset.action === "connect-device");
    expect(connect?.textContent).toBe("Connect device…");
    act(() => connect?.click());
    expect(ctx.state.active).toBe("render");
    expect(ctx.emit).toHaveBeenCalledWith("workspace:changed", { ws: "render" });
    expect(ctx.source.openConnect).toHaveBeenCalledOnce();
    expect(ctx.state.popover).toBeUndefined();
  });

  it("Esc closes the source menu", () => {
    registerBuiltIns(ctx);
    mount();
    openMenu();
    act(() => {
      dispatchKey(ctx, keyEvent("Escape"));
    });
    expect(ctx.state.popover).toBeUndefined();
  });

  it("a failed switch is a warn", async () => {
    ctx.link.sessionList = [ownSessionOf("s-1"), deviceSessionOf("s-9")];
    ctx.source.useDevice.mockRejectedValueOnce(new Error("no device"));
    mount();
    const device = openMenu()[1];
    act(() => device?.click());
    await flush();
    expect(ctx.log.warn).toHaveBeenCalledWith(
      "workspace:choose-failed",
      expect.objectContaining({ session: "s-9", error: "Error: no device" })
    );
  });
});

describe("the session menu routes through activeSource (W9)", () => {
  it("a device session uses useDevice, the own frame useLocal, another page link.choose", async () => {
    ctx.link.sessionList = [
      ownSessionOf("s-1"),
      deviceSessionOf("s-9"),
      { id: "s-3", game: "merge-game 0.0.0", page: "/b", embedded: false, connectedAt: 3000 }
    ];
    mount();
    const chip = root.querySelector<HTMLButtonElement>("[data-ui='session-chip'] > button");
    const rows = (): HTMLButtonElement[] => [
      ...root.querySelectorAll<HTMLButtonElement>("[data-ui='session-menu'] [role='menuitemradio']")
    ];

    act(() => chip?.click());
    act(() => rows()[1]?.click());
    await flush();
    expect(ctx.source.useDevice).toHaveBeenCalledWith("s-9");

    act(() => chip?.click());
    act(() => rows()[0]?.click());
    await flush();
    expect(ctx.source.useLocal).toHaveBeenCalledOnce();

    act(() => chip?.click());
    act(() => rows()[2]?.click());
    await flush();
    expect(ctx.link.choose).toHaveBeenCalledExactlyOnceWith("s-3");
  });
});
