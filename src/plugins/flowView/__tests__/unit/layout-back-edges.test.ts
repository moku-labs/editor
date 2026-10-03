import { describe, expect, it } from "vitest";
import { classifyEdges, exitOf, targetNode } from "../../layout/back-edges";
import { flowOf } from "../helpers";

describe("classifyEdges (design §7.6)", () => {
  it("main: setLoading → splash stays drawn; the returns to home and board are back edges", () => {
    const classes = classifyEdges(flowOf("main"));
    expect(classes.get("setLoading:done")).toBe("short-loop");
    expect(classes.get("dailyGift:claim")).toBe("back");
    expect(classes.get("dailyGift:close")).toBe("back");
    expect(classes.get("settings:closed")).toBe("back");
    expect(classes.get("board:left")).toBe("back");
    expect(classes.get("afterOrder:done")).toBe("back");
    expect(classes.get("boot:ready")).toBe("forward");
    expect(classes.get("home:play")).toBe("forward");
    expect(classes.get("board:orderComplete")).toBe("forward");
  });

  it("settingsPopup: setVolume, setLocale and confirm → open are back edges (open has 4 outcomes)", () => {
    const classes = classifyEdges(flowOf("settingsPopup"));
    expect(classes.get("setVolume:done")).toBe("back");
    expect(classes.get("setLocale:done")).toBe("back");
    expect(classes.get("confirm:cancel")).toBe("back");
    expect(classes.get("enter:done")).toBe("forward");
    expect(classes.has("open:close")).toBe(false);
  });

  it("is deterministic by declared order", () => {
    expect([...classifyEdges(flowOf("board")).entries()]).toEqual([
      ...classifyEdges(flowOf("board")).entries()
    ]);
  });
});

describe("edge targets", () => {
  it("reads node, exit and mapped targets", () => {
    expect(targetNode("home")).toBe("home");
    expect(targetNode("map:home")).toBe("home");
    expect(targetNode("exit:left")).toBeUndefined();
    expect(exitOf("exit:left")).toBe("left");
    expect(exitOf("home")).toBeUndefined();
  });
});
