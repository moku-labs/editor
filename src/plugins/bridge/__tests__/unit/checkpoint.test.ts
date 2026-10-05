/* eslint-disable unicorn/no-null -- null is the JSON value the wire carries */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Json, RunResult } from "../../../registry/protocol";
import {
  CHECKPOINT_KEY,
  CHECKPOINT_MAX_AGE_MS,
  helloManifest,
  restoreCheckpoint,
  takeCheckpoint,
  takeStoredCheckpoint,
  watchReload
} from "../../checkpoint/checkpoint";
import { storageOf } from "../../checkpoint/hot";
import type { CheckpointStorage } from "../../types";
import type { TestDeps } from "../helpers";
import { commandEntry, createDeps, FakeSocket, flush, MANIFEST } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The bridge checkpoint across Bun's full reload (R6): the bookmark is taken at
// once on bun:beforeFullReload and stored in sessionStorage with the pause flag;
// the next document's bridge restores it, re-pauses, and tells the hub in hello.
// ─────────────────────────────────────────────────────────────────────────────

/** The bookmark value the fake game answers. */
const BOOKMARK: Json = { path: "board/awaitIntent", state: { coins: 7 } };

/** A run result around a value. */
function ranWith(value: Json): RunResult {
  return { value, state: { path: "board/awaitIntent", frame: 40, tainted: false } };
}

/**
 * Deps whose registry has game.bookmark, game.restore and game.pause.
 *
 * @returns The deps and the three run mocks.
 */
function depsWithCommands() {
  const deps = createDeps();
  const bookmark = vi.fn((_raw: Json) => Promise.resolve(ranWith(BOOKMARK)));
  const restore = vi.fn((_raw: Json) => Promise.resolve(ranWith(null)));
  const pause = vi.fn((_raw: Json) => Promise.resolve(ranWith(true)));
  deps.registry.commands.set("game.bookmark", commandEntry("game.bookmark", bookmark));
  deps.registry.commands.set("game.restore", commandEntry("game.restore", restore));
  deps.registry.commands.set("game.pause", commandEntry("game.pause", pause));
  return { deps, bookmark, restore, pause };
}

/**
 * Stores a checkpoint written by another document.
 *
 * @param deps - The deps.
 * @param fields - Fields to change.
 */
