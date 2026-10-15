/* eslint-disable unicorn/no-null -- null is "no input", "no header" and "between frames" of the engine */
import { describe, expect, it } from "vitest";
import type { CommandVia } from "../../../registry/protocol";
import { createRecorderHooks } from "../../handlers";
import { recorder } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The hooks: every command run becomes one `command` event, the editor's window
// becomes `devtools` (never the game's `overlay`), whether or not a log runs.
// ─────────────────────────────────────────────────────────────────────────────

describe("registry:command", () => {
  it.each<CommandVia>([
    "overlay",
    "bridge",
    "local"
  ])("via %s becomes one monitor.event command with id, input, via and ok (bug: an MCP run missing from the log)", via => {
    const t = recorder();
    createRecorderHooks(t.ctx)["registry:command"]({
      id: "game.step",
      input: { frames: 1 },
      via,
      ok: true
    });
    expect(t.monitor.events).toEqual([
      { name: "command", detail: { id: "game.step", input: { frames: 1 }, via, ok: true } }
    ]);
  });
});

describe("overlay:changed", () => {
  it("becomes monitor.event devtools and never overlay (bug: the editor's card listed as a game overlay change)", () => {
    const t = recorder();
    createRecorderHooks(t.ctx)["overlay:changed"]({ mode: "card", tab: "frames" });
    expect(t.monitor.events).toEqual([
      { name: "devtools", detail: { mode: "card", tab: "frames" } }
    ]);
  });
});

describe("without a monitor", () => {
  it("calls nothing", () => {
    const t = recorder({ monitor: false });
    const hooks = createRecorderHooks(t.ctx);
    hooks["overlay:changed"]({ mode: "pill", tab: "game" });
    hooks["registry:command"]({ id: "game.step", input: null, via: "local", ok: false });
    expect(t.monitor.events).toEqual([]);
  });
});
