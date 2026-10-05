/* eslint-disable unicorn/no-null -- null is the JSON value the wire carries */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Json, RunResult } from "../../../registry/protocol";
import { CHECKPOINT_KEY } from "../../checkpoint/checkpoint";
import { defaultReload } from "../../checkpoint/hot";
import { stopBridge } from "../../lifecycle";
import { reloadEntry } from "../../reload";
import { RELOAD_ID } from "../../types";
import { commandEntry, createDeps, ENVELOPE, rejectionOf } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// editor.reload (moku_reload): stores the checkpoint the way bun:beforeFullReload
// does, answers { scheduled: true }, then reloads the page on the next macrotask,
// after the answer went out. The new document restores the checkpoint.
// ─────────────────────────────────────────────────────────────────────────────

/** The bookmark value the fake game answers. */
const BOOKMARK: Json = { path: "board/awaitIntent", state: { coins: 7 } };

/**
 * Deps whose registry has game.bookmark, and the editor.reload entry over them.
 *
 * @returns The deps, the bookmark run mock and the entry.
 */
function setup() {
  const deps = createDeps();
  const bookmark = vi.fn(
    (_raw: Json): Promise<RunResult> =>
      Promise.resolve({ value: BOOKMARK, state: { ...ENVELOPE, frame: 40 } })
  );
  deps.registry.commands.set("game.bookmark", commandEntry("game.bookmark", bookmark));
  deps.registry.clockValue = { frame: 1840, paused: true };
  return { deps, bookmark, entry: reloadEntry(deps) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_790_000_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("reloadEntry", () => {
  it("describes a route command with an optional restore flag", () => {
    const { entry } = setup();

    expect(RELOAD_ID).toBe("editor.reload");
    expect(entry.descriptor).toEqual({
      id: "editor.reload",
      title: "Reload the page",
      input: { restore: "boolean?" },
      effect: "route"
    });
  });

  it("stores the checkpoint before it answers, then reloads on the next macrotask", async () => {
    const { deps, bookmark, entry } = setup();

    const ran = await entry.run(null);

    expect(ran).toEqual({ value: { scheduled: true }, state: ENVELOPE });
    expect(bookmark).toHaveBeenCalledWith(null);
    expect(JSON.parse(deps.reload.storage.getItem(CHECKPOINT_KEY) ?? "null")).toEqual({
      v: 1,
      doc: 5000,
      at: 1_790_000_000_000,
      frame: 1840,
      paused: true,
      bookmark: BOOKMARK
    });
    expect(deps.reload.reloadPage).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(0);

    expect(deps.reload.reloadPage).toHaveBeenCalledOnce();
    expect(deps.state.off).toEqual([]);
  });

  it("restore: true is the default spelled out", async () => {
    const { deps, entry } = setup();

    await entry.run({ restore: true });

    expect(deps.reload.storage.items.has(CHECKPOINT_KEY)).toBe(true);
  });

  it("restore: false skips the checkpoint and still reloads", async () => {
    const { deps, bookmark, entry } = setup();

    const ran = await entry.run({ restore: false });
    await vi.advanceTimersByTimeAsync(0);

    expect(ran.value).toEqual({ scheduled: true });
    expect(bookmark).not.toHaveBeenCalled();
    expect(deps.reload.storage.items.size).toBe(0);
    expect(deps.reload.reloadPage).toHaveBeenCalledOnce();
  });

  it("still reloads when the checkpoint cannot be taken, and logs why", async () => {
    const { deps, bookmark, entry } = setup();
    bookmark.mockRejectedValueOnce(new Error("[moku-editor] no rest point"));

    const ran = await entry.run(null);
    await vi.advanceTimersByTimeAsync(0);

    expect(ran.value).toEqual({ scheduled: true });
    expect(deps.log.warn).toHaveBeenCalledWith("bridge:checkpoint-failed", {
      message: "[moku-editor] no rest point"
    });
    expect(deps.reload.reloadPage).toHaveBeenCalledOnce();
  });

  it("refuses a restore that is not a boolean with -32602 and schedules nothing", async () => {
    const { deps, entry } = setup();

    expect(await rejectionOf(entry.run({ restore: "yes" }))).toMatchObject({
      code: -32_602,
      data: { reason: "invalid_input", field: "restore" }
    });
    expect(await rejectionOf(entry.run({ hard: true }))).toMatchObject({
      code: -32_602,
      data: { field: "hard" }
    });
    expect(vi.getTimerCount()).toBe(0);
    expect(deps.reload.reloadPage).not.toHaveBeenCalled();
  });

  it("a stop before the macrotask cancels the reload", async () => {
    const { deps, entry } = setup();

    await entry.run({ restore: false });
    stopBridge({ state: deps.state });
    await vi.advanceTimersByTimeAsync(0);

    expect(deps.reload.reloadPage).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("defaultReload().reloadPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls location.reload of the page", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { href: "http://127.0.0.1:3000/game.html", reload });

    defaultReload().reloadPage();

    expect(reload).toHaveBeenCalledOnce();
  });

  it("does nothing outside a browser page", () => {
    vi.stubGlobal("location", undefined);

    expect(() => {
      defaultReload().reloadPage();
    }).not.toThrow();
  });
});