function storeCheckpoint(deps: TestDeps, fields: Record<string, Json> = {}): void {
  const checkpoint = {
    v: 1,
    doc: 1000,
    at: Date.now(),
    frame: 1840,
    paused: false,
    bookmark: BOOKMARK,
    ...fields
  };
  deps.reload.storage.setItem(CHECKPOINT_KEY, JSON.stringify(checkpoint));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_790_000_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("takeCheckpoint", () => {
  it("runs game.bookmark through the registry at once and stores it with the clock", async () => {
    const { deps, bookmark } = depsWithCommands();
    deps.registry.clockValue = { frame: 1840, paused: true };

    takeCheckpoint(deps);
    expect(bookmark).toHaveBeenCalledTimes(1);
    expect(bookmark).toHaveBeenCalledWith(null);
    expect(deps.reload.storage.items.size).toBe(0);

    await flush();
    const stored = JSON.parse(deps.reload.storage.getItem(CHECKPOINT_KEY) ?? "null");
    expect(stored).toEqual({
      v: 1,
      doc: 5000,
      at: 1_790_000_000_000,
      frame: 1840,
      paused: true,
      bookmark: BOOKMARK
    });
  });

  it("does nothing without storage or without game.bookmark", async () => {
    const without = createDeps();
    takeCheckpoint(without);
    await flush();
    expect(without.reload.storage.items.size).toBe(0);

    const { deps, bookmark } = depsWithCommands();
    const noStorage = { ...deps, reload: { ...deps.reload, storage: undefined } };
    takeCheckpoint(noStorage);
    expect(bookmark).not.toHaveBeenCalled();
  });

  it("logs a failed bookmark and stores nothing", async () => {
    const { deps, bookmark } = depsWithCommands();
    bookmark.mockRejectedValueOnce(new Error("[moku-editor] no rest point"));

    takeCheckpoint(deps);
    await flush();

    expect(deps.reload.storage.items.size).toBe(0);
    expect(deps.log.warn).toHaveBeenCalledWith("bridge:checkpoint-failed", {
      message: "[moku-editor] no rest point"
    });
  });

  it("logs a storage that refuses the write", async () => {
    const { deps } = depsWithCommands();
    deps.reload.storage.setItem = () => {
      throw new Error("quota");
    };

    takeCheckpoint(deps);
    await flush();

    expect(deps.log.warn).toHaveBeenCalledWith("bridge:checkpoint-failed", { message: "quota" });
  });

  it("logs a clock that throws (no game) and runs nothing", () => {
    const { deps, bookmark } = depsWithCommands();
    deps.registry.clock = () => {
      throw new Error("[moku-editor] registry.game is missing.");
    };

    takeCheckpoint(deps);

    expect(bookmark).not.toHaveBeenCalled();
    expect(deps.log.warn).toHaveBeenCalledWith("bridge:checkpoint-failed", {
      message: "[moku-editor] registry.game is missing."
    });
  });
});

describe("watchReload", () => {
  it("takes the checkpoint on bun:beforeFullReload until removed", async () => {
    const { deps, bookmark } = depsWithCommands();
    const off = watchReload(deps);

    deps.reload.fire();
    await flush();
    expect(bookmark).toHaveBeenCalledTimes(1);
    expect(deps.reload.storage.getItem(CHECKPOINT_KEY)).not.toBeNull();

    off();
    deps.reload.fire();
    expect(bookmark).toHaveBeenCalledTimes(1);
  });
});

describe("watchReload says bye (U7)", () => {
  it("sends bye on bun:beforeFullReload, so the tools read the reload as expected", () => {
    const { deps } = depsWithCommands();
    const socket = new FakeSocket();
    socket.readyState = 1;
    deps.state.socket = socket;
    watchReload(deps);

    deps.reload.fire();

    expect(socket.messages()).toEqual([{ jsonrpc: "2.0", channel: "game", method: "bye" }]);
    expect(socket.closes).toEqual([]);
  });

  it("sends nothing without an open socket", () => {
    const { deps } = depsWithCommands();
    watchReload(deps);
    expect(() => {
      deps.reload.fire();
    }).not.toThrow();
  });
});

describe("takeStoredCheckpoint", () => {
  it("answers undefined and leaves storage alone when nothing is stored", () => {
    const deps = createDeps();
    expect(takeStoredCheckpoint(deps)).toBeUndefined();
  });

  it("takes and removes a checkpoint another document stored", () => {
    const deps = createDeps();
    storeCheckpoint(deps, { paused: true });

    expect(takeStoredCheckpoint(deps)).toEqual({ frame: 1840, paused: true, bookmark: BOOKMARK });
    expect(deps.reload.storage.getItem(CHECKPOINT_KEY)).toBeNull();
  });

  it("leaves a checkpoint this document stored (Bun runs new code in the old page first)", () => {
    const deps = createDeps();
    storeCheckpoint(deps, { doc: 5000 });

    expect(takeStoredCheckpoint(deps)).toBeUndefined();
    expect(deps.reload.storage.getItem(CHECKPOINT_KEY)).not.toBeNull();
  });

  it("drops a malformed or stale checkpoint", () => {
    const deps = createDeps();
    for (const text of [
      "{nope",
      JSON.stringify({ v: 2, doc: 1, at: Date.now(), frame: 1, paused: false, bookmark: {} }),
      JSON.stringify({ v: 1, doc: 1, at: Date.now(), frame: "1", paused: false, bookmark: {} }),
      JSON.stringify({ v: 1, doc: 1, at: Date.now(), frame: 1, paused: false }),
      JSON.stringify({
        v: 1,
        doc: 1,
        at: Date.now() - CHECKPOINT_MAX_AGE_MS - 1,
        frame: 1,
        paused: false,
        bookmark: {}
      })
    ]) {
      deps.reload.storage.setItem(CHECKPOINT_KEY, text);
      expect(takeStoredCheckpoint(deps)).toBeUndefined();
      expect(deps.reload.storage.getItem(CHECKPOINT_KEY)).toBeNull();
    }
  });

  it("answers undefined without storage", () => {
    const deps = createDeps();
    expect(takeStoredCheckpoint({ ...deps, reload: { ...deps.reload, storage: undefined } })).toBe(
      undefined
    );
  });
});

describe("restoreCheckpoint", () => {
  it("restores the bookmark and keeps restored for the hello", async () => {
    const { deps, restore, pause } = depsWithCommands();

    await restoreCheckpoint(deps, { frame: 1840, paused: false, bookmark: BOOKMARK });

    expect(restore).toHaveBeenCalledWith({ bookmark: BOOKMARK });
    expect(pause).not.toHaveBeenCalled();
    expect(deps.state.restored).toEqual({ bookmark: JSON.stringify(BOOKMARK), frame: 1840 });
    expect(deps.log.info).toHaveBeenCalledWith("bridge:restored", { frame: 1840 });
  });

  it("pauses again after the restore when the checkpoint was paused", async () => {
    const { deps, restore, pause } = depsWithCommands();

    await restoreCheckpoint(deps, { frame: 7, paused: true, bookmark: BOOKMARK });

    expect(pause).toHaveBeenCalledWith(null);
    expect(restore.mock.invocationCallOrder[0]).toBeLessThan(
      pause.mock.invocationCallOrder[0] ?? 0
    );
  });

  it("logs a failed restore and keeps no restored entry", async () => {
    const { deps, restore } = depsWithCommands();
    restore.mockRejectedValueOnce(new Error("[moku-editor] bad bookmark"));

    await restoreCheckpoint(deps, { frame: 7, paused: true, bookmark: BOOKMARK });

    expect(deps.state.restored).toBeUndefined();
    expect(deps.log.warn).toHaveBeenCalledWith("bridge:restore-failed", {
      message: "[moku-editor] bad bookmark"
    });
  });

  it("logs a game without game.restore and keeps no restored entry", async () => {
    const deps = createDeps();
    await restoreCheckpoint(deps, { frame: 7, paused: false, bookmark: BOOKMARK });
    expect(deps.state.restored).toBeUndefined();
    expect(deps.log.warn).toHaveBeenCalledWith("bridge:restore-failed", {
      message: "the game has no game.restore"
    });
  });

  it("keeps restored when only the re-pause fails", async () => {
    const { deps, pause } = depsWithCommands();
    pause.mockRejectedValueOnce(new Error("no lifecycle"));

    await restoreCheckpoint(deps, { frame: 7, paused: true, bookmark: BOOKMARK });

    expect(deps.state.restored).toEqual({ bookmark: JSON.stringify(BOOKMARK), frame: 7 });
    expect(deps.log.warn).toHaveBeenCalledWith("bridge:pause-failed", { message: "no lifecycle" });
  });
});

describe("helloManifest", () => {
  it("adds restored to the first hello after a restore, then never again", () => {
    const deps = createDeps();
    deps.state.restored = { bookmark: "{}", frame: 3 };

    expect(helloManifest(deps)).toEqual({ ...MANIFEST, restored: { bookmark: "{}", frame: 3 } });
    expect(helloManifest(deps)).toEqual(MANIFEST);
    expect(deps.state.restored).toBeUndefined();
  });
});

describe("storageOf", () => {
  it("is the scope's sessionStorage, undefined without one or where reading it throws", () => {
    const storage: CheckpointStorage = {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined
    };
    const sandboxed = {
      get sessionStorage(): CheckpointStorage {
        throw new Error("SecurityError");
      }
    };

    expect(storageOf({ sessionStorage: storage })).toBe(storage);
    expect(storageOf({})).toBeUndefined();
    expect(storageOf(sandboxed)).toBeUndefined();
  });
});
