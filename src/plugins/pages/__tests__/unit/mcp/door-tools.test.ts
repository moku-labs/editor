import { createBrandConsole } from "@moku-labs/common/cli";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommandDescriptor, Json } from "../../../../registry/protocol";
import type { DoorTools } from "../../../mcp/door-tools";
import {
  COVERED_DOORS,
  createDoorTools,
  doorAnnotations,
  doorInputSchema,
  doorToolName,
  doorTools
} from "../../../mcp/door-tools";
import { runTool } from "../../../mcp/game-tools";
import { checkArguments, SESSION_PROPERTY } from "../../../mcp/schema";
import type { HubClient, SessionView } from "../../../mcp/types";
import { session } from "../../fake-hub";
import type { ToolSetup } from "../../mcp-tools";
import { textAt, toolSetup } from "../../mcp-tools";

// ─────────────────────────────────────────────────────────────────────────────
// pages/mcp door tools (D-35, D-36, D-37): one MCP tool per command door of
// the selected session. The pure parts (name, input schema, annotations, the
// tool list of a manifest), the door set that follows the sessions by their
// manifestHash with a 5 s grace, and a door tool call through the fake hub.
// ─────────────────────────────────────────────────────────────────────────────

/** A command door. */
function door(
  id: string,
  effect: CommandDescriptor["effect"] = "route",
  input: CommandDescriptor["input"] = {}
): CommandDescriptor {
  return { id, title: "Tap a target", input, effect };
}

/** The manifest of a game with the given commands, as the hub answers it. */
function manifestOf(commands: readonly CommandDescriptor[]): Json {
  return {
    game: "tiny-game 0.0.0",
    page: "http://127.0.0.1:3000/",
    embedded: true,
    sources: [{ id: "game.position", title: "Position", input: {}, changes: "commit" }],
    commands: commands.map(command => ({ ...command, input: { ...command.input } }))
  };
}

/** The commands of game A and game B. */
const TAP = door("game.tap", "route", { target: "string", x: "number?", y: "number?" });
const FILL = door("game.fill", "cheat", { board: "json" });

describe("doorToolName", () => {
  it("turns the id into the name, with the effect prefix for cheat and raw (D-36)", () => {
    expect(doorToolName(door("game.tap"))).toBe("game_tap");
    expect(doorToolName(door("game.bookmark", "read"))).toBe("game_bookmark");
    expect(doorToolName(door("game.pause", "cosmetic"))).toBe("game_pause");
    expect(doorToolName(door("game.fill", "cheat"))).toBe("cheat_game_fill");
    expect(doorToolName(door("game.restore", "raw"))).toBe("raw_game_restore");
    expect(doorToolName(door("timber.openShop"))).toBe("timber_openShop");
    expect(doorToolName(door("my-game.go"))).toBe("my-game_go");
  });

  it("gives no name to a reserved, a malformed or a long id", () => {
    expect(doorToolName(door("moku.x"))).toBeUndefined();
    expect(doorToolName(door("moku_status"))).toBeUndefined();
    expect(doorToolName(door("game.tap!"))).toBeUndefined();
    expect(doorToolName(door("game tap"))).toBeUndefined();
    expect(doorToolName(door(""))).toBeUndefined();
    expect(doorToolName(door(`${"a".repeat(35)}.bcde`))).toBe(`${"a".repeat(35)}_bcde`);
    expect(doorToolName(door(`${"a".repeat(36)}.bcde`))).toBeUndefined();
    expect(doorToolName(door("a".repeat(34), "cheat"))).toBe(`cheat_${"a".repeat(34)}`);
    expect(doorToolName(door("a".repeat(35), "cheat"))).toBeUndefined();
  });

  it("gives no name to the doors the generic tools cover", () => {
    expect(COVERED_DOORS).toEqual([
      "game.capture",
      "editor.capture",
      "editor.sheet",
      "editor.series",
      "editor.seriesStop",
      "editor.reload"
    ]);
    for (const id of COVERED_DOORS) expect(doorToolName(door(id, "read"))).toBeUndefined();
  });

  it("gives no game_capture door: screenshots go only through moku_screenshot", () => {
    const { tools, skipped } = doorTools({
      game: "g",
      commands: [door("game.capture", "read"), door("game.pause", "cosmetic")]
    });
    expect(tools.map(tool => tool.name)).toEqual(["game_pause"]);
    expect(skipped).toEqual([
      "game.capture: covered by moku_screenshot / moku_series / moku_reload"
    ]);
  });
});

