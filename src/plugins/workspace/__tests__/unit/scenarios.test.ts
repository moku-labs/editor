// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"navigation":{"disableChildFrameNavigation":true}}}
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntry } from "../../../registry/protocol";
import { createWorkspaceApi } from "../../api";
import { createFrameLayer } from "../../frame/frame";
import { reloadFrame } from "../../frame/reload";
import { stopWorkspace } from "../../lifecycle";
import { refreshScenarios, SCENARIOS_DIR, scenarioNames, setScenario } from "../../scenarios";
import type { ScenarioView } from "../../types";
import { createCtx, flush, manifestOf, resultOf, type TestCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The dev-only scenario picker: the engine's file rule, one listing at a time,
// the choice on the frame URL (?player=), the start without restore and its toast
// ─────────────────────────────────────────────────────────────────────────────

let ctx: TestCtx;

/**
 * A file entry of the scenario folder.
 *
 * @param name - The base name.
 * @param kind - File or folder.
 * @returns The entry.
 */
function entry(name: string, kind: FileEntry["kind"] = "file"): FileEntry {
  return { path: `${SCENARIOS_DIR}/${name}`, kind, size: 9 };
}

/** The folder of a game with two scenarios. */
const FOLDER: readonly FileEntry[] = [entry("full.ts"), entry("empty.ts"), entry("index.ts")];

/**
 * The texts of the visible toasts.
 *
 * @returns The messages.
 */
function toasts(): string[] {
  return ctx.state.toasts.map(toast => toast.message);
}

/**
 * Lists the folder through the mock link.
 *
 * @param entries - What `files.list` answers.
 */
async function listed(entries: readonly FileEntry[] = FOLDER): Promise<void> {
  vi.mocked(ctx.link.files.list).mockResolvedValue(entries);
  await refreshScenarios(ctx);
}

/**
 * Mounts the frame layer with a live embedded session.
 *
 * @returns The game iframe.
 */
function mounted(): HTMLIFrameElement {
  ctx.state.link = { kind: "live", frame: 1840 };
  ctx.link.current = { kind: "live", frame: 1840 };
  ctx.link.manifestValue = manifestOf(["game.step", "game.bookmark", "game.restore"]);
  createFrameLayer(ctx);
  const { iframe } = ctx.state.frame;
  if (iframe === undefined) throw new Error("no iframe");
  return iframe;
}

beforeEach(() => {
  vi.useFakeTimers();
  ctx = createCtx();
  ctx.link.run.mockResolvedValue(resultOf({ checkpoint: "home" }));
});

afterEach(() => {
  stopWorkspace(ctx);
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("scenarioNames", () => {
  it("tests, specs, declarations, index.ts and folders are not scenarios", () => {
    const entries = [
      entry("full.ts"),
      entry("full.test.ts"),
      entry("full.spec.ts"),
      entry("types.d.ts"),
      entry("index.ts"),
      entry("deep.ts", "dir"),
      entry("notes.md")
    ];
    expect(scenarioNames(entries)).toEqual(["full"]);
  });

  it("names are stems, sorted", () => {
    expect(scenarioNames([entry("rich.ts"), entry("empty.ts"), entry("full.ts")])).toEqual([
      "empty",
      "full",
      "rich"
    ]);
  });
});

describe("refreshScenarios", () => {
  it("lists tests/scenarios and keeps the names", async () => {
    vi.mocked(ctx.link.files.list).mockResolvedValue(FOLDER);

    await expect(refreshScenarios(ctx)).resolves.toEqual({
      scenarios: ["empty", "full"],
      chosen: undefined
    });
    expect(ctx.link.files.list).toHaveBeenCalledWith("tests/scenarios");
    expect(createWorkspaceApi(ctx).scenarios()).toEqual({
      scenarios: ["empty", "full"],
      chosen: undefined
    });
  });

  it("a missing folder gives no scenarios and no toast", async () => {
    await listed();
    vi.mocked(ctx.link.files.list).mockRejectedValue(new Error("[moku-editor] not found"));

    await expect(refreshScenarios(ctx)).resolves.toEqual({ scenarios: [], chosen: undefined });
    expect(toasts()).toEqual([]);
    expect(ctx.log.debug).toHaveBeenCalledWith("workspace:scenarios-failed", {
      message: "[moku-editor] not found"
    });
  });

  it("concurrent refreshes list once", async () => {
    vi.mocked(ctx.link.files.list).mockResolvedValue(FOLDER);
    const first = refreshScenarios(ctx);
    const second = refreshScenarios(ctx);

    expect(second).toBe(first);
    await first;
    expect(ctx.link.files.list).toHaveBeenCalledTimes(1);
  });

  it("a listing that settles after stop changes nothing", async () => {
    let answer: ((entries: readonly FileEntry[]) => void) | undefined;
    vi.mocked(ctx.link.files.list).mockReturnValue(
      new Promise(resolve => {
        answer = resolve;
      })
    );
    const listener = vi.fn();
    createWorkspaceApi(ctx).onScenario(listener);
    const listing = refreshScenarios(ctx);

    stopWorkspace(ctx);
    answer?.(FOLDER);
    await listing;

    expect(ctx.state.scenario.list).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("onScenario", () => {
  it("listeners run on a list change and on a choice; the same list again runs none", async () => {
    const views: ScenarioView[] = [];
    const off = createWorkspaceApi(ctx).onScenario(view => views.push(view));

    await listed();
    await listed();
    await setScenario(ctx, "full");

    expect(views).toEqual([
      { scenarios: ["empty", "full"], chosen: undefined },
      { scenarios: ["empty", "full"], chosen: "full" }
    ]);
    off();
    await setScenario(ctx, undefined);
    expect(views).toHaveLength(2);
  });

  it("a throwing listener is logged and the next one still runs", async () => {
    const api = createWorkspaceApi(ctx);
    const after = vi.fn();
    api.onScenario(() => {
      throw new Error("boom");
    });
    api.onScenario(after);

    await listed();

    expect(ctx.log.error).toHaveBeenCalledWith(
      "workspace:scenario-listener-failed",
      {},
      expect.any(Error)
    );
    expect(after).toHaveBeenCalledTimes(1);
  });
});

describe("setScenario", () => {
  it("setScenario of an unknown name rejects with the two-line TypeError", async () => {
    await listed();

    const failing = setScenario(ctx, "rich");
    await expect(failing).rejects.toThrow(TypeError);
    await expect(failing).rejects.toThrow(
      '[moku-editor] Unknown scenario "rich".\n  Pick one of workspace.scenarios().'
    );
    expect(ctx.state.scenario.chosen).toBeUndefined();
  });

  it("reloads without restore and the frame src carries player=full", async () => {
    await listed();
    const iframe = mounted();

    const started = setScenario(ctx, "full");
    expect(new URL(iframe.src).searchParams.get("player")).toBe("full");
    expect(ctx.link.expectReload).toHaveBeenCalledTimes(1);
    ctx.link.attach(manifestOf());
    await expect(started).resolves.toEqual({ restored: false });

    expect(ctx.link.run).not.toHaveBeenCalledWith("game.bookmark");
    expect(ctx.link.run).not.toHaveBeenCalledWith("game.restore", expect.anything());
  });

  it("the toast names the scenario and the reload's own toast is not shown", async () => {
    await listed();
    mounted();

    const started = setScenario(ctx, "full");
    ctx.link.attach(manifestOf());
    await started;

    expect(toasts()).toEqual(["Game started from scenario full"]);
  });

  it("setScenario(undefined) drops player from the src and toasts the saved player", async () => {
    await listed();
    const iframe = mounted();
    const full = setScenario(ctx, "full");
    ctx.link.attach(manifestOf());
    await full;

    const saved = setScenario(ctx, undefined);
    expect(new URL(iframe.src).searchParams.has("player")).toBe(false);
    ctx.link.attach(manifestOf());
    await saved;

    expect(toasts()).toContain("Game started from the saved player");
  });

  it("a start with no game in time toasts the timeout and resolves timeout", async () => {
    await listed();
    mounted();

    const started = setScenario(ctx, "full");
    await vi.advanceTimersByTimeAsync(ctx.config.reloadTimeoutMs);

    await expect(started).resolves.toEqual({ restored: false, reason: "timeout" });
    expect(toasts()).toEqual(["Game reloaded · no game connected after 15 s"]);
  });

  it("before mount it resolves not_mounted and the first mount loads the scenario", async () => {
    await listed();

    await expect(setScenario(ctx, "full")).resolves.toEqual({
      restored: false,
      reason: "not_mounted"
    });
    const iframe = mounted();

    expect(new URL(iframe.src).searchParams.get("player")).toBe("full");
  });

  it("the D-07 reload with restore keeps player in the src", async () => {
    await listed();
    await setScenario(ctx, "full");
    const iframe = mounted();
    iframe.src = "about:blank";

    const reload = reloadFrame(ctx, { restore: true });
    await flush();
    expect(new URL(iframe.src).searchParams.get("player")).toBe("full");
    ctx.link.attach(manifestOf(["game.restore"]));
    await reload;
  });

  it("nothing is persisted: preferences saved after a choice carry no scenario", async () => {
    await listed();
    await setScenario(ctx, "full");

    createWorkspaceApi(ctx).setTheme("dark");

    const stored = localStorage.getItem(ctx.config.storageKey) ?? "";
    expect(stored).toContain("dark");
    expect(stored).not.toContain("full");
  });
});
