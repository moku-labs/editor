import { describe, expect, it } from "vitest";
import { linkPlugin } from "../..";
import { createLinkState, isAttached } from "../../state";
import { sessionOf } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The plugin instance, its default config and the initial state
// ─────────────────────────────────────────────────────────────────────────────

describe("linkPlugin", () => {
  it("is named link and has exactly the contract config", () => {
    expect(linkPlugin.name).toBe("link");
    expect(linkPlugin.spec.config).toEqual({
      retryMs: 1000,
      boot: "#moku-editor-boot",
      role: "page",
      reloadGraceMs: 8000
    });
  });

  it("declares no depends and no plugin events", () => {
    expect("depends" in linkPlugin.spec).toBe(false);
    expect("events" in linkPlugin.spec).toBe(false);
  });
});

describe("createLinkState", () => {
  it("starts connecting with nothing attached and ids from 1", () => {
    const state = createLinkState({
      config: { retryMs: 1000, boot: "#b", role: "page", reloadGraceMs: 8000 }
    });

    expect(state.status).toEqual({ kind: "connecting" });
    expect(state.boot).toBeUndefined();
    expect(state.socket).toBeUndefined();
    expect(state.open).toBe(false);
    expect(state.attempt).toBe(0);
    expect(state.nextId).toBe(1);
    expect(state.nextSub).toBe(1);
    expect(state.nextKey).toBe(1);
    expect(state.generation).toBe(0);
    expect(state.pending.size).toBe(0);
    expect(state.sessions).toEqual([]);
    expect(state.chosen).toBeUndefined();
    expect(state.sticky).toBe(false);
    expect(state.manifests.size).toBe(0);
    expect(state.manifestListeners.size).toBe(0);
    expect(state.subs.size).toBe(0);
    expect(state.wire.size).toBe(0);
    expect(state.heartbeat).toBeUndefined();
    expect(state.lostAt).toBeUndefined();
    expect(state.retryTimer).toBeUndefined();
    expect(state.silenceTimer).toBeUndefined();
    expect(state.reload).toBeUndefined();
    expect(state.stopped).toBe(false);
    expect(state.selection).toBeUndefined();
    expect(state.notified.size).toBe(0);
    expect(state.handlers.size).toBe(0);
    expect(state.hotReloadWaiters.size).toBe(0);
  });

  it("returns a fresh state each time", () => {
    const config = { retryMs: 1000, boot: "#b", role: "page" as const, reloadGraceMs: 8000 };
    expect(createLinkState({ config }).pending).not.toBe(createLinkState({ config }).pending);
  });

  it("makes one random frame id per state", () => {
    const config = { retryMs: 1000, boot: "#b", role: "page" as const, reloadGraceMs: 8000 };
    const state = createLinkState({ config });
    expect(state.frame).toMatch(/^[\da-f]{12}$/);
    expect(createLinkState({ config }).frame).not.toBe(state.frame);
  });
});

describe("isAttached", () => {
  it("is true only with an open socket and the chosen id in the current list", () => {
    const state = createLinkState({
      config: { retryMs: 1000, boot: "#b", role: "page", reloadGraceMs: 8000 }
    });
    expect(isAttached(state)).toBe(false);

    state.open = true;
    state.chosen = "s-1";
    expect(isAttached(state)).toBe(false);

    state.sessions = [sessionOf("s-1")];
    expect(isAttached(state)).toBe(true);

    state.open = false;
    expect(isAttached(state)).toBe(false);
  });
});
