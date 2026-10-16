/* eslint-disable unicorn/no-null -- Preact unmounts by rendering null */
import { render } from "preact";
import { act } from "preact/test-utils";
import type { PanelTools } from "../../panels/types";
import type { Json, LinkStatus } from "../../registry/protocol";
import { createRenderPanel } from "../panel";
import { appendEvents, appendFrames } from "../source/contract";
import { notifyMission } from "../state";
import { demoEvents, demoFrames, demoPasses, demoSecond } from "./device-fixtures";
import type { TestCtx } from "./helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Mounting the Render workspace in happy-dom for Mission control's component
// tests: the panel's view with a live link status, queries inside it, events
// fired inside act(), and the demo phone's data put straight into the state.
// ─────────────────────────────────────────────────────────────────────────────

/** A mounted Render workspace. */
export type Mounted = {
  readonly host: HTMLElement;
  /** Renders the panel again (a new status). */
  show(status?: LinkStatus): void;
  q<T extends Element = HTMLElement>(selector: string): T | null;
  all<T extends Element = HTMLElement>(selector: string): T[];
  unmount(): void;
};

/**
 * Mounts the Render panel's view of a test ctx into a new element of the body.
 *
 * @param ctx - The test ctx.
 * @returns The mount.
 */
export function mountRender(ctx: TestCtx): Mounted {
  const host = document.createElement("div");
  document.body.append(host);
  const panel = createRenderPanel(ctx);
  const tools = (status: LinkStatus): PanelTools<Readonly<Record<string, string>>> => ({
    run: {},
    status,
    channel: ctx.link.api,
    files: ctx.link.api.files,
    workspace: ctx.workspace.api
  });
  const show = (status?: LinkStatus): void => {
    act(() => {
      render(panel.view({}, tools(status ?? { kind: "live", frame: 4960 })), host);
    });
  };
  show();
  return {
    host,
    show,
    q: <T extends Element = HTMLElement>(selector: string) => host.querySelector<T>(selector),
    all: <T extends Element = HTMLElement>(selector: string) => [
      ...host.querySelectorAll<T>(selector)
    ],
    unmount() {
      act(() => render(null, host));
      host.remove();
    }
  };
}

/**
 * Dispatches an event on an element inside act().
 *
 * @param element - The target.
 * @param event - The event.
 */
export function fire(element: Element | Document | null, event: Event): void {
  act(() => {
    element?.dispatchEvent(event);
  });
}

/**
 * Clicks an element inside act().
 *
 * @param element - The element.
 */
export function click(element: Element | null): void {
  act(() => {
    (element as HTMLElement | null)?.click();
  });
}

/**
 * Puts the demo phone's frames (from f4601 to `last`), events, newest second and passes into the
 * state and re-renders Mission control.
 *
 * @param ctx - The test ctx.
 * @param last - The newest frame.
 */
export function feedDemo(ctx: TestCtx, last = 4960): void {
  const { mission } = ctx.state;
  appendFrames(mission.history, demoFrames(undefined, last));
  appendEvents(mission.history, demoEvents(undefined, last));
  mission.second = demoSecond(last);
  mission.passes = demoPasses(last);
  act(() => notifyMission(mission));
}

/**
 * Answers the newest pending call of an id with a value.
 *
 * @param calls - The pending calls.
 * @param id - The id.
 * @param value - The answer.
 */
export async function answer(
  calls: readonly { id: string; resolve(value: Json): void }[],
  id: string,
  value: Json
): Promise<void> {
  const call = calls.findLast(entry => entry.id === id);
  await act(async () => {
    call?.resolve(value);
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
  });
}