describe("doorInputSchema", () => {
  it("maps the fields to typed properties, the required ones, and adds _session", () => {
    expect(doorInputSchema({ target: "string", x: "number?", payload: "json?" })).toEqual({
      type: "object",
      additionalProperties: false,
      required: ["target"],
      properties: {
        target: { type: "string", description: "string input of the door" },
        x: { type: "number", description: "number input of the door" },
        payload: { description: "any JSON input of the door" },
        _session: SESSION_PROPERTY
      }
    });
    expect(doorInputSchema({ on: "boolean", note: "string?" })?.properties).toEqual({
      on: { type: "boolean", description: "boolean input of the door" },
      note: { type: "string", description: "string input of the door" },
      _session: SESSION_PROPERTY
    });
  });

  it("leaves required out when every field is optional or there is none", () => {
    expect(doorInputSchema({})).toEqual({
      type: "object",
      additionalProperties: false,
      properties: { _session: SESSION_PROPERTY }
    });
    expect(doorInputSchema({ frames: "number?" })).not.toHaveProperty("required");
  });

  it("refuses a field named _session or one that cannot be an argument name", () => {
    expect(doorInputSchema({ _session: "string" })).toBeUndefined();
    expect(doorInputSchema({ "a.b": "string" })).toBeUndefined();
    expect(doorInputSchema({ "": "string" })).toBeUndefined();
    expect(doorInputSchema({ ["x".repeat(65)]: "number" })).toBeUndefined();
    expect(doorInputSchema({ ["x".repeat(64)]: "number" })).toBeDefined();
  });

  it("checks the arguments of a call: a missing field and a wrong kind are problems", () => {
    const schema = doorInputSchema(TAP.input);
    if (schema === undefined) throw new Error("no schema");
    expect(checkArguments(schema, { target: "play", x: 0.5, _session: "s-2" })).toEqual({
      target: "play",
      x: 0.5,
      _session: "s-2"
    });
    expect(checkArguments(schema, {})).toBe("target is required");
    expect(checkArguments(schema, { target: 1 })).toBe("target must be a string");
    expect(checkArguments(schema, { target: "play", x: "1" })).toBe("x must be a number");
    expect(checkArguments(schema, { target: "play", z: 1 })).toBe(
      "z is not an argument of this tool"
    );
  });
});

describe("doorAnnotations", () => {
  it("reads the hints from the effect", () => {
    expect(doorAnnotations("read")).toEqual({ readOnlyHint: true, openWorldHint: false });
    const harmless = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
    expect(doorAnnotations("route")).toEqual(harmless);
    expect(doorAnnotations("cosmetic")).toEqual(harmless);
    const destructive = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };
    expect(doorAnnotations("cheat")).toEqual(destructive);
    expect(doorAnnotations("raw")).toEqual(destructive);
  });
});

describe("doorTools", () => {
  it("builds one tool per door in manifest order, with title, description and schema", () => {
    const { tools, skipped } = doorTools({ game: "tiny-game 0.0.0", commands: [TAP, FILL] });
    expect(skipped).toEqual([]);
    expect(tools.map(tool => tool.name)).toEqual(["game_tap", "cheat_game_fill"]);
    const [tap] = tools;
    expect(tap?.title).toBe("Tap a target");
    expect(tap?.description).toBe(
      '[route] Tap a target. Command door game.tap of tiny-game 0.0.0. Same as moku_run { id: "game.tap" }.'
    );
    expect(tap?.inputSchema).toEqual(doorInputSchema(TAP.input));
    expect(tap?.annotations).toEqual(doorAnnotations("route"));
    expect(tools[1]?.description).toMatch(/^\[cheat] /);
  });

  it("drops a period that ends the title, so the description reads once", () => {
    const step = { ...door("game.step", "cosmetic"), title: "Step frames." };
    const [tool] = doorTools({ game: "g", commands: [step] }).tools;
    expect(tool?.description).toBe(
      '[cosmetic] Step frames. Command door game.step of g. Same as moku_run { id: "game.step" }.'
    );
  });

  it("skips every door without a tool, with the reason, and drops both doors of one name", () => {
    const { tools, skipped } = doorTools({
      game: "g",
      commands: [
        door("editor.capture", "read"),
        door("moku.x"),
        door("game.tap!"),
        door("a".repeat(41)),
        door("game.odd", "route", { _session: "string" }),
        door("a.b"),
        door("a_b", "route"),
        door("game.pause", "cosmetic")
      ]
    });
    expect(tools.map(tool => tool.name)).toEqual(["game_pause"]);
    expect(skipped).toEqual([
      "editor.capture: covered by moku_screenshot / moku_series / moku_reload",
      "moku.x: the name moku_x starts with moku_, which the generic tools keep",
      'game.tap!: the id has characters outside A-Z, a-z, 0-9, ".", "_" and "-"',
      `${"a".repeat(41)}: the name ${"a".repeat(41)} is longer than 40 characters`,
      "game.odd: the input field _session cannot be a tool argument",
      "a.b: another door has the same name a_b",
      "a_b: another door has the same name a_b"
    ]);
  });
});

