/* eslint-disable unicorn/no-null -- null is a JSON value on the wire */
import { describe, expect, it } from "vitest";
import { parseFoundList, parseProjectState, toWireValue } from "../../../registry/protocol";
import {
  expectShape,
  readFileBinary,
  readFileEntries,
  readFileText,
  readFoundList,
  readHelloBody,
  readManifest,
  readProjectState,
  readRunResult,
  readSessions,
  readToolsBoot,
  readWriteResult
} from "../../rpc/shapes";
import { BOOT, manifestOf, sessionOf } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Wire shapes read from Json without casts
// ─────────────────────────────────────────────────────────────────────────────

describe("readSessions", () => {
  it("keeps the five R1 fields and skips bad entries", () => {
    const list = readSessions({
      list: [
        { ...toObject(sessionOf("s-1")), heartbeat: 3 },
        { id: "bad" },
        toObject(sessionOf("s-2", { embedded: true }))
      ]
    });
    expect(list).toEqual([sessionOf("s-1"), sessionOf("s-2", { embedded: true })]);
  });

  it("keeps the hub heartbeat readout, frozen; a malformed readout is dropped and the session kept", () => {
    // Bug: activeSource cannot see that the person paused the local preview (spec 11 § 4 B4), so
    // it pauses and later resumes a game the developer paused on purpose.
    const heartbeat = { frame: 1840, paused: true, silent: false };
    const list = readSessions({
      list: [
        { ...toObject(sessionOf("s-1")), heartbeat },
        { ...toObject(sessionOf("s-2")), heartbeat: { frame: 1840, paused: "yes", silent: false } }
      ]
    });

    expect(list).toEqual([sessionOf("s-1", { heartbeat }), sessionOf("s-2")]);
    expect(Object.isFrozen(list?.[0]?.heartbeat)).toBe(true);
  });

  it("keeps the device of a device session and leaves a malformed device out", () => {
    const device = {
      id: "d-7f3a",
      model: "SM-A266B",
      link: "adb",
      address: "127.0.0.1",
      port: 47_600,
      engine: "0.14.12+9c41e0",
      build: null
    } as const;
    const list = readSessions({
      list: [
        { ...toObject(sessionOf("s-1")), device },
        { ...toObject(sessionOf("s-2")), device: { ...device, link: "usb" } },
        { ...toObject(sessionOf("s-3")), device: { ...device, port: "47600" } }
      ]
    });

    expect(list).toEqual([sessionOf("s-1", { device }), sessionOf("s-2"), sessionOf("s-3")]);
  });

  it("keeps the app id of a device, and drops only an app id that is not text", () => {
    // Bug: activeSource and the panels never seeing which app a phone runs.
    const device = {
      id: "d-7f3a",
      model: "SM-A266B",
      link: "adb",
      address: "127.0.0.1",
      port: 47_600,
      engine: "0.15.1+2b7c11",
      build: null
    } as const;
    const list = readSessions({
      list: [
        {
          ...toObject(sessionOf("s-1")),
          device: { ...device, appId: "com.mokulabs.timber.debug" }
        },
        { ...toObject(sessionOf("s-2")), device: { ...device, appId: 7 } }
      ]
    });

    expect(list).toEqual([
      sessionOf("s-1", { device: { ...device, appId: "com.mokulabs.timber.debug" } }),
      sessionOf("s-2", { device })
    ]);
  });

  it("is undefined without a list", () => {
    expect(readSessions({})).toBeUndefined();
    expect(readSessions(undefined)).toBeUndefined();
    expect(readSessions([1])).toBeUndefined();
  });
});

