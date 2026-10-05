import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Json, Message, SelectionInfo } from "../../../registry/protocol";
import { failure, notification, request, success, toWireValue } from "../../../registry/protocol";
import { deadlineFor, failSession } from "../../routing/calls";
import type { FakeSocket, Harness } from "../helpers";
import { createHarness, errorOf, paramsOf, resultOf } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The editor page role (D-33): a tools conn upgraded with role=page publishes
// the selection, which the hub keeps and replays; editor.selection answers it;
// editor.select is relayed to a page and its answer goes back to the caller.
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** The coins label, picked in the editor page. */
const INFO: SelectionInfo = {
  ref: { kind: "ui", path: "column#0/hudRow/coins" },
  key: "coins",
  name: "coins",
  type: "text",
  rect: { x: 12, y: 40, w: 96, h: 24 },
  at: 1_790_000_000_000
};

/** INFO as the wire carries it. */
const INFO_JSON: Json = toWireValue(INFO);

/**
 * The page's `selection` notification; no params means nothing is selected.
 *
 * @param info - The selection params, if any.
 * @returns The notification.
 */
function selectionNote(info?: Json): Message {
  return info === undefined
    ? notification("editor", "selection")
    : notification("editor", "selection", info);
}

/**
 * A started hub with one editor page and one plain tools conn (the MCP bridge), open
 * notifications cleared.
 *
 * @param callTimeoutMs - The call timeout.
 * @returns The harness and the two sockets.
 */
function setup(callTimeoutMs = 5000): { harness: Harness; page: FakeSocket; tools: FakeSocket } {
  const harness = createHarness({ callTimeoutMs });
  const page = harness.page();
  const tools = harness.connect("tools");
  page.clear();
  tools.clear();
  return { harness, page, tools };
}

/**
 * The id the hub gave the last request a page received.
 *
 * @param page - The page socket.
 * @returns The hub id.
 */
function lastHubId(page: FakeSocket): number {
  const forwarded = page.requests().at(-1);
  if (forwarded === undefined) throw new Error("the page got no request");
  return forwarded.id;
}

describe("page role", () => {
  it("registers a role=page socket as a page tools conn, a plain one as not a page", () => {
    const { harness, page, tools } = setup();

    expect(harness.toolsConn(page).page).toBe(true);
    expect(harness.toolsConn(tools).page).toBe(false);
  });
});

describe("a page's selection notification", () => {
  it("is published to every tools conn and kept, unknown fields dropped", () => {
    const { harness, page, tools } = setup();

    harness.send(page, selectionNote(toWireValue({ ...INFO, zoom: 2 })));

    for (const socket of [page, tools]) {
      const notes = socket.notes("editor", "selection");
      expect(notes).toHaveLength(1);
      expect(paramsOf(notes[0])).toEqual(INFO_JSON);
    }
    expect(harness.ctx.state.published.get("selection")).toEqual(INFO_JSON);
  });

  it("is replayed right after the sessions list of a tools conn that opens later", () => {
    const { harness, page } = setup();
    harness.send(page, selectionNote(INFO_JSON));

    const later = harness.connect("tools");

    const methods = later.messages().map(message => ("method" in message ? message.method : ""));
    expect(methods).toEqual(["sessions", "selection"]);
    expect(paramsOf(later.notes("editor", "selection")[0])).toEqual(INFO_JSON);
  });

  it("without params means nothing is selected: kept as null, sent without params", () => {
    const { harness, page, tools } = setup();
    harness.send(page, selectionNote(INFO_JSON));
    tools.clear();

    harness.send(page, selectionNote());

    const [note] = tools.notes("editor", "selection");
    expect(note).toEqual({ jsonrpc: "2.0", channel: "editor", method: "selection" });
    expect(harness.ctx.state.published.get("selection")).toBeNull();
    const later = harness.connect("tools");
    expect(later.notes("editor", "selection")).toEqual([note]);
  });

  it("counts a malformed selection as a strike and publishes nothing", () => {
    const { harness, page, tools } = setup();

    harness.send(page, selectionNote({ name: "coins", type: "text" }));

    expect(harness.toolsConn(page).invalid).toBe(1);
    expect(tools.sent).toEqual([]);
    expect(harness.ctx.state.published.has("selection")).toBe(false);
  });

  it("is ignored from a plain tools conn and logged at debug", () => {
    const { harness, page, tools } = setup();

    harness.send(tools, selectionNote(INFO_JSON));

    expect(page.sent).toEqual([]);
    expect(harness.ctx.state.published.has("selection")).toBe(false);
    expect(harness.ctx.log.debug).toHaveBeenCalledWith("hub:tools-ignored", {
      method: "selection"
    });
  });
});

