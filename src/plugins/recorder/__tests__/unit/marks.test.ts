import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recorder } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Marks: a user mark and the overlay's automatic mark of a command go through
// monitor.mark while recording; never a `command` event from here.
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 14, 15, 32, 10));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("mark", () => {
  it("while recording writes monitor.mark and adds the mark with its time in the log", () => {
    const t = recorder();
    t.api.start();
    vi.advanceTimersByTime(64_000);
    expect(t.api.mark("boss enters")).toBe(true);
    expect(t.monitor.marks).toEqual(["boss enters"]);
    expect(t.api.marks()).toEqual([{ atMs: 64_000, label: "boss enters", auto: false }]);
  });

  it("answers false and writes nothing while idle, without a monitor, or for an empty label", () => {
    const idle = recorder();
    expect(idle.api.mark("boss enters")).toBe(false);
    idle.api.start();
    expect(idle.api.mark("  ")).toBe(false);
    expect([idle.monitor.marks, idle.api.marks()]).toEqual([[], []]);
    const blind = recorder({ monitor: false });
    expect(blind.api.mark("boss enters")).toBe(false);
  });
});

describe("command", () => {
  it("while recording writes only the mark and an auto mark with the command (bug: a press logged twice)", () => {
    const t = recorder();
    t.api.start();
    vi.advanceTimersByTime(150_000);
    expect(t.api.command("garden.glow", { on: false }, "Glow off")).toBe(true);
    expect(t.monitor.marks).toEqual(["Glow off"]);
    expect(t.api.marks()).toEqual([
      {
        atMs: 150_000,
        label: "Glow off",
        auto: true,
        command: { id: "garden.glow", input: { on: false } }
      }
    ]);
    expect(t.monitor.events.map(event => event.name)).not.toContain("command");
  });

  it("answers false and writes nothing while idle or without a monitor", () => {
    const t = recorder();
    expect(t.api.command("garden.glow", { on: false }, "Glow off")).toBe(false);
    expect(recorder({ monitor: false }).api.command("garden.glow", { on: true }, "Glow on")).toBe(
      false
    );
    expect([t.monitor.marks, t.api.marks()]).toEqual([[], []]);
  });

  it("keeps the marks of the last log while idle and starts a new list with a new log", async () => {
    const t = recorder();
    t.api.start();
    t.api.mark("boss enters");
    await t.api.stop();
    expect(t.api.marks()).toHaveLength(1);
    t.api.start();
    expect(t.api.marks()).toEqual([]);
  });
});
