/**
 * @file Tools-link wire module (hub/protocol, runtime-free): what a tools client tells the hub about
 * itself, what an agent's hello says it understands, and what the hub stamps on a `run` it forwards
 * to an agent (spec 11 § 5.1 "Run stamping"). The MCP bridge sends the editor-channel notification
 * `client { name }` after `initialize` and after every reconnect; the hub cleans the name with
 * `clientNameOf`. An agent whose `hello` names the `run-from` capability gets `from` (and, for an
 * agent, `client`) on every run, over whatever the tools client wrote there; an agent without it (an
 * older bridge, an installed debug build) gets `{ id, input }` as before. The game's bridge reads
 * both (spec 07 B1). Imports only its sibling device-link.ts.
 */
import type { LinkJson } from "./device-link";
import { isUnsafeChar } from "./device-link";

/**
 * Who sent a run through the hub: the editor page (`"page"`) or a plain tools client, the MCP bridge
 * of an agent (`"mcp"`).
 *
 * @example
 * ```ts
 * const from: RunFrom = "mcp"; // the bridge turns it into the registry's via "mcp"
 * ```
 */
export type RunFrom = "page" | "mcp";

/**
 * The method of the tools→hub editor-channel notification that names the MCP client.
 */
export const CLIENT_METHOD = "client";

/**
 * Params of the tools→hub editor-channel notification `client`: the MCP client's name, as its
 * `initialize` gave it (`clientInfo.name`). The hub takes it from a plain tools connection only.
 *
 * @example
 * ```ts
 * const params: ClientParams = { name: "Claude Code" };
 * ```
 */
export type ClientParams = { readonly name: string };

/**
 * The params of a `run` the hub forwards to an agent: the tools client's `id` and `input`, and the
 * hub's own `from` and, with `from: "mcp"` and a known name, `client`.
 *
 * @example
 * ```ts
 * const params: StampedRunParams = { id: "editor.record", input: { on: true }, from: "mcp", client: "Claude Code" };
 * ```
 */
export type StampedRunParams = {
  readonly id: string;
  readonly input?: LinkJson;
  readonly from: RunFrom;
  /** The MCP client's name, cleaned by `clientNameOf`; only with `from: "mcp"`. */
  readonly client?: string;
};

/**
 * The capability an agent names in its `hello` when its bridge reads a stamped run (`from`,
 * `client`, spec 07 B1). Without it the hub forwards a run as `{ id, input }`.
 */
export const RUN_FROM_CAP = "run-from";

/**
 * A capability an agent can name in its `hello`.
 *
 * @example
 * ```ts
 * const cap: AgentCap = "run-from";
 * ```
 */
export type AgentCap = typeof RUN_FROM_CAP;

/**
 * What an agent adds to its `hello { manifest }` params to say what it understands. Older agents
 * send none; the hub ignores a name it does not know.
 *
 * @example
 * ```ts
 * const extra: HelloCaps = { caps: ["run-from"] }; // the bridge's hello: { manifest, caps: ["run-from"] }
 * ```
 */
export type HelloCaps = { readonly caps?: readonly AgentCap[] };

/**
 * The capabilities the hub knows.
 */
const KNOWN_CAPS: ReadonlySet<unknown> = new Set<AgentCap>([RUN_FROM_CAP]);

/**
 * True for a capability the hub knows.
 *
 * @param entry - An entry of a hello's `caps`.
 * @returns Whether it is an AgentCap.
 * @example
 * ```ts
 * isAgentCap("run-from"); // true
 * ```
 */
function isAgentCap(entry: unknown): entry is AgentCap {
  return KNOWN_CAPS.has(entry);
}

/**
 * The known capabilities of a hello's `caps`, each once, in order; names the hub does not know, an
 * entry that is no string and a value that is no list are ignored.
 *
 * @param raw - The `caps` of a hello, as it arrived.
 * @returns The capabilities.
 * @example
 * ```ts
 * capsOf(["sections", "run-from"]); // ["run-from"]
 * capsOf(undefined); // []
 * ```
 */
export function capsOf(raw: unknown): readonly AgentCap[] {
  if (!Array.isArray(raw)) return [];

  const caps: AgentCap[] = [];
  for (const entry of raw) {
    if (isAgentCap(entry) && !caps.includes(entry)) caps.push(entry);
  }
  return caps;
}

/**
 * The longest client name, in characters (code points).
 */
export const MAX_CLIENT_NAME = 64;

/**
 * Cleans an MCP client's name: control and bidi characters dropped, trimmed, cut to 64 characters
 * (code points, so a character is never split); an empty result or a value that is no string gives
 * undefined.
 *
 * @param raw - The `name` of a `client` notification, as it arrived.
 * @returns The clean name, or undefined.
 * @example
 * ```ts
 * clientNameOf(" Claude\nCode "); // "ClaudeCode"
 * clientNameOf("\n"); // undefined
 * ```
 */
export function clientNameOf(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;

  const kept = [...raw].filter(char => !isUnsafeChar(char)).join("");
  const name = [...kept.trim()].slice(0, MAX_CLIENT_NAME).join("").trimEnd();
  return name === "" ? undefined : name;
}
