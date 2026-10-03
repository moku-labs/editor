// @vitest-environment happy-dom
import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Manifest } from "../../../registry/protocol";
import { DeviceToolbar } from "../../ui/DeviceToolbar";
import { createCtx, manifestOf, type TestCtx } from "../helpers";
import { find } from "../ui";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

/**
 * Makes the link mock keep its manifest listeners, like the real link: a listener is called at
 * once when a manifest exists, then on every change.
 *
 * @param ctx - The gameView test ctx.
 * @returns Sets the manifest and calls every listener.
 */
function liveManifest(ctx: TestCtx): (manifest: Manifest | undefined) => void {
  const listeners = new Set<(manifest: Manifest | undefined) => void>();
  vi.spyOn(ctx.link.api, "onManifest").mockImplementation(fn => {
    listeners.add(fn);
    if (ctx.link.manifestValue !== undefined) fn(ctx.link.manifestValue);
    return () => {
      listeners.delete(fn);
    };
  });
  return manifest => {
    ctx.link.manifestValue = manifest;
    for (const listener of listeners) listener(manifest);
  };
}

/**
 * Lets Preact's after-paint effects and the re-render run: runs every pending fake timer, with
 * the microtasks between them.
 *
 * @returns Resolves when no timer is pending.
 */
async function afterPaint(): Promise<void> {
  await vi.runAllTimersAsync();
}

describe("DeviceToolbar manifest", () => {
  it("a lost manifest right after the first render reaches the toolbar", async () => {
    const ctx = createCtx();
    ctx.link.manifestValue = manifestOf([]);
    const setManifest = liveManifest(ctx);
    const root = document.createElement("div");
    document.body.append(root);
    // No act(): effects run on Preact's own schedule, as in the tools page.
    render(<DeviceToolbar ctx={ctx} />, root);
    expect(find(root, "[data-part='capture']").getAttribute("aria-disabled")).toBe("true");
    // The session is lost: no manifest, so no command is missing.
    setManifest(undefined);
    await afterPaint();
    expect(find(root, "[data-part='capture']").getAttribute("aria-disabled")).not.toBe("true");
    render(undefined, root);
  });
});
