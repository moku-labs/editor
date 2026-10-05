/**
 * @file pages/mcp — the door tools (D-35, D-36, D-37): one MCP tool per command door of the
 * selected session, with a typed input schema built from the door's `InputSchema`. Cheat and raw
 * doors carry their effect as a name prefix, so one permission rule denies them. The door set
 * follows the hub's `sessions` by their `manifestHash`: it is rebuilt, and `onChange` sends
 * `tools/list_changed`, only when the hash of the selected session moves. A 5 s grace keeps the set
 * while no session is chosen, so a hot reload does not blink the list.
 */
import type { BrandConsole } from "@moku-labs/common/cli";
import type { CommandDescriptor, Effect, InputKind, InputSchema } from "../../registry/protocol";
import { runDoor } from "./game-tools";
import { READ_ONLY, SESSION_PROPERTY } from "./schema";
import { chooseSession } from "./sessions";
import type { DoorManifest } from "./shapes";
import { readDoorManifest } from "./shapes";
import type {
  HubClient,
  PropertySchema,
  SessionView,
  Tool,
  ToolAnnotations,
  ToolCall,
  ToolContext,
  ToolInputSchema,
  ToolResult
} from "./types";

/**
 * The doors the generic tools cover. Their answers are data URLs (text a result does not cap), or
 * the run ends with the `game_reloaded` that only moku_reload tolerates (editor-tools.ts:105-110).
 * `game.capture` is the engine's raw picture door: screenshots go only through moku_screenshot,
 * which answers a JPEG image by default, capped at about 300 KB.
 */
export const COVERED_DOORS: readonly string[] = [
  "game.capture",
  "editor.capture",
  "editor.sheet",
  "editor.series",
  "editor.seriesStop",
  "editor.reload"
];

/**
 * Why a covered door gets no tool.
 */
const COVERED_REASON = "covered by moku_screenshot / moku_series / moku_reload";

/**
 * Why a door with an odd id gets no tool.
 */
const BAD_ID_REASON = 'the id has characters outside A-Z, a-z, 0-9, ".", "_" and "-"';

/**
 * A door id that can become a tool name: letters, digits, `.`, `_` and `-`.
 */
const DOOR_ID = /^[\w.-]+$/;

/**
 * An input field that can become a tool argument name.
 */
const FIELD_NAME = /^[\w-]{1,64}$/;

/**
 * The prefix of the generic tools: a door tool name never starts with it.
 */
const RESERVED_PREFIX = "moku_";

/**
 * The longest door tool name, so `mcp__moku-editor__<name>` stays within the 64 characters of the
 * Anthropic API.
 */
const MAX_NAME_LENGTH = 40;

/**
 * The argument every door tool adds: the session to run the door in.
 */
const SESSION_ARGUMENT = "_session";

/**
 * How long the door set stays while no session is chosen.
 */
const GRACE_MS = 5000;

/**
 * The name prefix of each effect (D-36): only cheat and raw doors carry one.
 */
const EFFECT_PREFIX: Readonly<Record<Effect, string>> = {
  read: "",
  route: "",
  cosmetic: "",
  cheat: "cheat_",
  raw: "raw_"
};

/**
 * The annotations of a door that changes the game within its rules.
 */
const HARMLESS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false
};

/**
 * The annotations of a door that changes the game outside its rules.
 */
const DESTRUCTIVE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: false
};

/**
 * The annotations of each effect (hints only: Claude Code ignores them for permissions).
 */
const EFFECT_ANNOTATIONS: Readonly<Record<Effect, ToolAnnotations>> = {
  read: READ_ONLY,
  route: HARMLESS,
  cosmetic: HARMLESS,
  cheat: DESTRUCTIVE,
  raw: DESTRUCTIVE
};

/**
 * The property of each field kind, required or optional.
 */
const FIELD_PROPERTY: Readonly<Record<InputKind | `${InputKind}?`, PropertySchema>> = {
  string: { type: "string", description: "string input of the door" },
  "string?": { type: "string", description: "string input of the door" },
  number: { type: "number", description: "number input of the door" },
  "number?": { type: "number", description: "number input of the door" },
  boolean: { type: "boolean", description: "boolean input of the door" },
  "boolean?": { type: "boolean", description: "boolean input of the door" },
  json: { description: "any JSON input of the door" },
  "json?": { description: "any JSON input of the door" }
};

