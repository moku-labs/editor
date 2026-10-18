// @vitest-environment happy-dom
/* eslint-disable unicorn/no-null -- null is the engine's and perf's "not measured" */
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseStored, readStored, writeStored } from "../../place/store";
import { STORE_KEY } from "../../types";
import { createOctx } from "../helpers";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("parseStored", () => {
  it("reads a valid record", () => {
    const record = {
      v: 1,
      mode: "pill",
      last: "pill",
      tab: "record",
      place: { dock: "left", y: 0.25 }
    };
    expect(parseStored(JSON.stringify(record))).toEqual(record);
  });

  it("a stored v: 2 or a y of 3 is applied (both are ignored)", () => {
    const base = {
      v: 1,
      mode: "card",
      last: "card",
      tab: "frames",
      place: { dock: "right", y: 1 }
    };
    expect(parseStored(JSON.stringify({ ...base, v: 2 }))).toBeUndefined();
    expect(
      parseStored(JSON.stringify({ ...base, place: { dock: "right", y: 3 } }))
    ).toBeUndefined();
    expect(parseStored(JSON.stringify({ ...base, mode: "open" }))).toBeUndefined();
    expect(parseStored(JSON.stringify({ ...base, last: "hidden" }))).toBeUndefined();
    expect(parseStored(JSON.stringify({ ...base, tab: "x" }))).toBeUndefined();
    expect(parseStored(JSON.stringify({ ...base, place: { dock: "top", y: 0 } }))).toBeUndefined();
    expect(parseStored("{not json")).toBeUndefined();
    expect(parseStored(null)).toBeUndefined();
    expect(parseStored("[]")).toBeUndefined();
  });
});

describe("readStored and writeStored", () => {
  it("writes mode, last, tab and place, and reads them back", () => {
    const octx = createOctx();
    Object.assign(octx.state, {
      mode: "pill",
      last: "pill",
      tab: "link",
      place: { dock: "left", y: 0.5 }
    });
    writeStored(octx);
    expect(JSON.parse(localStorage.getItem(STORE_KEY) ?? "")).toEqual({
      v: 1,
      mode: "pill",
      last: "pill",
      tab: "link",
      place: { dock: "left", y: 0.5 }
    });
    expect(readStored(createOctx())).toMatchObject({ mode: "pill", tab: "link" });
  });

  it("remember: false still writes (it reads and writes nothing)", () => {
    const octx = createOctx({ remember: false });
    writeStored(octx);
    expect(localStorage.getItem(STORE_KEY)).toBeNull();
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({
        v: 1,
        mode: "card",
        last: "card",
        tab: "frames",
        place: { dock: "right", y: 1 }
      })
    );
    expect(readStored(octx)).toBeUndefined();
  });

  it("a throwing localStorage stops start (it logs debug once and works from memory)", () => {
    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      }
    };
    vi.stubGlobal("localStorage", throwing);
    const octx = createOctx();
    expect(readStored(octx)).toBeUndefined();
    expect(() => {
      writeStored(octx);
    }).not.toThrow();
    expect(octx.log.debug).toHaveBeenCalledTimes(1);
    expect(octx.log.debug).toHaveBeenCalledWith("overlay:storage-failed", {
      message: "SecurityError"
    });
  });
});
