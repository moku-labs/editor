import { describe, expect, it } from "vitest";
import { readDevice } from "../../device";

describe("readDevice", () => {
  it("reads a portrait phone viewport", () => {
    expect(readDevice({ innerWidth: 393, innerHeight: 852 })).toEqual({
      w: 393,
      h: 852,
      orientation: "portrait"
    });
  });

  it("reads a landscape viewport", () => {
    expect(readDevice({ innerWidth: 852, innerHeight: 393 })).toEqual({
      w: 852,
      h: 393,
      orientation: "landscape"
    });
  });

  it("calls a square viewport portrait", () => {
    expect(readDevice({ innerWidth: 500, innerHeight: 500 }).orientation).toBe("portrait");
  });

  it("rounds fractional CSS pixels", () => {
    expect(readDevice({ innerWidth: 392.6, innerHeight: 851.4 })).toMatchObject({ w: 393, h: 851 });
  });

  it("answers zeros and portrait without a viewport", () => {
    expect(readDevice({})).toEqual({ w: 0, h: 0, orientation: "portrait" });
  });

  it("reads globalThis by default (headless: zeros)", () => {
    expect(readDevice()).toEqual({ w: 0, h: 0, orientation: "portrait" });
  });
});