describe("a door tool call", () => {
  let setup: ToolSetup | undefined;

  afterEach(async () => {
    await setup?.cleanup();
    setup = undefined;
  });

  /** The answer of `game.run`. */
  const RAN = { value: { tapped: "play" }, state: { path: "home", frame: 3, tainted: false } };

  it("sends run { id, input } without _session, routes _session, and formats like moku_run", async () => {
    setup = await toolSetup({ sessions: [session("s-1"), session("s-2", { embedded: false })] });
    setup.hub.handle("game.run", () => RAN);
    setup.hub.handle("game.manifest", () => manifestOf([TAP]));
    const [tap] = doorTools({ game: "g", commands: [TAP] }).tools;
    if (tap === undefined) throw new Error("no door tool");

    const door = await setup.run(tap, { target: "play", x: 0.5, _session: "s-2" });
    expect(setup.hub.requests.at(-1)).toEqual({
      channel: "game",
      method: "run",
      params: { id: "game.tap", input: { target: "play", x: 0.5 } },
      session: "s-2"
    });
    const generic = await setup.run(runTool, {
      id: "game.tap",
      input: { target: "play", x: 0.5 },
      session: "s-2"
    });
    expect(textAt(door.result)).toBe(textAt(generic.result));
    expect(textAt(door.result)).toMatch(/^effect: route\n/);
  });

  it("leaves input out when the call has no field, and the session to the hub without _session", async () => {
    setup = await toolSetup({ sessions: [session("s-1")] });
    setup.hub.handle("game.run", () => RAN);
    const [pause] = doorTools({ game: "g", commands: [door("game.pause", "cosmetic")] }).tools;
    if (pause === undefined) throw new Error("no door tool");

    const { result } = await setup.run(pause, {});
    expect(setup.hub.requests.at(-1)).toEqual({
      channel: "game",
      method: "run",
      params: { id: "game.pause" },
      session: undefined
    });
    expect(textAt(result)).toMatch(/^effect: cosmetic\n/);
  });

  it("answers a hub failure as an isError result", async () => {
    setup = await toolSetup({ sessions: [session("s-1")] });
    setup.hub.handle("game.run", () => {
      throw new Error("[moku-editor] target play is not on screen");
    });
    const [tap] = doorTools({ game: "g", commands: [TAP] }).tools;
    if (tap === undefined) throw new Error("no door tool");

    const { result } = await setup.run(tap, { target: "play" });
    expect(result.isError).toBe(true);
    expect(textAt(result)).toContain("target play is not on screen");
  });
});

/** The discovery record of the fake clients. */
const BIN = {
  version: 1,
  pid: 1,
  port: 3000,
  url: "http://127.0.0.1:3000",
  ws: "ws://127.0.0.1:3000/__editor/ws",
  token: "t",
  root: "/r",
  html: "/r/index.html",
  startedAt: 1
} as const;

/**
 * A hub client the test drives: it pushes session lists and sets the manifest each session answers.
 *
 * @param first - The sessions when the client connects.
 */
