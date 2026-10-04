import type { ComponentChild } from "preact";
import { render } from "preact";
import { act } from "preact/test-utils";
import { vi } from "vitest";
import { actionsOf } from "../actions";
import { FlowWorkspace } from "../panel";
import type { FlowActions, FlowCtx } from "../types";
import { createTestCtx, flush, jumpCamera, prepare, type TestCtx } from "./ctx";

// ─────────────────────────────────────────────────────────────────────────────
// Rendering helpers of the component tests (happy-dom): mount into a fresh
// host and a prepared context with the merge graph laid out.
// ─────────────────────────────────────────────────────────────────────────────

/** Does nothing. */
const noop = (): void => {};

/** A mounted tree. */
export type Mounted = {
  readonly host: HTMLElement;
  readonly unmount: () => void;
};

/** Renders a tree into a fresh host element. */
export function mount(tree: ComponentChild): Mounted {
  const host = document.createElement("div");
  document.body.append(host);
  act(() => {
    render(tree, host);
  });
  return {
    host,
    unmount: () => {
      act(() => {
        render(undefined, host);
      });
      host.remove();
    }
  };
}

/** A context with the merge graph laid out and its actions. */
export async function prepared(
  path = "board/awaitIntent"
): Promise<TestCtx & { readonly actions: FlowActions }> {
  jumpCamera();
  vi.stubGlobal("ResizeObserver", undefined);
  const test = createTestCtx();
  await prepare(test.ctx, path);
  return { ...test, actions: actionsOf(test.ctx) };
}

/** Mounts the whole Flow workspace for a context. */
export async function mountWorkspace(ctx: FlowCtx): Promise<Mounted> {
  const tools = { workspace: { previewZone: () => noop } } as unknown as Parameters<
    typeof FlowWorkspace
  >[0]["tools"];
  const mounted = mount(<FlowWorkspace ctx={ctx} tools={tools} />);
  await act(async () => {
    await flush(5);
  });
  return mounted;
}

/** Runs state changes inside act and lets effects settle. */
export async function settle(run: () => void = noop): Promise<void> {
  await act(async () => {
    run();
    await flush(5);
  });
}

/** Dispatches a pointer event with coordinates. */
export function pointer(
  target: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  x: number,
  y: number,
  extra: { button?: number } = {}
): void {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: extra.button ?? 0,
    pointerId: 1
  });
  act(() => {
    target.dispatchEvent(event);
  });
}