/**
 * What the door set needs: the stderr console, the grace and the one source of `list_changed`.
 */
export type DoorToolsOptions = {
  /** Warns once per hash about each door that gets no tool. */
  readonly ui: Pick<BrandConsole, "warn">;
  /** How long the set stays while no session is chosen (default 5000 ms). */
  readonly graceMs?: number;
  /** Called on every change of the door set: the bridge sends `tools/list_changed`. */
  readonly onChange: () => void;
};

/**
 * The door tools of the selected session, kept in step with the hub's sessions.
 *
 * @example
 * ```ts
 * // bridge.ts: the server lists the generic tools, then the doors.
 * const doors = createDoorTools({ ui, onChange: () => server.toolsChanged() });
 * const server = createMcpServer({ send, tools: () => [...TOOLS, ...doors.tools()], ready: () => doors.ready, retired: () => doors.retired(), context, version });
 * ```
 */
export type DoorTools = {
  /** Current door tools, in manifest order. */
  tools(): readonly Tool[];
  /** Names that were door tools before a change and are not now. */
  retired(): ReadonlySet<string>;
  /** Settles once: tools built, or the grace fired with no session, or `noEditor()` was called. */
  readonly ready: Promise<void>;
  /** A hub client is open: subscribe to its sessions and decide at once. */
  connected(client: HubClient): void;
  /** The client closed or the bin stopped: start the grace. */
  disconnected(): void;
  /** No bin will come (start settled with no client): settle `ready`. */
  noEditor(): void;
  /** Stops the timer and the subscription. */
  dispose(): void;
};

/**
 * The mutable state of the door set.
 */
type DoorState = {
  /** The `manifestHash` of the session the doors come from (`session <id>` from an old bin). */
  hash: string | undefined;
  /** The door tools now. */
  tools: readonly Tool[];
  /** Names that were door tools and are not now. */
  readonly retired: Set<string>;
  /** Runs while no session is chosen. */
  graceTimer: ReturnType<typeof setTimeout> | undefined;
  /** The hash the last decision asked for; a manifest for another one is dropped when it lands. */
  wanted: string | undefined;
  /** The hash whose manifest is being fetched. */
  fetching: string | undefined;
  /** Removes the sessions listener of the client now. */
  unsubscribe: (() => void) | undefined;
  /** The hashes whose doors without a tool were logged. */
  readonly warned: Set<string>;
};

/**
 * The domain context of the door set.
 */
type DoorCtx = {
  readonly options: DoorToolsOptions;
  readonly state: DoorState;
  /** Settles `ready` (again is a no-op). */
  readonly settle: () => void;
};

/**
 * One door with its tool name and input schema, or the reason it gets no tool.
 */
type Candidate =
  | {
      readonly command: CommandDescriptor;
      readonly name: string;
      readonly inputSchema: ToolInputSchema;
    }
  | { readonly command: CommandDescriptor; readonly reason: string };

/**
 * The tool name a door's id and effect spell, before any rule.
 *
 * @param command - The command door.
 * @returns The effect prefix, then the id with `.` as `_`.
 * @example
 * ```ts
 * spelledName({ id: "game.fill", title: "Fill", input: {}, effect: "cheat" }); // "cheat_game_fill"
 * ```
 */
function spelledName(command: CommandDescriptor): string {
  return `${EFFECT_PREFIX[command.effect]}${command.id.replaceAll(".", "_")}`;
}

/**
 * Why a door's id and effect give no tool name: covered by a generic tool, an odd id, the reserved
 * `moku_` prefix (on the final name) or a name longer than 40 characters.
 *
 * @param command - The command door.
 * @returns The reason, or undefined when the name is fine.
 * @example
 * ```ts
 * nameProblem({ id: "moku.x", title: "X", input: {}, effect: "route" });
 * // "the name moku_x starts with moku_, which the generic tools keep"
 * ```
 */
function nameProblem(command: CommandDescriptor): string | undefined {
  if (COVERED_DOORS.includes(command.id)) return COVERED_REASON;
  if (!DOOR_ID.test(command.id)) return BAD_ID_REASON;

  const name = spelledName(command);
  if (name.startsWith(RESERVED_PREFIX)) {
    return `the name ${name} starts with ${RESERVED_PREFIX}, which the generic tools keep`;
  }
  return name.length > MAX_NAME_LENGTH
    ? `the name ${name} is longer than ${String(MAX_NAME_LENGTH)} characters`
    : undefined;
}

