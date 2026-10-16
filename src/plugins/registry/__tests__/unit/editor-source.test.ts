/* eslint-disable unicorn/no-null -- null is the wire value for "no input" and JSON null */
import { beforeEach, describe, expect, it } from "vitest";
import { addEditorSource } from "../../catalogue";
import { guardSource } from "../../entries/editor-source";
import { currentManifest } from "../../manifest";
import type { Json } from "../../protocol";
import { wireError } from "../../protocol";
import type { SourceEntry } from "../../types";
import type { LogMock, TestCtx } from "../helpers";
import { createCtx, createLog, thrownBy } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Editor sources: the guarded copy add() stores (read, watch, wire values) and
// the probe the registry runs at each manifest build
// ─────────────────────────────────────────────────────────────────────────────

const ID = "editor.perf.second";

/** The owner of an editor source (perf, in the real agent): its value, listeners and probe. */
type Owner = {
  value: Json;
  /** What the next read does instead of answering, when set. */
  failure: unknown;
  /** What the probe answers, or throws when it is an Error. */
  probe: string | Error | undefined;
  reads: number;
  readonly listeners: Set<(value: Json) => void>;
  readonly entry: SourceEntry;
  /** One tick of the owner's timer: every listener gets the value. */
  tick(): void;
};

/**
 * Creates the owner of an editor source. Its descriptor claims `available: false`, which the
 * registry must not believe.
 *
 * @returns The owner.
 */
function createOwner(): Owner {
  const owner: Owner = {
    value: { fps: 60 },
    failure: undefined,
    probe: undefined,
    reads: 0,
    listeners: new Set(),
    entry: {
      descriptor: {
        id: ID,
        title: "Second",
        input: {},
        changes: "frame",
        available: false,
        reason: "stale"
      },
      read: () => {
        owner.reads += 1;
        if (owner.failure !== undefined) throw owner.failure;
        return owner.value;
      },
      watch: (_raw, fn) => {
        if (owner.failure !== undefined) throw owner.failure;
        owner.listeners.add(fn);
        return () => {
          owner.listeners.delete(fn);
        };
      },
      probe: () => {
        if (owner.probe instanceof Error) throw owner.probe;
        return owner.probe;
      }
    },
    tick: () => {
      for (const fn of owner.listeners) fn(owner.value);
    }
  };
  return owner;
}

let owner: Owner;
let log: LogMock;

beforeEach(() => {
  owner = createOwner();
  log = createLog();
});

describe("guardSource", () => {
  it("has a fresh frozen descriptor without the given available and reason", () => {
    const source = guardSource(owner.entry, log, new Map());

    expect(source.descriptor).toEqual({ id: ID, title: "Second", input: {}, changes: "frame" });
    expect(Object.isFrozen(source.descriptor)).toBe(true);
    expect(Object.isFrozen(source)).toBe(true);
    expect(source.probe).toBeUndefined();
  });

  it("reads through toWireValue (a NaN reaches the wire as null)", () => {
    owner.value = { fps: Number.NaN };

    expect(guardSource(owner.entry, log, new Map()).read(null)).toEqual({ fps: null });
  });

  it("maps a plain throw of read to -32000 with the id and logs registry:source-failed", () => {
    owner.failure = new Error("no monitor\n  the renderer is off");
    const error = thrownBy(() => guardSource(owner.entry, log, new Map()).read(null));

    expect(error).toMatchObject({
      code: -32_000,
      message: `[moku-editor] ${ID}: no monitor`,
      data: { reason: "command_failed", retryable: false, id: ID }
    });
    expect(log.warn).toHaveBeenCalledWith("registry:source-failed", {
      id: ID,
      message: "no monitor"
    });
  });

  it("passes a ProtocolError of read through unchanged", () => {
    owner.failure = wireError(-32_602, "window must be a number", {
      reason: "invalid_input",
      field: "window"
    });

    expect(thrownBy(() => guardSource(owner.entry, log, new Map()).read(null))).toBe(owner.failure);
  });

  it("maps a synchronous throw of watch like a read", () => {
    owner.failure = new TypeError("no ticks");

    expect(
      thrownBy(() => guardSource(owner.entry, log, new Map()).watch(null, () => undefined))
    ).toMatchObject({ code: -32_000, message: `[moku-editor] ${ID}: no ticks` });
  });

  it("delivers wire values, keeps a throwing listener away from the owner's timer, and warns once per streak", () => {
    const delivered: Json[] = [];
    let failing = true;
    const stop = guardSource(owner.entry, log, new Map()).watch(null, value => {
      if (failing) throw new Error("panel is gone");
      delivered.push(value);
    });

    expect(() => owner.tick()).not.toThrow();
    expect(() => owner.tick()).not.toThrow();
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith("registry:watch-failed", {
      id: ID,
      message: "panel is gone"
    });

    failing = false;
    owner.value = { fps: Number.POSITIVE_INFINITY };
    owner.tick();
    expect(delivered).toEqual([{ fps: null }]);

    failing = true;
    owner.tick();
    expect(log.warn).toHaveBeenCalledTimes(2);

    stop();
    expect(owner.listeners.size).toBe(0);
  });
});

describe("the probe of an editor source", () => {
  let ctx: TestCtx;

  beforeEach(() => {
    ctx = createCtx({ name: "tiny-game 0.0.0" });
    addEditorSource(ctx.state, owner.entry, ctx.log);
  });

  it("lists the source not available when the probe answers, and read and watch answer -32008 without the owner", () => {
    owner.probe = "the game has no renderer (headless)";

    const manifest = currentManifest(ctx.state, ctx.config);
    const source = ctx.state.sources.get(ID);
    const notInstalled = {
      code: -32_008,
      data: { reason: "not_installed", retryable: false, id: ID }
    };

    expect(manifest.sources).toEqual([
      {
        id: ID,
        title: "Second",
        input: {},
        changes: "frame",
        available: false,
        reason: "the game has no renderer (headless)"
      }
    ]);
    expect(thrownBy(() => source?.read(null))).toMatchObject(notInstalled);
    expect(thrownBy(() => source?.watch(null, () => undefined))).toMatchObject(notInstalled);
    expect(owner.reads).toBe(0);
    expect(owner.listeners.size).toBe(0);
  });

  it("logs registry:source-unavailable once while the source stays unavailable", () => {
    owner.probe = "headless";

    currentManifest(ctx.state, ctx.config);
    ctx.state.manifest = undefined;
    currentManifest(ctx.state, ctx.config);

    expect(ctx.log.info).toHaveBeenCalledTimes(1);
    expect(ctx.log.info).toHaveBeenCalledWith("registry:source-unavailable", {
      id: ID,
      reason: "headless"
    });
  });

  it("makes the source available again when the probe answers undefined at the next build", () => {
    owner.probe = "headless";
    currentManifest(ctx.state, ctx.config);
    owner.probe = undefined;
    ctx.state.manifest = undefined;

    const manifest = currentManifest(ctx.state, ctx.config);

    expect(manifest.sources[0]).toEqual({ id: ID, title: "Second", input: {}, changes: "frame" });
    expect(ctx.state.sources.get(ID)?.read(null)).toEqual({ fps: 60 });
  });

  it("counts a probe that throws as unavailable, with the first line of its message", () => {
    owner.probe = new Error("monitor missing\n  update the engine");

    expect(currentManifest(ctx.state, ctx.config).sources[0]).toMatchObject({
      available: false,
      reason: "monitor missing"
    });
  });
});