function fakeClient(first: SessionView[]) {
  const listeners = new Set<(list: readonly SessionView[]) => void>();
  const answers = new Map<string, () => Promise<Json>>();
  let list = first;
  const request = vi.fn<HubClient["request"]>((channel, method, _params, asked) => {
    const answer = method === "manifest" ? answers.get(asked ?? "") : undefined;
    return answer === undefined
      ? Promise.reject(new Error(`[moku-editor] no answer for ${channel}.${method}`))
      : answer();
  });
  const client: HubClient = {
    bin: BIN,
    request,
    watch: () => Promise.resolve(() => undefined),
    sessions: () => list,
    hotReload: () => undefined,
    onSessions: listener => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    isOpen: () => true,
    close: () => undefined
  };
  return {
    client,
    request,
    listeners,
    /** Sets what `manifest` answers for a session: a manifest, an error or a promise. */
    answer: (id: string, manifest: Json | Error | Promise<Json>) => {
      answers.set(id, () =>
        manifest instanceof Error ? Promise.reject(manifest) : Promise.resolve(manifest)
      );
    },
    /** Sends a `sessions` list to every listener. */
    push: (next: SessionView[]) => {
      list = next;
      for (const listener of listeners) listener(next);
    },
    /** How many manifests were asked for. */
    fetches: () => request.mock.calls.filter(call => call[1] === "manifest").length
  };
}

/** Lets the pending promise callbacks run (real setImmediate, also under fake timeouts). */
async function flush(): Promise<void> {
  for (let round = 0; round < 5; round++) {
    await new Promise<void>(resolve => {
      setImmediate(resolve);
    });
  }
}

/** A session view with a manifest hash. */
function live(id: string, manifestHash?: string, embedded = true): SessionView {
  return session(id, manifestHash === undefined ? { embedded } : { embedded, manifestHash });
}

/** True once the promise settled. */
function settled(promise: Promise<void>): () => boolean {
  let done = false;
  promise
    .then(() => {
      done = true;
    })
    .catch(() => undefined);
  return () => done;
}