/**
 * The first input field that cannot be a tool argument: `_session`, or a name outside
 * `[A-Za-z0-9_-]{1,64}`.
 *
 * @param input - The door's input schema.
 * @returns The field, or undefined when every field fits.
 * @example
 * ```ts
 * badField({ target: "string", "a.b": "number" }); // "a.b"
 * ```
 */
function badField(input: InputSchema): string | undefined {
  return Object.keys(input).find(field => field === SESSION_ARGUMENT || !FIELD_NAME.test(field));
}

/**
 * The tool name of a command door, or undefined when its id and effect give no tool: covered by a
 * generic tool, an id outside `[A-Za-z0-9._-]`, a name starting with `moku_`, or longer than 40.
 *
 * @param command - The command door from the manifest.
 * @returns The name: the id with `.` as `_`, `cheat_` or `raw_` first for those effects.
 * @example
 * ```ts
 * doorToolName({ id: "game.tap", title: "Tap", input: { target: "string" }, effect: "route" }); // "game_tap"
 * doorToolName({ id: "game.restore", title: "Restore", input: { bookmark: "string" }, effect: "raw" }); // "raw_game_restore"
 * doorToolName({ id: "editor.capture", title: "Capture", input: {}, effect: "read" }); // undefined: moku_screenshot
 * ```
 */
export function doorToolName(command: CommandDescriptor): string | undefined {
  return nameProblem(command) === undefined ? spelledName(command) : undefined;
}

/**
 * The input schema of a door tool: one typed property per door field (a `json` field takes any
 * JSON), the fields without `?` required, and the optional `_session`.
 *
 * @param input - The door's input schema.
 * @returns The tool's input schema, or undefined when a field cannot be an argument (`_session`,
 *   or a name outside `[A-Za-z0-9_-]{1,64}`).
 * @example
 * ```ts
 * doorInputSchema({ target: "string", x: "number?" });
 * // { type: "object", additionalProperties: false, required: ["target"],
 * //   properties: { target: { type: "string", … }, x: { type: "number", … }, _session: SESSION_PROPERTY } }
 * doorInputSchema({ _session: "string" }); // undefined
 * ```
 */
export function doorInputSchema(input: InputSchema): ToolInputSchema | undefined {
  if (badField(input) !== undefined) return undefined;

  const properties: Record<string, PropertySchema> = {};
  const required: string[] = [];
  for (const [field, kind] of Object.entries(input)) {
    properties[field] = FIELD_PROPERTY[kind];
    if (!kind.endsWith("?")) required.push(field);
  }
  properties[SESSION_ARGUMENT] = SESSION_PROPERTY;
  return required.length === 0
    ? { type: "object", properties, additionalProperties: false }
    : { type: "object", properties, required, additionalProperties: false };
}

/**
 * The annotations of a door tool, from the door's effect.
 *
 * @param effect - The door's effect.
 * @returns read-only for `read`; not destructive for `route` and `cosmetic`; destructive for
 *   `cheat` and `raw`. Never open-world.
 * @example
 * ```ts
 * doorAnnotations("cheat"); // { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
 * ```
 */
export function doorAnnotations(effect: Effect): ToolAnnotations {
  return EFFECT_ANNOTATIONS[effect];
}

/**
 * The tool name and schema of one door, or the reason it gets none.
 *
 * @param command - The command door.
 * @returns The candidate.
 * @example
 * ```ts
 * candidateOf({ id: "game.odd", title: "Odd", input: { _session: "string" }, effect: "route" });
 * // { command, reason: "the input field _session cannot be a tool argument" }
 * ```
 */
function candidateOf(command: CommandDescriptor): Candidate {
  const problem = nameProblem(command);
  if (problem !== undefined) return { command, reason: problem };

  const inputSchema = doorInputSchema(command.input);
  if (inputSchema !== undefined) return { command, name: spelledName(command), inputSchema };
  return {
    command,
    reason: `the input field ${badField(command.input) ?? ""} cannot be a tool argument`
  };
}

/**
 * Runs one door tool call: `_session` picks the session, every other argument is the door's input
 * (left out when there is none).
 *
 * @param command - The door.
 * @param call - The checked arguments.
 * @param context - The tool context.
 * @returns `effect: <effect>` and the envelope, like moku_run.
 */
