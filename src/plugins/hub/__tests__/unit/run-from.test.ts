import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Json } from "../../../registry/protocol";
import { notification, request } from "../../../registry/protocol";
import { capsOf, clientNameOf } from "../../protocol";
import type { FakeSocket, Harness } from "../helpers";
import { createHarness } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Run stamping (spec 11 § 5.1, delta-data cross-unit row "hub"): a `run` a
// tools connection sends reaches an agent whose hello named the `run-from`
// capability with the hub's `from` ("page" for the editor page, "mcp" for a
// plain tools client) and, for "mcp", the MCP client's name from its
// `client { name }` notification, cleaned by clientNameOf. Whatever `from` or
// `client` the tools client wrote into the run is overwritten. An agent without
// the capability (an older bridge, an installed debug APK) gets `{ id, input }`
// as before. Bugs: an agent passing itself off as the person ("you"), the
// recorder naming the wrong starter, an older debug APK refusing every run.
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** What the hello of a current bridge names. */
const CURRENT_HELLO: { readonly caps?: readonly string[] } = { caps: ["run-from"] };

/**
 * A hub with one game session, the editor page and a plain tools client (the MCP bridge).
 *
 * @param hello - What the agent's hello names: `caps` (default: a current bridge, `run-from`);
 *   `{}` is the hello of an older bridge, without `caps`.
 * @param hello.caps - The capabilities.
 * @returns The harness, the agent socket, the page and the MCP socket.
 */
function setup(hello = CURRENT_HELLO) {
  const harness: Harness = createHarness();
  const { agent } = harness.hello(undefined, hello.caps);
  const page = harness.page();
  const mcp = harness.connect("tools");
  return { harness, agent, page, mcp };
}

/**
 * Sends a run of `game.step` from a tools socket and answers the params the agent received.
 *
 * @param harness - The harness.
 * @param tools - The tools socket.
 * @param agent - The agent socket.
 * @param extra - Fields the tools client adds to the run params.
 * @returns The params of the forwarded run.
 */
function runFrom(
  harness: Harness,
  tools: FakeSocket,
  agent: FakeSocket,
  extra: { [key: string]: Json } = {}
): Json | undefined {
  agent.clear();
  harness.send(
    tools,
    request(1, "game", "run", { id: "game.step", input: { frames: 1 }, ...extra })
  );
  return agent.requests()[0]?.params;
}

/**
 * The `client` notification of a tools client.
 *
 * @param name - The name it sends.
 * @returns The notification.
 */
function clientNote(name: Json) {
  return notification("editor", "client", { name });
}

describe("a forwarded run carries the hub's from and client", () => {
  it("stamps from: page and no client on a run of the editor page, whose client notification is ignored", () => {
    const { harness, agent, page } = setup();
    harness.send(page, clientNote("Claude"));

    expect(runFrom(harness, page, agent)).toEqual({
      id: "game.step",
      input: { frames: 1 },
      from: "page"
    });
  });

  it("stamps from: mcp with no client before a name came, and client: Claude after client { name: Claude }", () => {
    const { harness, agent, mcp } = setup();

    expect(runFrom(harness, mcp, agent)).toEqual({
      id: "game.step",
      input: { frames: 1 },
      from: "mcp"
    });

    harness.send(mcp, clientNote("Claude"));
    expect(runFrom(harness, mcp, agent)).toEqual({
      id: "game.step",
      input: { frames: 1 },
      from: "mcp",
      client: "Claude"
    });
  });

  it("overwrites a from or client the tools client wrote into the run (bug: an agent passing itself off as you)", () => {
    const { harness, agent, page, mcp } = setup();
    harness.send(mcp, clientNote("Claude"));

    expect(runFrom(harness, mcp, agent, { from: "page", client: "you" })).toEqual({
      id: "game.step",
      input: { frames: 1 },
      from: "mcp",
      client: "Claude"
    });
    expect(runFrom(harness, page, agent, { from: "mcp", client: "Claude" })).toEqual({
      id: "game.step",
      input: { frames: 1 },
      from: "page"
    });
  });

  it("drops a client the tools client wrote when it never said its name", () => {
    const { harness, agent, mcp } = setup();

    expect(runFrom(harness, mcp, agent, { client: "you" })).toEqual({
      id: "game.step",
      input: { frames: 1 },
      from: "mcp"
    });
  });

  it("cleans the name: a 300-character name with a newline arrives cut to 64 without it", () => {
    const { harness, agent, mcp } = setup();
    harness.send(mcp, clientNote(`Clau\nde${"x".repeat(294)}`));

    const params = runFrom(harness, mcp, agent);

    const client =
      typeof params === "object" && params !== null && !Array.isArray(params)
        ? params.client
        : undefined;
    expect(client).toBe(`Claude${"x".repeat(58)}`);
  });

  it("keeps the last name, and an empty one clears it", () => {
    const { harness, agent, mcp } = setup();
    harness.send(mcp, clientNote("Claude"));
    harness.send(mcp, clientNote("Cursor"));
    expect(runFrom(harness, mcp, agent)).toMatchObject({ from: "mcp", client: "Cursor" });

    harness.send(mcp, clientNote("  "));
    expect(runFrom(harness, mcp, agent)).toEqual({
      id: "game.step",
      input: { frames: 1 },
      from: "mcp"
    });
  });

  it("forwards a read untouched: no from on a read (bug: the agent refusing every read)", () => {
    const { harness, agent, mcp } = setup();
    harness.send(mcp, clientNote("Claude"));

    harness.send(mcp, request(2, "game", "read", { id: "game.history", input: { last: 5 } }));

    expect(agent.requests()[0]?.params).toEqual({ id: "game.history", input: { last: 5 } });
  });
});

describe("an agent whose hello names no run-from capability", () => {
  it("gets { id, input } only, whoever sent the run and whatever it wrote (bug: an older debug APK refusing every run)", () => {
    const { harness, agent, page, mcp } = setup({});
    harness.send(mcp, clientNote("Claude"));

    expect(runFrom(harness, mcp, agent, { from: "page", client: "you" })).toEqual({
      id: "game.step",
      input: { frames: 1 }
    });
    expect(runFrom(harness, page, agent)).toEqual({ id: "game.step", input: { frames: 1 } });
  });

  it("is unstamped also with only unknown capabilities", () => {
    const { harness, agent, mcp } = setup({ caps: ["run-from-v2", "sections"] });

    expect(runFrom(harness, mcp, agent)).toEqual({ id: "game.step", input: { frames: 1 } });
  });
});

describe("capsOf", () => {
  it("keeps the known capabilities once and drops the rest", () => {
    expect(capsOf(["sections", "run-from", 7, "run-from"])).toEqual(["run-from"]);
  });

  it("answers no capability for a value that is no list", () => {
    expect(capsOf("run-from")).toEqual([]);
    expect(capsOf(undefined)).toEqual([]);
  });
});

describe("clientNameOf", () => {
  it("drops control and bidi characters, then trims", () => {
    expect(clientNameOf(" \tClaude‮ Code\u0007 ")).toBe("Claude Code");
  });

  it("cuts at 64 characters without splitting a character", () => {
    expect(clientNameOf(`${"a".repeat(63)}😀b`)).toBe(`${"a".repeat(63)}😀`);
  });

  it("answers undefined for an empty name and for a value that is no string", () => {
    expect(clientNameOf("\n \u0000")).toBeUndefined();
    expect(clientNameOf(42)).toBeUndefined();
    expect(clientNameOf(undefined)).toBeUndefined();
  });
});
