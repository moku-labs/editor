// @vitest-environment happy-dom
/* eslint-disable unicorn/no-null -- null is a JSON value on the wire and the engine's "not reported" */
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onSourceChanged } from "../../handlers";
import { notifyMission } from "../../state";
import { DEVICE, demoDirectory, demoRecorder, demoSecond } from "../device-fixtures";
import { LOCAL_LABEL, stubFrames } from "../helpers";
import { type MissionCtx, missionCtx } from "../mission-ctx";
import { answer, click, feedDemo, fire, type Mounted, mountRender } from "../mission-ui";

// ─────────────────────────────────────────────────────────────────────────────
// components/connection/* (spec 09 § M7, M16 ui-connection): the popovers —
// one open at a time, Esc and an outside click close them, Esc gives the focus
// back to the trigger; the split menu's items; the asking row's 4-digit code;
// the recording pill (who started it, Mark, Stop); no disconnect banner in
// Render (the notice is the shell's).
// ─────────────────────────────────────────────────────────────────────────────

let ctx: MissionCtx;
let view: Mounted;

beforeEach(() => {
  stubFrames();
  ctx = missionCtx({ device: true });
  ctx.activeSource.directoryValue = demoDirectory();
  ctx.state.mission.second = demoSecond(4960);
  view = mountRender(ctx);
});

afterEach(() => {
  view.unmount();
  vi.unstubAllGlobals();
});

/**
 * The trigger of a popover.
 *
 * @param id - The popover.
 * @returns The trigger.
 */
function trigger(id: string): HTMLElement | null {
  return view.q(`[data-popover-trigger='${id}']`);
}

/**
 * A 100 × 36 box at y 120 whose right edge is at `right`, as getBoundingClientRect answers it.
 *
 * @param right - The right edge, CSS px.
 * @returns The stub.
 */
function boxAt(right: number): () => DOMRect {
  return () =>
    ({ left: right - 100, right, top: 120, bottom: 156, width: 100, height: 36 }) as DOMRect;
}

