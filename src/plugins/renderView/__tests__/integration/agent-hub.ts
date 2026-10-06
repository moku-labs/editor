/* eslint-disable unicorn/no-null -- null is a JSON value on the wire */
import type { Mock } from "vitest";
import { vi } from "vitest";
import type { EditorChannel, Json, Request as RpcRequest } from "../../../registry/protocol";
import {
  decode,
  encode,
  failure,
  isRequest,
  notification,
  success
} from "../../../registry/protocol";
import {
  createScriptedHub,
  type ScriptedHub
} from "../../../workspace/__tests__/integration/fake-hub";

// ─────────────────────────────────────────────────────────────────────────────
// An in-process hub between the tools link and one agent: the scripted hub of
// the workspace tests (sessions, heartbeats, manifests, runs) plus the game
// channel routed to an agent EditorChannel (read, watch, unwatch), the files
// channel answered from an in-memory store and the project index replayed on
// each open. Closing a socket drops its watches,
// like the real hub.
// ─────────────────────────────────────────────────────────────────────────────

/** What the hub routes to: the agent's channel, the project files and the project index. */
export type Agent = {
  readonly channel: EditorChannel;
  readonly files: ReadonlyMap<string, string>;
  /** The `editor.project` state each socket gets after it opens, like the hub's replay. */
  readonly project?: Json;
};

/** The agent hub: the scripted hub plus the routed watches. */
export type AgentHub = ScriptedHub & {
  /** Agent watches still open, by wire sub. */
  readonly agentWatches: Map<number, { readonly id: string; readonly stop: () => void }>;
  /** `unwatch` requests, with the source id they stopped. */
  readonly unwatched: string[];
};

/** A fake socket of the scripted hub, as far as this hub uses it. */
type HubSocket = WebSocket & { deliver(text: string): void };

/**
 * The params object of a request.
 *
 * @param request - The request.
 * @returns Its params as an object.
 */
function paramsOf(request: RpcRequest): { readonly [key: string]: Json } {
  const { params } = request;
  return typeof params === "object" && params !== null && !Array.isArray(params) ? params : {};
}

/**
 * Creates the agent hub.
 *
 * @param agent - The agent channel and files.
 * @returns The hub; stub `hub.Socket` as the global WebSocket.
 */
export function createAgentHub(agent: Agent): AgentHub {
  const base = createScriptedHub();
  const agentWatches = new Map<number, { readonly id: string; readonly stop: () => void }>();
  const unwatched: string[] = [];
  const Base = base.Socket as unknown as new (url: string) => HubSocket;

  /** The scripted socket with the game and files channels routed. */
  class Socket extends Base {
    readonly #subs = new Set<number>();

    constructor(url: string) {
      super(url);
      if (agent.project !== undefined) {
        this.deliver(encode(notification("editor", "project", agent.project)));
      }
    }

    override send(text: string): void {
      const message = decode(text);
      if (!isRequest(message) || !this.#route(message)) {
        super.send(text);
        return;
      }
      base.received.push(message);
    }

    override close(code?: number, reason?: string): void {
      for (const sub of this.#subs) {
        agentWatches.get(sub)?.stop();
        agentWatches.delete(sub);
      }
      this.#subs.clear();
      super.close(code, reason);
    }

    #reply(request: RpcRequest, value: Json): void {
      this.deliver(encode(success(request.id, value)));
    }

    #fail(request: RpcRequest, message: string): void {
      this.deliver(
        encode(failure(request.id, { code: -32_000, message: `[moku-editor] ${message}` }))
      );
    }

    #route(request: RpcRequest): boolean {
      const params = paramsOf(request);
      const key = `${request.channel}.${request.method}`;
      if (key === "files.read") {
        const text = agent.files.get(String(params.path));
        if (text === undefined) this.#fail(request, "not found");
        else this.#reply(request, { text, version: "v1" });
        return true;
      }
      if (key === "game.read") {
        agent.channel
          .read(String(params.id), params.input)
          .then(value => this.#reply(request, value))
          .catch((error: unknown) => this.#fail(request, String(error)));
        return true;
      }
      if (key === "game.watch") {
        const sub = Number(params.sub);
        const id = String(params.id);
        const stop = agent.channel.watch(id, params.input, value => {
          this.deliver(encode(notification("game", "value", { sub, value }, request.session)));
        });
        agentWatches.set(sub, { id, stop });
        this.#subs.add(sub);
        this.#reply(request, null);
        return true;
      }
      if (key === "game.unwatch") {
        const sub = Number(params.sub);
        const entry = agentWatches.get(sub);
        if (entry !== undefined) unwatched.push(entry.id);
        entry?.stop();
        agentWatches.delete(sub);
        this.#subs.delete(sub);
        this.#reply(request, null);
        return true;
      }
      return false;
    }
  }

  return Object.assign(base, {
    Socket: Socket as unknown as ScriptedHub["Socket"],
    agentWatches,
    unwatched
  });
}

/** A scripted agent channel: values set by the test, rects for game.rect. */
export type ScriptedChannel = {
  readonly channel: EditorChannel;
  readonly watch: Mock<EditorChannel["watch"]>;
  /** Sets a source value and delivers it to its watchers. */
  set(id: string, value: Json): void;
};

/**
 * A scripted agent channel: `watch` delivers the current value first (on a microtask), then every
 * `set`; `read("game.rect", { key })` answers from the rects.
 *
 * @param values - The starting source values.
 * @param rects - game.rect by key.
 * @returns The channel.
 */
export function createScriptedChannel(
  values: Record<string, Json>,
  rects: Readonly<Record<string, Json>>
): ScriptedChannel {
  const watchers = new Map<string, Set<(value: Json) => void>>();
  const watch = vi.fn<EditorChannel["watch"]>((id, _input, onValue) => {
    const set = watchers.get(id) ?? new Set();
    watchers.set(id, set);
    set.add(onValue);
    const current = values[id];
    if (current !== undefined) queueMicrotask(() => onValue(current));
    return () => {
      set.delete(onValue);
    };
  });
  return {
    watch,
    channel: {
      read: (id, input) => {
        const key =
          typeof input === "object" && input !== null && !Array.isArray(input)
            ? input.key
            : undefined;
        if (id === "game.rect" && typeof key === "string")
          return Promise.resolve(rects[key] ?? null);
        return Promise.resolve(values[id] ?? null);
      },
      watch,
      run: () => Promise.reject(new Error("[moku-editor] no commands here")),
      status: () => ({ kind: "live", frame: 1841 })
    },
    set(id, value) {
      values[id] = value;
      for (const onValue of watchers.get(id) ?? []) onValue(value);
    }
  };
}
