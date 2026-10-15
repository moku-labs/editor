// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunResult } from "../../../registry/protocol";
import { wireError } from "../../../registry/protocol";
import { pressCommand } from "../../actions";
import { gameRows, gameView, overlayCommands, reasonText, tabsOf } from "../../model/game";
import { openOverlay, setTab } from "../../modes";
import { paintNow } from "../../paint/tick";
import {
  bracketMonitor,
  changes,
  createOctx,
  GARDEN_COMMANDS,
  RECORDING,
  started,
  stopped,
  type TestOctx
} from "../helpers";

afterEach(() => {
  Reflect.deleteProperty(globalThis, "__MOKU_GAME_OVERLAY__");
  vi.restoreAllMocks();
});

/**
 * A context over the design's Game tab commands; Glow off, Fog on.
 *
 * @returns The context.
 */
function garden(): TestOctx {
  const octx = createOctx({}, GARDEN_COMMANDS);
  octx.registry.values.set("garden.glow", false);
  octx.registry.values.set("garden.fog", true);
  return octx;
}

describe("the Game tab model", () => {
  it("lists only the overlay commands; greys a refused one with its reason", () => {
    const rows = gameRows(overlayCommands(garden().registry), new Set());
    expect(
      rows.map(row => [row.id, row.state, row.legend, row.line, row.disabled, row.pressed])
    ).toEqual([
      ["garden.glow", "off", "OFF", "garden.glow, cosmetic toggle", false, false],
      ["garden.fog", "on", "ON", "garden.fog, cosmetic toggle", false, true],
      [
        "story.skipDialogue",
        "refused",
        "RUN",
        "story.skipDialogue, needs a --debug=full build",
        true,
        undefined
      ]
    ]);
    expect(rows[2]?.title).toBe("needs a --debug=full build");
  });

  it("marks a command in flight busy", () => {
    const rows = gameRows(overlayCommands(garden().registry), new Set(["garden.glow"]));
    expect(rows[0]).toMatchObject({ state: "busy", disabled: true });
  });

  it("names the game and shows the READ-ONLY note only with a read-only refusal", () => {
    const octx = garden();
    expect(
      gameView("A Memory Missing", overlayCommands(octx.registry), new Set(), undefined)
    ).toMatchObject({
      by: "Added by A Memory Missing",
      readOnly: true
    });
    const devOnly = overlayCommands(
      createOctx({}, [{ ...GARDEN_COMMANDS[2], reason: "dev-only" } as never]).registry
    );
    expect(gameView("x", devOnly, new Set(), undefined).readOnly).toBe(false);
  });

  it("reasonText: dev-only reads needs a --debug=full build (it reads needs a dev or debug build)", () => {
    expect(reasonText("dev-only")).toBe("needs a dev or debug build");
    expect(reasonText("read-only")).toBe("needs a --debug=full build");
  });

  it("the Game tab shows with no overlay commands (it does not)", () => {
    expect(tabsOf(false)).toEqual(["frames", "record", "link"]);
    expect(tabsOf(true)).toEqual(["frames", "game", "record", "link"]);
  });
});

describe("a press", () => {
  it("a disallowed command can be pressed (it runs nothing)", async () => {
    const octx = garden();
    await pressCommand(octx, "story.skipDialogue");
    await pressCommand(octx, "garden.reset");
    expect(octx.channel.runs).toEqual([]);
  });

  it("a toggle runs with its current value instead of the opposite; without via overlay", async () => {
    const octx = garden();
    await pressCommand(octx, "garden.glow");
    await pressCommand(octx, "garden.fog");
    expect(octx.channel.runs).toEqual([
      { id: "garden.glow", input: { on: true }, via: "overlay" },
      { id: "garden.fog", input: { on: false }, via: "overlay" }
    ]);
  });

  it("a button runs with no input", async () => {
    const octx = createOctx({}, [{ ...GARDEN_COMMANDS[2], allowed: true } as never]);
    await pressCommand(octx, "story.skipDialogue");
    expect(octx.channel.runs).toEqual([{ id: "story.skipDialogue", input: {}, via: "overlay" }]);
    expect(octx.recorder.calls).toEqual(["command:story.skipDialogue:Skip dialogue"]);
    expect(octx.state.toast).toMatchObject({ text: "Skip dialogue.", tone: "info" });
  });

  it("a press is logged twice (the overlay adds only the recorder's mark, never a monitor event)", async () => {
    const octx = garden();
    const monitor = bracketMonitor();
    octx.perf.monitorValue = monitor;
    octx.recorder.statusValue = RECORDING;
    await pressCommand(octx, "garden.glow");
    expect(octx.recorder.calls).toEqual(["command:garden.glow:Glow on"]);
    expect(monitor.calls.filter(call => call.startsWith("event:"))).toEqual([]);
    expect(octx.state.toast).toMatchObject({
      text: "Glow on. Logged as a mark at 03:12.",
      tone: "info"
    });
  });

  it("the toggle's mark names the old value (it names the new one)", async () => {
    const octx = garden();
    await pressCommand(octx, "garden.fog");
    expect(octx.recorder.calls).toEqual(["command:garden.fog:Fog off"]);
    expect(octx.state.toast?.text).toBe("Fog off.");
  });

  it("a -32009 refusal shows the raw error (it toasts the reason, no warn)", async () => {
    const octx = garden();
    octx.channel.answer = async () => {
      throw wireError(-32_009, "garden.glow: the build refuses it", { reason: "read_only" });
    };
    await pressCommand(octx, "garden.glow");
    expect(octx.state.toast).toMatchObject({
      text: "Glow needs a --debug=full build.",
      tone: "error"
    });
    expect(octx.log.warn).not.toHaveBeenCalled();
  });

  it("a failed press is logged with recorder.command (it is not; it warns)", async () => {
    const octx = garden();
    octx.channel.answer = async () => {
      throw new Error("[moku-editor] boom");
    };
    await pressCommand(octx, "garden.glow");
    expect(octx.recorder.calls).toEqual([]);
    expect(octx.state.toast).toMatchObject({ text: "Glow failed: boom", tone: "error" });
    expect(octx.log.warn).toHaveBeenCalledWith("overlay:command-failed", {
      id: "garden.glow",
      code: -32_000,
      message: "[moku-editor] boom"
    });
  });

  it("is busy until it settles and ignores a second press", async () => {
    const octx = garden();
    const answers: ((value: RunResult) => void)[] = [];
    octx.channel.answer = () => new Promise(resolve => answers.push(resolve));
    const first = pressCommand(octx, "garden.glow");
    expect(octx.state.busy.has("garden.glow")).toBe(true);
    await pressCommand(octx, "garden.glow");
    expect(octx.channel.runs).toHaveLength(1);
    answers[0]?.({ value: true, state: { path: "a", frame: 1, tainted: false } });
    await first;
    expect(octx.state.busy.size).toBe(0);
  });
});

describe("the Game tab while it shows", () => {
  it("commands vanish and the Game tab stays selected (it falls back to Frames)", () => {
    const octx = started(garden());
    openOverlay(octx, { tab: "game" });
    expect(octx.state.tab).toBe("game");
    octx.registry.commands = [];
    paintNow(octx);
    expect(octx.state.tab).toBe("frames");
    expect(changes(octx).at(-1)).toEqual({ mode: "card", tab: "frames" });
    setTab(octx, "game");
    expect(octx.state.tab).toBe("frames");
    stopped(octx);
  });
});