describe("the connection bar's popovers", () => {
  it("Esc closes the open popover and gives the focus back to its trigger", () => {
    click(trigger("monitoring"));
    expect(view.q("[data-popover='monitoring']")).not.toBeNull();
    expect(view.q("[data-popover='monitoring']")?.getAttribute("role")).toBe("dialog");

    fire(document, new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(view.q("[data-popover='monitoring']")).toBeNull();
    expect(ctx.state.mission.popover).toBeUndefined();
    expect(document.activeElement).toBe(trigger("monitoring"));
  });

  it("an outside click closes it; a click inside does not", () => {
    click(trigger("monitoring"));
    fire(view.q("[data-popover='monitoring'] h3"), new Event("pointerdown", { bubbles: true }));
    expect(view.q("[data-popover='monitoring']")).not.toBeNull();

    fire(document.body, new Event("pointerdown", { bubbles: true }));
    expect(view.q("[data-popover='monitoring']")).toBeNull();
  });

  it("only one popover is open at a time; the Connect panel's scan lease ends with it", () => {
    click(trigger("connect"));
    expect(view.q("[data-popover='connect']")).not.toBeNull();
    expect(ctx.activeSource.api.scan).toHaveBeenCalledTimes(1);

    click(trigger("monitoring"));

    expect(view.all("[data-popover]").map(element => element.dataset.popover)).toEqual([
      "monitoring"
    ]);
    expect(ctx.activeSource.scanStops).toHaveBeenCalledTimes(1);
  });

  it("the Connect panel hangs under the whole split button, right edges aligned, not under its left half", () => {
    const split = view.q("[data-split]");
    const main = trigger("connect");
    if (split === null || main === null) throw new Error("no split button");
    split.getBoundingClientRect = boxAt(900);
    main.getBoundingClientRect = boxAt(870);

    click(main);

    const panel = view.q("[data-popover='connect']");
    expect(panel?.style.left).toBe("900px");
    expect(panel?.style.top).toBe("166px");
  });

  it("the split menu offers By wire and On the network, and Linked devices once a phone is linked", () => {
    ctx.activeSource.directoryValue = { ...demoDirectory(), linked: [] };
    act(() => notifyMission(ctx.state.mission));
    click(trigger("split"));
    const items = () =>
      view.all("[data-popover='split'] [role='menuitem']").map(item => item.dataset.tab);
    expect(view.q("[data-popover='split']")?.getAttribute("role")).toBe("menu");
    expect(items()).toEqual(["wire", "network"]);

    ctx.activeSource.directoryValue = demoDirectory();
    act(() => notifyMission(ctx.state.mission));
    expect(items()).toEqual(["wire", "network", "linked"]);

    click(view.q("[data-popover='split'] [data-tab='network']"));
    expect(ctx.state.mission.popover).toBe("connect");
    expect(view.q("[data-connect-panel]")?.dataset.tab).toBe("network");
  });

  it("the 4-digit code of an asking phone is sent with Enter (the form's submit)", async () => {
    ctx.activeSource.directoryValue = {
      ...demoDirectory(),
      asking: [
        {
          ticket: "p-3a1f",
          model: "SM-A266B",
          // eslint-disable-next-line sonarjs/no-hardcoded-ip -- the design's phone on the LAN
          address: "192.168.1.23",
          link: "lan",
          engine: null,
          build: null,
          since: 0
        }
      ]
    };
    click(trigger("split"));
    click(view.q("[data-popover='split'] [data-tab='network']"));
    const input = view.q<HTMLInputElement>("[data-asking-row] input");
    expect(input?.getAttribute("inputmode")).toBe("numeric");
    expect(input?.getAttribute("autocomplete")).toBe("one-time-code");

    act(() => {
      if (input === null) return;
      input.value = "48a21";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(ctx.state.mission.connect.codes.get("p-3a1f")).toBe("4821");
    await act(async () => {
      input?.form?.requestSubmit();
      for (let index = 0; index < 10; index += 1) await Promise.resolve();
    });

    expect(ctx.activeSource.api.confirmPairing).toHaveBeenCalledWith("p-3a1f", "4821");
  });
});

describe("the connection bar", () => {
  it("names the phone, its model and how it is linked, and offers Use local preview", () => {
    expect(view.q("[data-source-pill]")?.dataset.kind).toBe("device");
    expect(view.q("[data-source-name]")?.textContent).toBe("Galaxy A26");
    expect(view.q("[data-source-pill] [data-part='sub']")?.textContent).toBe("SM-A266B");
    expect(view.q("[data-health]")?.textContent).toContain("by wire, USB");

    click(view.q("[data-action='use-local']"));
    expect(ctx.activeSource.api.useLocal).toHaveBeenCalledTimes(1);
  });

  it("a recording shows who started it, Mark adds the next mark and Stop runs editor.record { on: false }", async () => {
    ctx.state.mission.recorder = demoRecorder();
    act(() => notifyMission(ctx.state.mission));
    const pill = view.q("[data-record-pill]");
    expect(pill?.getAttribute("role")).toBe("status");
    expect(pill?.textContent).toContain("00:42");
    expect(pill?.textContent).toContain("by agent (Claude)");

    click(view.q("[data-record-pill] [data-action='mark']"));
    expect(ctx.runs.at(-1)).toMatchObject({ id: "editor.record", input: { mark: "mark 3" } });
    await answer(ctx.runs, "editor.record", {
      on: true,
      file: null,
      startedBy: null,
      marked: true
    });

    click(view.q("[data-record-pill] [data-action='stop']"));
    expect(ctx.runs.at(-1)).toMatchObject({ id: "editor.record", input: { on: false } });
  });

  it("Render renders no disconnect banner when the phone is lost: the marker and the bar say it", () => {
    feedDemo(ctx);
    ctx.activeSource.current = { kind: "local", session: "s-1" };
    ctx.activeSource.label = LOCAL_LABEL;
    ctx.activeSource.markersValue = [
      {
        at: 1_792_000_070_000,
        kind: "lost",
        label: "Galaxy A26 disconnected here · Local preview resumed",
        device: DEVICE.id
      }
    ];
    act(() =>
      onSourceChanged(ctx)({
        from: { kind: "device", session: "s-9", device: DEVICE },
        to: { kind: "local", session: "s-1" },
        reason: "lost",
        at: 1_792_000_070_000
      })
    );

    expect(view.q("[data-source-pill]")?.dataset.kind).toBe("local");
    expect(view.host.textContent).not.toContain("disconnected");
    expect(view.q("[role='alert']")).toBeNull();
  });
});