async function callDoor(
  command: CommandDescriptor,
  call: ToolCall,
  context: ToolContext
): Promise<ToolResult> {
  const hub = await context.editor.hub();
  const { [SESSION_ARGUMENT]: session, ...fields } = call.args;
  const input = Object.keys(fields).length === 0 ? undefined : fields;
  const asked = typeof session === "string" ? session : undefined;
  return runDoor(hub, command.id, command.effect, input, asked);
}

/**
 * The tool of one door.
 *
 * @param command - The door.
 * @param name - Its tool name.
 * @param inputSchema - Its tool input schema.
 * @param game - The game name, for the description.
 * @returns The tool.
 * @example
 * ```ts
 * doorTool(tap, "game_tap", doorInputSchema(tap.input), "tiny-game 0.0.0").description;
 * // '[route] Tap a target. Command door game.tap of tiny-game 0.0.0. Same as moku_run { id: "game.tap" }.'
 * ```
 */
function doorTool(
  command: CommandDescriptor,
  name: string,
  inputSchema: ToolInputSchema,
  game: string
): Tool {
  const { id, title, effect } = command;
  const sentence = title.endsWith(".") ? title.slice(0, -1) : title;
  return {
    name,
    title,
    description: `[${effect}] ${sentence}. Command door ${id} of ${game}. Same as moku_run { id: "${id}" }.`,
    inputSchema,
    annotations: doorAnnotations(effect),
    run: (call, context) => callDoor(command, call, context)
  };
}

/**
 * All door tools of a manifest, in manifest order, and the doors that get none with the reason.
 * Two doors whose names collide (`a.b` and `a_b`) both get none.
 *
 * @param manifest - The game name and the command doors.
 * @returns The tools and the `"<id>: <reason>"` lines of the skipped doors.
 * @example
 * ```ts
 * const { tools, skipped } = doorTools(readDoorManifest(await hub.request("game", "manifest", {}, "s-1")));
 * tools.map(tool => tool.name); // ["game_tap", "game_step", "cheat_game_fill", "raw_game_restore", …]
 * skipped; // ["editor.capture: covered by moku_screenshot / moku_series / moku_reload", …]
 * ```
 */
export function doorTools(manifest: DoorManifest): {
  readonly tools: readonly Tool[];
  readonly skipped: readonly string[];
} {
  const candidates = manifest.commands.map(command => candidateOf(command));
  const uses = new Map<string, number>();
  for (const candidate of candidates) {
    if ("name" in candidate) uses.set(candidate.name, (uses.get(candidate.name) ?? 0) + 1);
  }

  const tools: Tool[] = [];
  const skipped: string[] = [];
  for (const candidate of candidates) {
    const { id } = candidate.command;
    if (!("name" in candidate)) {
      skipped.push(`${id}: ${candidate.reason}`);
    } else if ((uses.get(candidate.name) ?? 0) > 1) {
      skipped.push(`${id}: another door has the same name ${candidate.name}`);
    } else {
      tools.push(doorTool(candidate.command, candidate.name, candidate.inputSchema, manifest.game));
    }
  }
  return { tools, skipped };
}

/**
 * The hash a session's doors go by: the hub's `manifestHash`, or the session id from an old bin
 * without one (its manifest is fetched once per session).
 *
 * @param session - The selected session.
 * @returns The hash.
 * @example
 * ```ts
 * hashOf({ id: "s-1", game: "g", page: "p", embedded: true, connectedAt: 1 }); // "session s-1"
 * ```
 */
function hashOf(session: SessionView): string {
  return session.manifestHash ?? `session ${session.id}`;
}

/**
 * Stops the grace timer, if it runs.
 *
 * @param state - The door state.
 */
function stopGrace(state: DoorState): void {
  clearTimeout(state.graceTimer);
  state.graceTimer = undefined;
}

/**
 * Takes a new door set: names that go are retired, names that come back are not, the skipped doors
 * are logged once per hash, then `onChange` and `ready`.
 *
 * @param ctx - The door set.
 * @param hash - The hash the set comes from.
 * @param built - The tools and the skipped doors.
 * @param built.tools - The door tools.
 * @param built.skipped - The `"<id>: <reason>"` lines.
 */