describe("editor.selection request", () => {
  it("answers the kept selection, and null before any", () => {
    const { harness, page, tools } = setup();

    harness.send(tools, request(1, "editor", "selection", {}));
    harness.send(page, selectionNote(INFO_JSON));
    harness.send(tools, request(2, "editor", "selection"));

    expect(resultOf(tools, 1)).toBeNull();
    expect(resultOf(tools, 2)).toEqual(INFO_JSON);
    expect(page.requests()).toEqual([]);
  });

  it("refuses params with -32602", () => {
    const { harness, tools } = setup();

    harness.send(tools, request(1, "editor", "selection", { all: true }));

    expect(errorOf(tools, 1)).toMatchObject({ code: -32_602, data: { field: "all" } });
  });

  it("refuses an unknown editor method with -32601", () => {
    const { harness, tools } = setup();

    harness.send(tools, request(1, "editor", "hotReload", {}));

    expect(errorOf(tools, 1)).toMatchObject({
      code: -32_601,
      message: "[moku-editor] unknown method editor.hotReload"
    });
  });
});

describe("editor.select relay", () => {
  it("relays to the page under a hub id and answers the caller with its own id", () => {
    const { harness, page, tools } = setup();

    harness.send(tools, request(7, "editor", "select", { key: "coins", zoom: 1 }));

    const [relayed] = page.requests();
    expect(relayed).toEqual({
      jsonrpc: "2.0",
      id: 1,
      channel: "editor",
      method: "select",
      params: { key: "coins" }
    });
    expect(harness.toolsConn(tools).pending).toBe(1);

    harness.send(page, success(lastHubId(page), INFO_JSON));

    expect(resultOf(tools, 7)).toEqual(INFO_JSON);
    expect(harness.ctx.state.pending.size).toBe(0);
    expect(harness.toolsConn(tools).pending).toBe(0);
  });

  it("passes a page error through to the caller", () => {
    const { harness, page, tools } = setup();
    harness.send(tools, request(7, "editor", "select", { key: "nope" }));
    const error = { code: -32_602, message: "[moku-editor] No element with key nope" };

    harness.send(page, failure(lastHubId(page), error));

    expect(errorOf(tools, 7)).toEqual(error);
  });

  it("goes to the page that published the selection while it is open, else the newest (A7)", () => {
    const harness = createHarness();
    const first = harness.page();
    const second = harness.page();
    const tools = harness.connect("tools");
    harness.send(first, selectionNote(INFO_JSON));

    harness.send(tools, request(1, "editor", "select", { key: "coins" }));
    expect(first.requests()).toHaveLength(1);
    expect(second.requests()).toEqual([]);

    harness.close(first);
    const third = harness.page();
    harness.send(tools, request(2, "editor", "select", { key: "coins" }));
    expect(third.requests()).toHaveLength(1);
    expect(second.requests()).toEqual([]);
  });

  it("fails -32003 no_editor_page naming the editor page url when no page is open", () => {
    const harness = createHarness();
    harness.ctx.state.editorPort = 3000;
    const tools = harness.connect("tools");
    const other = harness.connect("tools");

    harness.send(tools, request(1, "editor", "select", { key: "coins" }));

    expect(errorOf(tools, 1)).toEqual({
      code: -32_003,
      message:
        "[moku-editor] no editor page is open. Open the editor page: http://127.0.0.1:3000/__editor/",
      data: { reason: "no_editor_page", retryable: false }
    });
    expect(other.requests()).toEqual([]);
    expect(harness.toolsConn(tools).pending).toBe(0);
  });

  it("names the editor path when no upgrade told the port yet", () => {
    const harness = createHarness();
    const tools = harness.connect("tools");

    harness.send(tools, request(1, "editor", "select", {}));

    expect(errorOf(tools, 1)?.message).toBe(
      "[moku-editor] no editor page is open. Open the editor page: /__editor/"
    );
  });

  it("refuses bad params with -32602 and relays nothing", () => {
    const { harness, page, tools } = setup();

    harness.send(tools, request(1, "editor", "select", { card: "yes" }));
    harness.send(tools, request(2, "editor", "select", [1]));

    expect(errorOf(tools, 1)).toMatchObject({
      code: -32_602,
      data: { reason: "invalid_input", retryable: false }
    });
    expect(errorOf(tools, 2)?.code).toBe(-32_602);
    expect(page.requests()).toEqual([]);
  });
});

describe("deadlineFor editor.select (A6)", () => {
  it("is 4 × callTimeoutMs with a card, absent card counting as true", () => {
    expect(deadlineFor("select", { key: "coins", card: true }, 5000)).toBe(20_000);
    expect(deadlineFor("select", { key: "coins" }, 5000)).toBe(20_000);
    expect(deadlineFor("select", undefined, 5000)).toBe(20_000);
  });

  it("is callTimeoutMs without a card", () => {
    expect(deadlineFor("select", { key: "coins", card: false }, 5000)).toBe(5000);
  });

  it("caps the extension at 60 s like every long call", () => {
    expect(deadlineFor("select", { card: true }, 30_000)).toBe(90_000);
  });
});

