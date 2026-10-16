// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"navigation":{"disableChildFrameNavigation":true}}}
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceNotice } from "../../../activeSource/types";
import { WORKSPACE_IDS } from "../../../panels/shared/workspaces";
import { createWorkspaceApi } from "../../api";
import { initWorkspace, stopWorkspace } from "../../lifecycle";
import type { WorkspaceApi } from "../../types";
import { createCtx, deviceSessionOf, flush, IPHONE, type TestCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// W10 the shell's disconnect notice: under the top bar in every workspace while
// activeSource's notice holds, gone at its end, with Reconnect and Dismiss.
// ─────────────────────────────────────────────────────────────────────────────

/** Epoch ms of the test clock. */
const NOW = 1_791_986_093_963;

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

/**
 * The notice region of the shell.
 *
 * @returns The element.
 */
function region(): HTMLElement {
  const element = root.querySelector<HTMLElement>("[data-ui='source-notice']");
  if (element === null) throw new Error("no notice region");
  return element;
}

/**
 * The notice bar, when it shows.
 *
 * @returns The bar or null.
 */
function bar(): HTMLElement | null {
  return region().querySelector<HTMLElement>("[data-part='bar']");
}

/**
 * A button of the notice bar by its action.
 *
 * @param action - reconnect or dismiss.
 * @returns The button.
 */
function button(action: string): HTMLButtonElement {
  const element = bar()?.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
  if (element === undefined || element === null) throw new Error(`no ${action}`);
  return element;
}

/**
 * The disconnect notice activeSource shows after a loss, for 12 s.
 *
 * @param patch - Fields to change.
 * @returns The notice.
 */
function lostNotice(patch: Partial<SourceNotice> = {}): SourceNotice {
  return {
    device: "d-7f3a",
    model: "SM-A266B",
    text: "Galaxy A26 disconnected. Showing the local preview.",
    until: NOW + 12_000,
    back: false,
    ...patch
  };
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"]
  });
  vi.setSystemTime(NOW);
  localStorage.clear();
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

describe("the disconnect notice (W10)", () => {
  it("shows under the top bar in every workspace while the notice holds, as a polite status", () => {
    expect(bar()).toBeNull();

    ctx.source.noticeValue = lostNotice();
    bump();
    const shell = root.querySelector("[data-ui='shell']");
    expect(shell?.querySelector(":scope > [data-ui='top-bar'] + [data-ui='source-notice']")).toBe(
      region()
    );
    expect(region().getAttribute("role")).toBe("status");
    expect(region().getAttribute("aria-live")).toBe("polite");
    expect(bar()?.textContent).toContain("Galaxy A26 disconnected. Showing the local preview.");
    expect(bar()?.querySelector("b")?.textContent).toBe("Galaxy A26 disconnected.");

    for (const ws of WORKSPACE_IDS) {
      act(() => api.show(ws));
      expect(bar(), ws).not.toBeNull();
    }
  });

  it("is gone at the notice's end without any event (bug: a notice that never leaves)", () => {
    ctx.source.noticeValue = lostNotice();
    bump();
    expect(bar()).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(11_999);
    });
    expect(bar()).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(bar()).toBeNull();
  });

  it("a notice Reconnect is waiting on (no end) stays and is marked pinned", () => {
    ctx.source.noticeValue = lostNotice({
      text: "Waiting for Galaxy A26…",
      until: Number.POSITIVE_INFINITY
    });
    bump();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(bar()).not.toBeNull();
    expect(bar()?.dataset.pinned).toBe("");
  });

  it("Reconnect calls activeSource.reconnect and repaints with the waiting text", async () => {
    ctx.source.noticeValue = lostNotice();
    ctx.source.reconnect.mockImplementation(() => {
      ctx.source.noticeValue = lostNotice({
        text: "Waiting for Galaxy A26…",
        until: Number.POSITIVE_INFINITY
      });
      return Promise.resolve(false);
    });
    bump();
    expect(button("reconnect").textContent).toBe("Reconnect");

    act(() => button("reconnect").click());
    await act(flush);
    expect(ctx.source.reconnect).toHaveBeenCalledOnce();
    expect(ctx.source.useDevice).not.toHaveBeenCalled();
    expect(bar()?.textContent).toContain("Waiting for Galaxy A26…");
  });

  it("a back device reads Use: reconnect rejoins it, else useDevice takes its newest session", async () => {
    ctx.link.sessionList = [deviceSessionOf("s-12", IPHONE)];
    ctx.source.noticeValue = lostNotice({
      device: IPHONE.id,
      model: IPHONE.model,
      text: "IPHONE15,4 connected — Use",
      back: true
    });
    bump();
    expect(button("reconnect").textContent).toBe("Use");

    act(() => button("reconnect").click());
    await act(flush);
    expect(ctx.source.reconnect).toHaveBeenCalledOnce();
    expect(ctx.source.useDevice).toHaveBeenCalledWith("s-12");

    // A lost device that came back is rejoined by reconnect itself.
    ctx.source.reconnect.mockResolvedValueOnce(true);
    act(() => button("reconnect").click());
    await act(flush);
    expect(ctx.source.useDevice).toHaveBeenCalledOnce();
  });

  it("a failed Reconnect is a warn", async () => {
    ctx.source.noticeValue = lostNotice();
    ctx.source.reconnect.mockRejectedValueOnce(new Error("link closed"));
    bump();
    act(() => button("reconnect").click());
    await act(flush);
    expect(ctx.log.warn).toHaveBeenCalledWith(
      "workspace:reconnect-failed",
      expect.objectContaining({ error: "Error: link closed" })
    );
  });

  it("Dismiss closes the notice now", () => {
    ctx.source.noticeValue = lostNotice();
    bump();
    expect(button("dismiss").getAttribute("aria-label")).toBe("Dismiss");

    act(() => button("dismiss").click());
    expect(ctx.source.dismissNotice).toHaveBeenCalledOnce();
    expect(bar()).toBeNull();
  });
});
