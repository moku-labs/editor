import { describe, expect, it } from "vitest";
import { cardOffText, overlayOf, overlayText } from "../../derive/states";

// ─────────────────────────────────────────────────────────────────────────────
// derive/states.ts (spec 09 § M9 States, § M19): the overlay a graph shows
// instead of data, by priority.
// ─────────────────────────────────────────────────────────────────────────────

const LIVE = { started: true, second: true, monitored: true, feeds: true, sectionOn: true };

describe("overlayOf", () => {
  it("not started, waiting, no monitor, an older agent and section off pick their overlay in that priority", () => {
    // Bug: "Frames are off" over a page where nothing runs.
    expect(
      overlayOf({ started: false, second: false, monitored: false, feeds: false, sectionOn: false })
    ).toBe("not-started");
    expect(overlayOf({ ...LIVE, second: false, sectionOn: false })).toBe("waiting");
    expect(overlayOf({ ...LIVE, second: false, monitored: false, feeds: false })).toBe(
      "no-monitor"
    );
    expect(overlayOf({ ...LIVE, feeds: false, sectionOn: false })).toBe("older-agent");
    expect(overlayOf({ ...LIVE, sectionOn: false })).toBe("section-off");
    expect(overlayOf(LIVE)).toBeUndefined();
  });

  it("says each state in words; waiting names the source and the link", () => {
    // Bug: a waiting phone shown as an empty graph.
    const context = {
      name: "Galaxy A26",
      link: "9 ms by wire",
      offText: "The game has no renderer."
    };
    expect(overlayText("waiting", context)).toEqual({
      title: "Waiting for the first frames from Galaxy A26",
      body: "The link is up (9 ms by wire). Frames arrive once the game draws its first scene."
    });
    expect(overlayText("no-monitor", context)?.body).toBe("The game has no renderer.");
    expect(overlayText("older-agent", context)?.title).toBe("This game's editor agent is older");
    expect(overlayText("not-started", context)?.title).toBe("Nothing is running yet");
    expect(overlayText("section-off", context)?.title).toBe("Frames are off");
    expect(overlayText(undefined, context)).toBeUndefined();
    expect(cardOffText("memory")).toBe("Memory & GC is off");
  });
});