describe("page calls: deadline, close, ownership (A3)", () => {
  it("times out a select without a card after callTimeoutMs with -32002", () => {
    const { harness, tools } = setup(300);
    harness.send(tools, request(7, "editor", "select", { key: "coins", card: false }));

    vi.advanceTimersByTime(299);
    expect(errorOf(tools, 7)).toBeUndefined();
    vi.advanceTimersByTime(1);

    expect(errorOf(tools, 7)).toMatchObject({ code: -32_002, data: { reason: "timeout" } });
    expect(harness.ctx.state.pending.size).toBe(0);
  });

  it("waits 4 × callTimeoutMs for a select with a card", () => {
    const { harness, tools } = setup(300);
    harness.send(tools, request(7, "editor", "select", { key: "coins" }));

    vi.advanceTimersByTime(1199);
    expect(errorOf(tools, 7)).toBeUndefined();
    vi.advanceTimersByTime(1);

    expect(errorOf(tools, 7)?.code).toBe(-32_002);
  });

  it("fails the calls of a closing page -32001 page_closed; another page's call waits", () => {
    const harness = createHarness();
    const first = harness.page();
    const second = harness.page();
    const tools = harness.connect("tools");
    harness.send(first, selectionNote(INFO_JSON));
    harness.send(tools, request(1, "editor", "select", { key: "coins" }));
    harness.send(second, selectionNote(INFO_JSON));
    harness.send(tools, request(2, "editor", "select", { key: "coins" }));

    harness.close(first);

    expect(errorOf(tools, 1)).toEqual({
      code: -32_001,
      message: "[moku-editor] editor page closed",
      data: { retryable: true, reason: "page_closed" }
    });
    expect(errorOf(tools, 2)).toBeUndefined();
    expect(harness.ctx.state.pending.size).toBe(1);
    expect(second.requests()).toHaveLength(1);
  });

  it("settles a call only from the page it went to", () => {
    const harness = createHarness();
    const first = harness.page();
    const second = harness.page();
    const tools = harness.connect("tools");
    harness.send(first, selectionNote(INFO_JSON));
    harness.send(tools, request(7, "editor", "select", { key: "coins" }));
    const id = lastHubId(first);

    harness.send(second, success(id, INFO_JSON));
    harness.send(tools, success(id, INFO_JSON));

    expect(resultOf(tools, 7)).toBeUndefined();
    expect(harness.ctx.state.pending.size).toBe(1);
    expect(harness.ctx.log.debug).toHaveBeenCalledWith("hub:late-response", { id });

    harness.send(first, success(id, INFO_JSON));
    expect(resultOf(tools, 7)).toEqual(INFO_JSON);
  });

  it("is never settled by an agent nor failed by its session ending", () => {
    const { harness, page, tools } = setup();
    const { agent, session } = harness.hello();
    harness.send(tools, request(7, "editor", "select", { key: "coins" }));
    const id = lastHubId(page);

    harness.send(agent, success(id, INFO_JSON));
    failSession(harness.ctx, session);

    expect(resultOf(tools, 7)).toBeUndefined();
    expect(errorOf(tools, 7)).toBeUndefined();
    expect(harness.ctx.state.pending.size).toBe(1);
  });

  it("drops the answer when the caller closed first", () => {
    const { harness, page, tools } = setup();
    harness.send(tools, request(7, "editor", "select", { key: "coins" }));
    harness.close(tools);
    tools.clear();

    harness.send(page, success(lastHubId(page), INFO_JSON));

    expect(tools.sent).toEqual([]);
    expect(harness.ctx.state.pending.size).toBe(0);
  });
});

describe("the last page closing (A7)", () => {
  it("publishes selection null once no page is open", () => {
    const harness = createHarness();
    const first = harness.page();
    const second = harness.page();
    const tools = harness.connect("tools");
    harness.send(first, selectionNote(INFO_JSON));
    tools.clear();

    harness.close(first);
    expect(tools.notes("editor", "selection")).toEqual([]);
    expect(harness.ctx.state.selectionConn).toBeUndefined();

    harness.close(second);
    expect(tools.notes("editor", "selection")).toEqual([
      { jsonrpc: "2.0", channel: "editor", method: "selection" }
    ]);
    expect(harness.ctx.state.published.get("selection")).toBeNull();
  });

  it("publishes nothing when a plain tools conn closes", () => {
    const { harness, page, tools } = setup();

    harness.close(tools);

    expect(page.notes("editor", "selection")).toEqual([]);
  });
});