describe("readManifest", () => {
  it("reads a manifest", () => {
    const manifest = { ...manifestOf(), panels: [{ id: "p", module: "./p.js" }] };
    expect(readManifest(toWireValue(manifest))).toEqual(manifest);
  });

  it("keeps available: false and the reason of a source the game does not have", () => {
    const good = toObject(manifestOf());
    const effects = {
      id: "game.effects",
      title: "Effects",
      input: {},
      changes: "frame",
      available: false,
      reason: "app.effects is undefined"
    };

    expect(readManifest({ ...good, sources: [effects] })?.sources).toEqual([effects]);
  });

  it("drops an available flag that is not false and a reason without it", () => {
    const good = toObject(manifestOf());
    const read = readManifest({
      ...good,
      sources: [
        { id: "a.one", title: "A", input: {}, changes: "frame", available: true },
        { id: "a.two", title: "B", input: {}, changes: "frame", reason: "x" }
      ]
    });

    expect(read?.sources).toEqual([
      { id: "a.one", title: "A", input: {}, changes: "frame" },
      { id: "a.two", title: "B", input: {}, changes: "frame" }
    ]);
  });

  it("keeps a well-formed restored entry and drops a malformed one (R6)", () => {
    const good = toObject(manifestOf());
    const restored = { bookmark: '{"path":"home"}', frame: 1840 };

    expect(readManifest({ ...good, restored })?.restored).toEqual(restored);
    expect(readManifest({ ...good, restored: { bookmark: 1, frame: 1 } })).not.toHaveProperty(
      "restored"
    );
    expect(readManifest({ ...good, restored: "yes" })).not.toHaveProperty("restored");
    expect(readManifest(good)).not.toHaveProperty("restored");
  });

  it("keeps the overlay marker and the build verdict of a command, and the page's build", () => {
    const good = toObject(manifestOf());
    const glow = {
      id: "garden.glow",
      title: "Glow",
      input: { on: "boolean" },
      effect: "cosmetic",
      overlay: "toggle",
      allowed: true
    };
    const tap = {
      id: "game.tap",
      title: "Tap",
      input: { target: "string" },
      effect: "route",
      overlay: "button",
      allowed: false,
      reason: "read-only"
    };
    const build = { profile: "read", id: "debug-20261014T160000Z", engine: "0.14.12+9c41e0" };

    const read = readManifest({ ...good, commands: [glow, tap], build });

    expect(read?.commands).toEqual([glow, tap]);
    expect(read?.build).toEqual(build);
    expect(readManifest({ ...good, build: { profile: "none" } })?.build).toEqual({
      profile: "none"
    });
  });

  it("reads an older agent's manifest without the new fields as before", () => {
    const read = readManifest(toObject(manifestOf()));

    expect(read).not.toHaveProperty("build");
    expect(read?.commands[0]).toEqual({
      id: "game.step",
      title: "Step",
      input: { frames: "number" },
      effect: "raw"
    });
  });

  it("drops a malformed marker, verdict or build and keeps the rest of the manifest", () => {
    const good = toObject(manifestOf());
    const base = { id: "game.tap", title: "Tap", input: {}, effect: "route" };

    const read = readManifest({
      ...good,
      commands: [
        { ...base, overlay: "slider", allowed: "yes", reason: "read-only" },
        { ...base, id: "game.drag", allowed: true, reason: "read-only" },
        { ...base, id: "game.key", allowed: false, reason: "sudo" }
      ],
      build: { profile: "release", id: "debug-1" }
    });

    expect(read?.commands).toEqual([
      base,
      { ...base, id: "game.drag", allowed: true },
      { ...base, id: "game.key", allowed: false }
    ]);
    expect(read).not.toHaveProperty("build");
    expect(
      readManifest({ ...good, build: { profile: "dev", id: 7, engine: null } })?.build
    ).toEqual({ profile: "dev" });
    expect(readManifest({ ...good, build: "dev" })).not.toHaveProperty("build");
  });

  it("rejects bad descriptors", () => {
    const good = toObject(manifestOf());
    expect(readManifest({ ...good, game: 3 })).toBeUndefined();
    expect(
      readManifest({ ...good, sources: [{ id: "a", title: "A", input: {}, changes: "always" }] })
    ).toBeUndefined();
    expect(
      readManifest({
        ...good,
        sources: [{ id: "a", title: "A", input: { n: "int" }, changes: "frame" }]
      })
    ).toBeUndefined();
    expect(
      readManifest({ ...good, commands: [{ id: "a", title: "A", input: {}, effect: "sudo" }] })
    ).toBeUndefined();
    expect(readManifest({ ...good, commands: "none" })).toBeUndefined();
    expect(readManifest({ ...good, panels: [{ id: 1 }] })).toBeUndefined();
    expect(readManifest(null)).toBeUndefined();
  });
});

