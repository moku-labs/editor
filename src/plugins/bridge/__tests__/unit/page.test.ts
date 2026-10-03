import { describe, expect, it } from "vitest";
import { notification } from "../../../registry/protocol";
import { watchVisibility } from "../../page";
import { createDeps, openDeps } from "../helpers";

describe("watchVisibility", () => {
  it("sends one heartbeat in a microtask after visibilitychange when open", async () => {
    const { deps, socket } = openDeps();
    deps.channel.beat = { frame: 5, paused: true, at: 9 };
    watchVisibility(deps);

    deps.page.document?.dispatchEvent(new Event("visibilitychange"));
    expect(socket.sent).toEqual([]);
    await Promise.resolve();

    expect(socket.messages()).toEqual([
      notification("game", "heartbeat", { frame: 5, paused: true, at: 9 })
    ]);
    expect(deps.emit).toHaveBeenCalledWith({ status: { kind: "paused", frame: 5 } });
  });

  it("sends nothing when the bridge is not open", async () => {
    const { deps, socket } = openDeps();
    deps.state.phase = "lost";
    watchVisibility(deps);

    deps.page.document?.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();

    expect(socket.sent).toEqual([]);
  });

  it("the remover detaches the listener", async () => {
    const { deps, socket } = openDeps();
    const off = watchVisibility(deps);

    off();
    deps.page.document?.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();

    expect(socket.sent).toEqual([]);
  });

  it("does nothing without a document (outside a browser)", () => {
    const deps = createDeps({ page: { href: undefined, document: undefined } });

    const off = watchVisibility(deps);

    expect(off).toBeTypeOf("function");
    expect(() => off()).not.toThrow();
  });
});
