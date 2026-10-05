import type { InputOf as GameInputOf } from "@moku-labs/game/inspect";
import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  DeviceSpec,
  EditorChannel,
  Heartbeat,
  InputOf,
  Json,
  LinkStatus,
  Manifest,
  RunResult,
  SessionInfo,
  SubId,
  Tap,
  ToolsBoot,
  WireError
} from "../../protocol";
import { ProtocolError, wireError } from "../../protocol";

// ─────────────────────────────────────────────────────────────────────────────
// Type-level checks of the protocol types (tsc runs them; each `it` also
// asserts at run time).
// ─────────────────────────────────────────────────────────────────────────────

type Step = { frames: "number"; deltaMs: "number?" };
type Walk = { route: "json" };
type Answer = { intent: "string"; payload: "json?" };
type Restore = { bookmark: "json?"; repro: "json?" };
type Flags = { on: "boolean"; label: "string?" };

describe("protocol types", () => {
  it("InputOf equals the game's InputOf for five schemas", () => {
    expectTypeOf<InputOf<Step>>().toEqualTypeOf<GameInputOf<Step>>();
    expectTypeOf<InputOf<Walk>>().toEqualTypeOf<GameInputOf<Walk>>();
    expectTypeOf<InputOf<Answer>>().toEqualTypeOf<GameInputOf<Answer>>();
    expectTypeOf<InputOf<Restore>>().toEqualTypeOf<GameInputOf<Restore>>();
    expectTypeOf<InputOf<Flags>>().toEqualTypeOf<GameInputOf<Flags>>();

    const step: InputOf<Step> = { frames: 1 };
    expect(step.frames).toBe(1);
  });

  it("InputOf<{ frames: number; deltaMs: number? }> has an optional deltaMs", () => {
    expectTypeOf<InputOf<Step>>().toEqualTypeOf<{ frames: number; deltaMs?: number | undefined }>();

    const step: InputOf<Step> = { frames: 2, deltaMs: undefined };
    expect(Object.keys(step)).toEqual(["frames", "deltaMs"]);
  });

  it("LinkStatus narrows by kind", () => {
    const status = { kind: "lost", reason: "closed", lastFrame: 9, retryInMs: 1000 } as LinkStatus;

    if (status.kind === "lost") {
      expectTypeOf(status.retryInMs).toEqualTypeOf<number>();
      expect(status.reason).toBe("closed");
    } else {
      throw new Error("expected lost");
    }
    expectTypeOf<Extract<LinkStatus, { kind: "live" }>>().toEqualTypeOf<{
      kind: "live";
      frame: number;
    }>();
  });

  it("EditorChannel has the four contract methods", () => {
    expectTypeOf<EditorChannel["read"]>().toEqualTypeOf<
      (id: string, input?: Json) => Promise<Json>
    >();
    expectTypeOf<EditorChannel["watch"]>().toEqualTypeOf<
      (id: string, input: Json | undefined, onValue: (value: Json) => void) => () => void
    >();
    expectTypeOf<EditorChannel["run"]>().toEqualTypeOf<
      (id: string, input?: Json) => Promise<RunResult>
    >();
    expectTypeOf<EditorChannel["status"]>().toEqualTypeOf<() => LinkStatus>();

    const keys: (keyof EditorChannel)[] = ["read", "watch", "run", "status"];
    expect(keys).toHaveLength(4);
  });

  it("ProtocolError is assignable to Error & WireError", () => {
    expectTypeOf<ProtocolError>().toExtend<Error & WireError>();
    expectTypeOf(wireError).returns.toEqualTypeOf<Error & WireError>();

    const error: Error & WireError = new ProtocolError(-32_000, "[moku-editor] x");
    expect(error.code).toBe(-32_000);
  });

  it("SessionInfo has the five R1 fields and an optional heartbeat readout", () => {
    expectTypeOf<keyof SessionInfo>().toEqualTypeOf<
      "id" | "game" | "page" | "embedded" | "connectedAt" | "heartbeat"
    >();
    expectTypeOf<SessionInfo["connectedAt"]>().toEqualTypeOf<number>();
    expectTypeOf<SessionInfo["heartbeat"]>().toEqualTypeOf<
      { readonly frame: number; readonly paused: boolean; readonly silent: boolean } | undefined
    >();

    const info: SessionInfo = { id: "s", game: "g", page: "", embedded: false, connectedAt: 1 };
    const beating: SessionInfo = {
      ...info,
      heartbeat: { frame: 1840, paused: false, silent: false }
    };
    expect(Object.keys(info)).toHaveLength(5);
    expect(Object.keys(beating)).toHaveLength(6);
  });

  it("SessionInfo with a heartbeat still travels as Json", () => {
    const info: SessionInfo = {
      id: "s-7f3a",
      game: "merge-game 0.0.0",
      page: "http://127.0.0.1:3000/",
      embedded: true,
      connectedAt: 1_790_000_000_000,
      heartbeat: { frame: 1840, paused: true, silent: false }
    };
    const json: Json = info;

    expectTypeOf<SessionInfo>().toExtend<Json>();
    expect(json).toEqual(info);
  });

  it("ToolsBoot['v'] is 1 and DeviceSpec['kind'] is the three-kind union", () => {
    expectTypeOf<ToolsBoot["v"]>().toEqualTypeOf<1>();
    expectTypeOf<DeviceSpec["kind"]>().toEqualTypeOf<"phone" | "tablet" | "desktop">();

    const kinds: DeviceSpec["kind"][] = ["phone", "tablet", "desktop"];
    expect(kinds).toHaveLength(3);
  });

  it("SubId is number", () => {
    expectTypeOf<SubId>().toEqualTypeOf<number>();

    const sub: SubId = 0;
    expect(Number.isSafeInteger(sub)).toBe(true);
  });

  it("Manifest is not assignable to Json (senders pass it through toWireValue)", () => {
    const manifest: Manifest = {
      game: "merge-game 0.0.0",
      page: "",
      embedded: false,
      sources: [],
      commands: []
    };
    // @ts-expect-error -- readonly arrays are not the mutable Json
    const json: Json = manifest;

    expect(json).toBe(manifest);
  });

  it("RunResult is assignable to Json", () => {
    const result: RunResult = {
      value: { frame: 1 },
      state: { path: "home", frame: 1, tainted: false }
    };
    const json: Json = result;

    expectTypeOf<RunResult>().toExtend<Json>();
    expect(json).toEqual(result);
  });

  it("Heartbeat carries an optional heap in MB and still travels as Json", () => {
    expectTypeOf<Heartbeat["heap"]>().toEqualTypeOf<
      { readonly usedMb: number; readonly limitMb: number } | undefined
    >();

    const beat: Heartbeat = {
      frame: 1840,
      paused: false,
      at: 1_790_000_000_000,
      heap: { usedMb: 12.8, limitMb: 4095.8 }
    };
    const json: Json = beat;
    expect(json).toEqual(beat);
  });

  it("Tap is the page point and the page clock, and travels as Json", () => {
    expectTypeOf<Tap>().toEqualTypeOf<{
      readonly x: number;
      readonly y: number;
      readonly at: number;
    }>();

    const tap: Tap = { x: 206, y: 640, at: 15_234.5 };
    const json: Json = tap;
    expect(json).toEqual({ x: 206, y: 640, at: 15_234.5 });
  });
});