describe("readRunResult", () => {
  it("needs value and a full state", () => {
    const result = { value: null, state: { path: "home", frame: 1841, tainted: true } };
    expect(readRunResult(result)).toEqual(result);
    expect(readRunResult({ state: result.state })).toBeUndefined();
    expect(readRunResult({ value: 1, state: { path: "home", frame: "1" } })).toBeUndefined();
  });
});

describe("files shapes", () => {
  it("reads file entries with an optional version", () => {
    const entries = [
      { path: "src", kind: "dir", size: 0 },
      { path: "src/a.ts", kind: "file", size: 12, version: "abc" }
    ];
    expect(readFileEntries(entries)).toEqual(entries);
    expect(readFileEntries([{ path: "x", kind: "link", size: 0 }])).toBeUndefined();
    expect(readFileEntries({})).toBeUndefined();
  });

  it("reads text, binary and write results", () => {
    expect(readFileText({ text: "hi", version: "v1" })).toEqual({ text: "hi", version: "v1" });
    expect(readFileText({ text: 1, version: "v1" })).toBeUndefined();
    expect(readFileBinary({ dataUrl: "data:image/png;base64,AA==", version: "v" })).toEqual({
      dataUrl: "data:image/png;base64,AA==",
      version: "v"
    });
    expect(readFileBinary({ dataUrl: "x" })).toBeUndefined();
    expect(readWriteResult({ path: "a", bytes: 3, version: "v" })).toEqual({
      path: "a",
      bytes: 3,
      version: "v"
    });
    expect(readWriteResult({ path: "a", bytes: "3", version: "v" })).toBeUndefined();
  });
});

describe("boot shapes", () => {
  it("reads a ToolsBoot and drops extra keys", () => {
    expect(readToolsBoot({ ...toObject(BOOT), extra: true })).toEqual(BOOT);
  });

  it("rejects another version, empty ws or token, or a missing field", () => {
    const good = toObject(BOOT);
    expect(readToolsBoot({ ...good, v: 2 })).toBeUndefined();
    expect(readToolsBoot({ ...good, ws: "" })).toBeUndefined();
    expect(readToolsBoot({ ...good, token: "" })).toBeUndefined();
    const withoutGameUrl = Object.fromEntries(
      Object.entries(good).filter(([key]) => key !== "gameUrl")
    );
    expect(readToolsBoot(withoutGameUrl)).toBeUndefined();
    expect(readToolsBoot("boot")).toBeUndefined();
  });

  it("reads a hello body", () => {
    expect(readHelloBody({ ws: "ws://h/ws", token: "t" })).toEqual({ ws: "ws://h/ws", token: "t" });
    expect(readHelloBody({ ws: "ws://h/ws", token: "" })).toBeUndefined();
  });
});

describe("expectShape", () => {
  it("returns the shape or throws -32600 naming the method", () => {
    expect(expectShape({ text: "a", version: "v" }, readFileText, "read")).toEqual({
      text: "a",
      version: "v"
    });
    expect(() => expectShape({}, readFileText, "read")).toThrow(
      expect.objectContaining({
        code: -32_600,
        message: "[moku-editor] read answered an unexpected shape."
      })
    );
  });
});

/**
 * A readonly protocol object as a plain Json object.
 *
 * @param value - The object.
 * @returns Its Json copy.
 */
function toObject(value: object): { [key: string]: import("../../../registry/protocol").Json } {
  const json = toWireValue(value);
  if (typeof json !== "object" || json === null || Array.isArray(json))
    throw new Error("not an object");
  return json;
}

describe("project index shapes", () => {
  it("are the protocol parsers, not a second parser", () => {
    expect(readProjectState).toBe(parseProjectState);
    expect(readFoundList).toBe(parseFoundList);
    expect(readProjectState({ state: "off", reason: "disabled" })).toEqual({
      state: "off",
      reason: "disabled"
    });
  });
});
