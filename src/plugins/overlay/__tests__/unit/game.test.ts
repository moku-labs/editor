// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BuildProfile, CommandDescriptor, RunResult } from "../../../registry/protocol";
import { refusalOf, wireError } from "../../../registry/protocol";
import { pressCommand } from "../../actions";
import { gameRows, gameView, overlayCommands, reasonText, tabsOf } from "../../model/game";
import { openOverlay, setTab } from "../../modes";
import { paintNow } from "../../paint/tick";
import {
  bracketMonitor,
  changes,
  command,
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

/** The read-only words of a refused row (spec 08 Delta 2026-10-16 O1). */
const READ_ONLY_WORDS = "needs a debug build of a newer engine, or without --debug=read";

/**
 * The design's Game tab commands as the registry describes them on a page of a profile: `allowed`
 * and `reason` from `refusalOf(profile, effect)` (spec 02 C1), as `describeCommand` sets them.
 *
 * @param profile - The page's build profile.
 * @returns The descriptors.
 */
function describedOn(profile: BuildProfile): CommandDescriptor[] {
  return GARDEN_COMMANDS.map(({ id, title, input, effect, overlay }) => {
    const reason = refusalOf(profile, effect);
    const marker = overlay === undefined ? {} : { overlay };
    return reason === undefined
      ? { id, title, input, effect, ...marker, allowed: true }
      : { id, title, input, effect, ...marker, allowed: false, reason };
  });
}

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

/** A toggle with three choices, as the manifest describes it. */
const MOOD: CommandDescriptor = {
  id: "garden.mood",
  title: "Mood",
  input: { on: "boolean", choice: "string" },
  effect: "cosmetic",
  overlay: "toggle",
  choices: ["calm", "storm", "dusk"],
  allowed: true
};

/**
 * A context over the Mood toggle.
 *
 * @param value - What its `value(app)` answers.
 * @param current - What its `choice(app)` answers; undefined for a failed read.
 * @param extra - Descriptor fields to replace.
 * @returns The context.
 */
function mood(
  value: boolean,
  current: string | undefined,
  extra: Partial<CommandDescriptor> = {}
): TestOctx {
  const octx = createOctx({}, [{ ...MOOD, ...extra }]);
  octx.registry.command = () => ({ value: () => value, choice: () => current });
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
        `story.skipDialogue, ${READ_ONLY_WORDS}`,
        true,
        undefined
      ]
    ]);
    expect(rows[2]?.title).toBe(READ_ONLY_WORDS);
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

  it("a read-only row tells the tester to use the deprecated =full flag (it names a newer engine or a build without --debug=read); dev-only keeps its words", () => {
    expect(reasonText("dev-only")).toBe("needs a dev or debug build");
    expect(reasonText("read-only")).toBe(READ_ONLY_WORDS);
  });

  it("cheats are greyed on the owner's debug build (registry profile full: every marked row is enabled, no READ-ONLY note)", () => {
    const octx = createOctx({}, describedOn("full"));
    octx.registry.buildInfo = { ...octx.registry.buildInfo, profile: "full" };
    const commands = overlayCommands(octx.registry);
    expect(gameRows(commands, new Set()).map(row => [row.id, row.state, row.disabled])).toEqual([
      ["garden.glow", "off", false],
      ["garden.fog", "off", false],
      ["story.skipDialogue", "run", false]
    ]);
    expect(gameView("A Memory Missing", commands, new Set(), undefined).readOnly).toBe(false);
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
      text: "Glow needs a debug build of a newer engine.",
      tone: "error"
    });
    expect(octx.log.warn).not.toHaveBeenCalled();
  });

  it("a dev-only refusal shows the read-only words (it names its own reason)", async () => {
    const octx = garden();
    octx.channel.answer = async () => {
      throw wireError(-32_009, "garden.glow: the page has no dev or debug flag", {
        reason: "dev_only"
      });
    };
    await pressCommand(octx, "garden.glow");
    expect(octx.state.toast).toMatchObject({
      text: "Glow needs a dev or debug build.",
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

describe("a toggle with choices in the model", () => {
  it("the row marks no choice, or the wrong one (the one choice(app) answers; none when it failed)", () => {
    const rows = gameRows(overlayCommands(mood(true, "storm").registry), new Set());
    expect(rows[0]?.choices).toEqual([
      { value: "calm", current: false },
      { value: "storm", current: true },
      { value: "dusk", current: false }
    ]);
    const failed = gameRows(overlayCommands(mood(true, undefined).registry), new Set());
    expect(failed[0]?.choices?.some(choice => choice.current)).toBe(false);
  });

  it("choice(app) is read four times a second while the Game tab hides (only with the values)", () => {
    const choice = vi.fn(() => "calm");
    const octx = mood(true, "calm");
    octx.registry.command = () => ({ choice });
    expect(overlayCommands(octx.registry, false)[0]).toMatchObject({ choices: MOOD.choices });
    expect(choice).not.toHaveBeenCalled();
    expect(overlayCommands(octx.registry)[0]?.choice).toBe("calm");
    expect(choice).toHaveBeenCalledOnce();
  });

  it("an older manifest's rows grow a choices key (no key on a plain toggle or a button)", () => {
    const plain = command("garden.sun", { overlay: "toggle", allowed: true });
    const button = command("garden.rain", { overlay: "button", allowed: true, choices: ["calm"] });
    const commands = overlayCommands(createOctx({}, [plain, button]).registry);
    for (const each of commands) {
      expect(each).not.toHaveProperty("choices");
      expect(each).not.toHaveProperty("choice");
    }
    for (const row of gameRows(commands, new Set())) expect(row).not.toHaveProperty("choices");
  });
});

describe("a press on a toggle with choices", () => {
  it("a tap flips the switch or loses the choice (it keeps the switch, sets the choice and names it)", async () => {
    for (const on of [true, false]) {
      const octx = mood(on, "calm");
      await pressCommand(octx, "garden.mood", "storm");
      expect(octx.channel.runs).toEqual([
        { id: "garden.mood", input: { on, choice: "storm" }, via: "overlay" }
      ]);
      expect(octx.recorder.calls).toEqual(["command:garden.mood:Mood storm"]);
      expect(octx.state.toast?.text).toBe("Mood storm.");
    }
  });

  it("the switch drops the choice (it flips and keeps the current one, in the words of today)", async () => {
    for (const [value, on, word] of [
      [true, false, "off"],
      [false, true, "on"]
    ] as const) {
      const octx = mood(value, "storm");
      await pressCommand(octx, "garden.mood");
      expect(octx.channel.runs).toEqual([
        { id: "garden.mood", input: { on, choice: "storm" }, via: "overlay" }
      ]);
      expect(octx.state.toast?.text).toBe(`Mood ${word}.`);
    }
  });

  it("a failed choice(app) leaves the switch dead on a tester's phone (it sends the first choice)", async () => {
    const octx = mood(true, undefined);
    await pressCommand(octx, "garden.mood");
    expect(octx.channel.runs).toEqual([
      { id: "garden.mood", input: { on: false, choice: "calm" }, via: "overlay" }
    ]);
  });

  it("a plain toggle sends an undefined choice, which checkInput refuses (exactly { on })", async () => {
    const octx = garden();
    await pressCommand(octx, "garden.glow");
    expect(octx.channel.runs).toStrictEqual([
      { id: "garden.glow", input: { on: true }, via: "overlay" }
    ]);
  });

  it("a refused build runs nothing on a tap", async () => {
    const octx = mood(true, "calm", { allowed: false, reason: "read-only" });
    await pressCommand(octx, "garden.mood", "storm");
    expect(octx.channel.runs).toEqual([]);
  });

  it("a tap while the switch is in flight starts no second run", async () => {
    const octx = mood(true, "calm");
    const answers: ((value: RunResult) => void)[] = [];
    octx.channel.answer = () => new Promise(resolve => answers.push(resolve));
    const first = pressCommand(octx, "garden.mood");
    await pressCommand(octx, "garden.mood", "storm");
    expect(octx.channel.runs).toHaveLength(1);
    answers[0]?.({ value: true, state: { path: "a", frame: 1, tainted: false } });
    await first;
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