function take(
  ctx: DoorCtx,
  hash: string | undefined,
  built: { readonly tools: readonly Tool[]; readonly skipped: readonly string[] }
): void {
  const { state, options } = ctx;
  const names = new Set(built.tools.map(tool => tool.name));
  for (const tool of state.tools) state.retired.add(tool.name);
  for (const name of names) state.retired.delete(name);
  const moved = state.hash !== hash;
  state.tools = built.tools;
  state.hash = hash;

  if (hash !== undefined && !state.warned.has(hash)) {
    state.warned.add(hash);
    for (const line of built.skipped) {
      options.ui.warn(`[moku-editor] mcp: no tool for ${line}; use moku_run`);
    }
  }
  if (moved) options.onChange();
  ctx.settle();
}

/**
 * No session is chosen: the grace starts (once); when it fires the doors go.
 *
 * @param ctx - The door set.
 */
function startGrace(ctx: DoorCtx): void {
  const { state } = ctx;
  state.wanted = undefined;
  if (state.graceTimer !== undefined) return;
  state.graceTimer = setTimeout(() => {
    state.graceTimer = undefined;
    take(ctx, undefined, { tools: [], skipped: [] });
  }, ctx.options.graceMs ?? GRACE_MS);
}

/**
 * Fetches the manifest of a session and takes its doors, unless a newer decision asked for
 * another hash meanwhile. A failed fetch keeps the old set; the next push retries.
 *
 * @param ctx - The door set.
 * @param client - The hub connection.
 * @param session - The session id.
 * @param hash - The hash the session goes by.
 */
async function fetchDoors(
  ctx: DoorCtx,
  client: HubClient,
  session: string,
  hash: string
): Promise<void> {
  const { state } = ctx;
  state.fetching = hash;
  let manifest: DoorManifest | undefined;
  try {
    manifest = readDoorManifest(await client.request("game", "manifest", {}, session));
  } catch {
    manifest = undefined;
  }
  if (state.fetching === hash) state.fetching = undefined;
  if (manifest !== undefined && state.wanted === hash) take(ctx, hash, doorTools(manifest));
}

/**
 * Decides on a session list: the session the hub would pick without a `session` argument; the
 * same hash changes nothing, another one fetches its manifest, none starts the grace.
 *
 * @param ctx - The door set.
 * @param client - The hub connection the list came from.
 * @param sessions - The sessions now.
 */
function decide(ctx: DoorCtx, client: HubClient, sessions: readonly SessionView[]): void {
  const { state } = ctx;
  const selected = chooseSession(sessions);
  if (selected === undefined) {
    startGrace(ctx);
    return;
  }

  stopGrace(state);
  const hash = hashOf(selected);
  state.wanted = hash;
  if (hash === state.hash || hash === state.fetching) return;
  void fetchDoors(ctx, client, selected.id, hash);
}

/**
 * Creates the door set: empty until a hub client connects with a session to follow.
 *
 * @param options - The console, the grace and the change callback.
 * @returns The door set.
 * @example
 * ```ts
 * const doors = createDoorTools({ ui: deps.ui, onChange: () => server.toolsChanged() });
 * const editor = createEditorLink({ root, args, deps, onConnected: client => doors.connected(client), onDisconnected: () => doors.disconnected() });
 * ```
 */
export function createDoorTools(options: DoorToolsOptions): DoorTools {
  const { promise: ready, resolve: settle } = Promise.withResolvers<void>();
  const ctx: DoorCtx = {
    options,
    settle,
    state: {
      hash: undefined,
      tools: [],
      retired: new Set(),
      graceTimer: undefined,
      wanted: undefined,
      fetching: undefined,
      unsubscribe: undefined,
      warned: new Set()
    }
  };
  const { state } = ctx;

  return {
    tools: () => state.tools,
    retired: () => new Set(state.retired),
    ready,
    connected: client => {
      state.unsubscribe?.();
      state.unsubscribe = client.onSessions(list => decide(ctx, client, list));
      decide(ctx, client, client.sessions());
    },
    disconnected: () => {
      state.unsubscribe?.();
      state.unsubscribe = undefined;
      startGrace(ctx);
    },
    noEditor: () => settle(),
    dispose: () => {
      stopGrace(state);
      state.unsubscribe?.();
      state.unsubscribe = undefined;
      state.wanted = undefined;
    }
  };
}