describe("createDoorTools", () => {
  let doors: DoorTools | undefined;

  afterEach(() => {
    doors?.dispose();
    doors = undefined;
    vi.useRealTimers();
  });

  /** The door set under test, with its change counter and the warnings. */
  function doorSet() {
    const warnings: string[] = [];
    const ui = createBrandConsole({
      write: () => undefined,
      writeError: line => warnings.push(line),
      color: false
    });
    const onChange = vi.fn();
    doors = createDoorTools({ ui, onChange });
    return { doors, onChange, warnings };
  }

  it("builds the door tools of the selected session, calls onChange once and settles ready", async () => {
    const { doors, onChange } = doorSet();
    const hub = fakeClient([live("s-1", "h1")]);
    hub.answer("s-1", manifestOf([TAP]));

    doors.follow(hub.client);
    await doors.ready;
    expect(doors.tools().map(tool => tool.name)).toEqual(["game_tap"]);
    expect(doors.retired()).toEqual(new Set());
    expect(onChange).toHaveBeenCalledOnce();
    expect(hub.request).toHaveBeenCalledWith("game", "manifest", {}, "s-1");
  });

  it("changes nothing on a sessions push with the same hash", async () => {
    const { doors, onChange } = doorSet();
    const hub = fakeClient([live("s-1", "h1")]);
    hub.answer("s-1", manifestOf([TAP]));
    doors.follow(hub.client);
    await doors.ready;

    hub.push([
      session("s-1", { manifestHash: "h1", heartbeat: { frame: 9, paused: true, silent: false } })
    ]);
    await flush();
    expect(onChange).toHaveBeenCalledOnce();
    expect(hub.fetches()).toBe(1);
  });

  it("rebuilds on a new hash: one onChange, the new tools, the old names retired", async () => {
    const { doors, onChange } = doorSet();
    const hub = fakeClient([live("s-1", "h1")]);
    hub.answer("s-1", manifestOf([TAP]));
    hub.answer("s-2", manifestOf([FILL]));
    doors.follow(hub.client);
    await doors.ready;

    hub.push([live("s-2", "h2")]);
    await flush();
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(doors.tools().map(tool => tool.name)).toEqual(["cheat_game_fill"]);
    expect(doors.retired()).toEqual(new Set(["game_tap"]));

    hub.answer("s-3", manifestOf([TAP]));
    hub.push([live("s-3", "h1")]);
    await flush();
    expect(doors.tools().map(tool => tool.name)).toEqual(["game_tap"]);
    expect(doors.retired()).toEqual(new Set(["cheat_game_fill"]));
  });

  it("keeps the doors when the session comes back with the same hash within 5 s", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { doors, onChange } = doorSet();
    const hub = fakeClient([live("s-1", "h1")]);
    hub.answer("s-1", manifestOf([TAP]));
    doors.follow(hub.client);
    await doors.ready;

    hub.push([]);
    await vi.advanceTimersByTimeAsync(4999);
    hub.push([live("s-2", "h1")]);
    await vi.advanceTimersByTimeAsync(10_000);
    await flush();
    expect(onChange).toHaveBeenCalledOnce();
    expect(hub.fetches()).toBe(1);
    expect(doors.tools().map(tool => tool.name)).toEqual(["game_tap"]);
  });

  it("empties the doors after 5 s without a session: one onChange, the names retired", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { doors, onChange } = doorSet();
    const hub = fakeClient([live("s-1", "h1")]);
    hub.answer("s-1", manifestOf([TAP]));
    doors.follow(hub.client);
    await doors.ready;

    hub.push([]);
    await vi.advanceTimersByTimeAsync(4999);
    expect(onChange).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(doors.tools()).toEqual([]);
    expect(doors.retired()).toEqual(new Set(["game_tap"]));

    hub.answer("s-2", manifestOf([TAP]));
    hub.push([live("s-2", "h1")]);
    await flush();
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(doors.tools().map(tool => tool.name)).toEqual(["game_tap"]);
    expect(doors.retired()).toEqual(new Set());
  });

  it("settles ready when the grace fires with no session, without onChange", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { doors, onChange } = doorSet();
    const isReady = settled(doors.ready);
    doors.follow(fakeClient([]).client);

    await vi.advanceTimersByTimeAsync(4999);
    expect(isReady()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(isReady()).toBe(true);
    expect(doors.tools()).toEqual([]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("gives no door tools for two sessions without one embedded (D-37)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { doors } = doorSet();
    const hub = fakeClient([live("s-1", "h1", false), live("s-2", "h2", false)]);
    hub.answer("s-1", manifestOf([TAP]));
    hub.answer("s-2", manifestOf([TAP]));
    const isReady = settled(doors.ready);
    doors.follow(hub.client);

    await vi.advanceTimersByTimeAsync(5000);
    expect(isReady()).toBe(true);
    expect(hub.fetches()).toBe(0);
    expect(doors.tools()).toEqual([]);
  });

  it("follows the embedded session when there are several", async () => {
    const { doors } = doorSet();
    const hub = fakeClient([live("s-1", "h1", false), live("s-2", "h2", true)]);
    hub.answer("s-2", manifestOf([FILL]));
    doors.follow(hub.client);
    await doors.ready;
    expect(doors.tools().map(tool => tool.name)).toEqual(["cheat_game_fill"]);
  });

  it("settles ready with no tools on noEditor()", async () => {
    const { doors, onChange } = doorSet();
    doors.noEditor();
    await doors.ready;
    expect(doors.tools()).toEqual([]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("listens to the newest client only after a second follow", async () => {
    const { doors, onChange } = doorSet();
    const first = fakeClient([live("s-1", "h1")]);
    first.answer("s-1", manifestOf([TAP]));
    doors.follow(first.client);
    await doors.ready;

    const second = fakeClient([live("s-1", "h1")]);
    doors.follow(second.client);
    expect(first.listeners.size).toBe(0);
    expect(second.listeners.size).toBe(1);

    first.answer("s-9", manifestOf([FILL]));
    first.push([live("s-9", "h9")]);
    await flush();
    expect(first.fetches()).toBe(1);

    second.answer("s-2", manifestOf([FILL]));
    second.push([live("s-2", "h2")]);
    await flush();
    expect(doors.tools().map(tool => tool.name)).toEqual(["cheat_game_fill"]);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("keeps the old doors when the manifest fetch fails; the next push retries", async () => {
    const { doors, onChange } = doorSet();
    const hub = fakeClient([live("s-1", "h1")]);
    hub.answer("s-1", manifestOf([TAP]));
    doors.follow(hub.client);
    await doors.ready;

    hub.answer("s-2", new Error("[moku-editor] game reloaded"));
    hub.push([live("s-2", "h2")]);
    await flush();
    expect(doors.tools().map(tool => tool.name)).toEqual(["game_tap"]);
    expect(onChange).toHaveBeenCalledOnce();

    hub.answer("s-2", manifestOf([FILL]));
    hub.push([live("s-2", "h2")]);
    await flush();
    expect(doors.tools().map(tool => tool.name)).toEqual(["cheat_game_fill"]);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("settles ready with no tools, without onChange, when the first manifest fetch fails", async () => {
    const { doors, onChange } = doorSet();
    const hub = fakeClient([live("s-1", "h1")]);
    hub.answer("s-1", new Error("[moku-editor] game reloaded"));
    const isReady = settled(doors.ready);

    doors.follow(hub.client);
    await flush();
    expect(isReady()).toBe(true);
    expect(doors.tools()).toEqual([]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("fetches again on a new client while the old client's fetch of the same hash is in flight", async () => {
    const { doors, onChange } = doorSet();
    const first = fakeClient([live("s-1", "h1")]);
    first.answer("s-1", new Promise<Json>(() => undefined));
    doors.follow(first.client);

    const second = fakeClient([live("s-1", "h1")]);
    second.answer("s-1", manifestOf([TAP]));
    doors.follow(second.client);
    await doors.ready;
    expect(second.fetches()).toBe(1);
    expect(doors.tools().map(tool => tool.name)).toEqual(["game_tap"]);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("keeps the old doors when the manifest answer is not a manifest", async () => {
    const { doors, onChange } = doorSet();
    const hub = fakeClient([live("s-1", "h1")]);
    hub.answer("s-1", manifestOf([TAP]));
    doors.follow(hub.client);
    await doors.ready;

    hub.answer("s-2", { game: 1 });
    hub.push([live("s-2", "h2")]);
    await flush();
    expect(doors.tools().map(tool => tool.name)).toEqual(["game_tap"]);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("fetches once per session from an old bin without manifestHash", async () => {
    const { doors, onChange } = doorSet();
    const hub = fakeClient([live("s-1")]);
    hub.answer("s-1", manifestOf([TAP]));
    doors.follow(hub.client);
    await doors.ready;

    hub.push([live("s-1")]);
    await flush();
    expect(hub.fetches()).toBe(1);

    hub.answer("s-2", manifestOf([FILL]));
    hub.push([live("s-2")]);
    await flush();
    expect(hub.fetches()).toBe(2);
    expect(doors.tools().map(tool => tool.name)).toEqual(["cheat_game_fill"]);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("fetches once while the same hash is in flight, and a newer session wins over it", async () => {
    const { doors, onChange } = doorSet();
    const hub = fakeClient([live("s-1", "h1")]);
    const slow = Promise.withResolvers<Json>();
    hub.answer("s-1", slow.promise);
    doors.follow(hub.client);
    hub.push([live("s-1", "h1")]);
    expect(hub.fetches()).toBe(1);

    hub.answer("s-2", manifestOf([FILL]));
    hub.push([live("s-2", "h2")]);
    await flush();
    slow.resolve(manifestOf([TAP]));
    await flush();
    expect(doors.tools().map(tool => tool.name)).toEqual(["cheat_game_fill"]);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("starts the grace on unfollow and keeps the doors when the same hash is followed again", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { doors, onChange } = doorSet();
    const first = fakeClient([live("s-1", "h1")]);
    first.answer("s-1", manifestOf([TAP]));
    doors.follow(first.client);
    await doors.ready;

    doors.unfollow();
    await vi.advanceTimersByTimeAsync(3000);
    doors.follow(fakeClient([live("s-1", "h1")]).client);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onChange).toHaveBeenCalledOnce();
    expect(doors.tools().map(tool => tool.name)).toEqual(["game_tap"]);
  });

  it("warns once per hash for each door without a tool", async () => {
    const { doors, warnings } = doorSet();
    const hub = fakeClient([live("s-1", "h1")]);
    const commands = [TAP, door("editor.capture", "read")];
    hub.answer("s-1", manifestOf(commands));
    hub.answer("s-2", manifestOf([TAP]));
    hub.answer("s-3", manifestOf(commands));
    doors.follow(hub.client);
    await doors.ready;
    hub.push([live("s-2", "h2")]);
    await flush();
    hub.push([live("s-3", "h1")]);
    await flush();

    const line =
      "[moku-editor] mcp: no tool for editor.capture: covered by moku_screenshot / moku_series / moku_reload; use moku_run";
    expect(warnings.filter(warning => warning.includes(line))).toHaveLength(1);
  });

  it("stops the timer and the subscription on dispose", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { doors, onChange } = doorSet();
    const hub = fakeClient([live("s-1", "h1")]);
    hub.answer("s-1", manifestOf([TAP]));
    doors.follow(hub.client);
    await doors.ready;
    hub.push([]);

    doors.dispose();
    expect(hub.listeners.size).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onChange).toHaveBeenCalledOnce();
    expect(doors.tools().map(tool => tool.name)).toEqual(["game_tap"]);
  });
});
