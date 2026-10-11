import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DeviceInfo,
  Json,
  Message,
  NodeInfo,
  RelayedEditorMethod,
  SelectionInfo,
  ShowInfo,
  WireError
} from "../../../registry/protocol";
import {
  failure,
  notification,
  request,
  success,
  toWireValue,
  WORKSPACE_NAMES
} from "../../../registry/protocol";
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

// ─────────────────────────────────────────────────────────────────────────────
// editor.device, editor.show and editor.node (D-60): the requests that drive the
// tools page UI. Each is checked with its protocol parser (a closed object), then
// relayed to the page exactly like editor.select, with the deadline of a plain call.
// ─────────────────────────────────────────────────────────────────────────────

/** The page's answer to `device { preset: "pixel-8", orientation: "landscape" }`. */
const DEVICE_INFO: DeviceInfo = {
  preset: "pixel-8",
  orientation: "landscape",
  folded: true,
  w: 915,
  h: 412,
  presets: [
    {
      id: "pixel-8",
      name: "Pixel 8",
      group: "android",
      kind: "phone",
      w: 412,
      h: 915,
      foldable: false
    }
  ]
};

/** The page's answer to `show { workspace: "state" }`. */
const SHOW_INFO: ShowInfo = { workspace: "state", workspaces: WORKSPACE_NAMES };

/** The page's answer to `node { id: "main/home" }`. */
const NODE_INFO: NodeInfo = { id: "main/home", selected: "main/home" };

/** One UI request: params that pass, the page's answer, an error of the page, params that fail. */
type RelayCase = {
  readonly method: Exclude<RelayedEditorMethod, "select">;
  readonly params: Json;
  readonly answer: Json;
  readonly pageError: WireError;
  readonly bad: readonly Json[];
};

/** The three UI requests the hub relays next to `select`. */
const UI_REQUESTS: readonly RelayCase[] = [
  {
    method: "device",
    params: { preset: "pixel-8", orientation: "landscape", folded: true },
    answer: toWireValue(DEVICE_INFO),
    pageError: {
      code: -32_602,
      message: "[moku-editor] unknown preset pixel-9",
      data: { reason: "invalid_input", retryable: false, field: "preset" }
    },
    bad: [
      { orientation: "sideways" },
      { preset: 8 },
      { folded: "yes" },
      { preset: "pixel-8", zoom: 2 },
      [1]
    ]
  },
  {
    method: "show",
    params: { workspace: "state" },
    answer: toWireValue(SHOW_INFO),
    pageError: {
      code: -32_601,
      message: "[moku-editor] unknown method editor.show",
      data: { retryable: false }
    },
    bad: [{ workspace: "settings" }, { workspace: 1 }, { workspace: "state", focus: true }, [1]]
  },
  {
    method: "node",
    params: { id: "main/home" },
    answer: toWireValue(NODE_INFO),
    pageError: {
      code: -32_003,
      message: "[moku-editor] the Flow view has no graph yet",
      data: { reason: "no_graph", retryable: true }
    },
    bad: [
      {},
      { id: "" },
      { id: "n".repeat(257) },
      { id: 7 },
      { id: "main/home", expand: true },
      [1]
    ]
  }
];

/** The UI requests as `[method, case]` rows, so a test title prints the bare method name. */
const UI_REQUEST_ROWS = UI_REQUESTS.map(row => [row.method, row] as const);

describe.each(UI_REQUEST_ROWS)("editor.%s relay", (method, { params, answer, pageError, bad }) => {
  it("relays the checked params to the page under a hub id and answers the caller with its own id", () => {
    const { harness, page, tools } = setup();

    harness.send(tools, request(7, "editor", method, params));

    expect(page.requests()).toEqual([{ jsonrpc: "2.0", id: 1, channel: "editor", method, params }]);
    expect(harness.toolsConn(tools).pending).toBe(1);

    harness.send(page, success(lastHubId(page), answer));

    expect(resultOf(tools, 7)).toEqual(answer);
    expect(harness.ctx.state.pending.size).toBe(0);
    expect(harness.toolsConn(tools).pending).toBe(0);
  });

  it("passes a page error through to the caller", () => {
    const { harness, page, tools } = setup();
    harness.send(tools, request(7, "editor", method, params));

    harness.send(page, failure(lastHubId(page), pageError));

    expect(errorOf(tools, 7)).toEqual(pageError);
    expect(harness.ctx.state.pending.size).toBe(0);
  });

  it("refuses bad params with -32602 invalid_input and relays nothing", () => {
    const { harness, page, tools } = setup();

    for (const [index, wrong] of bad.entries()) {
      harness.send(tools, request(index + 1, "editor", method, wrong));
    }

    for (const index of bad.keys()) {
      expect(errorOf(tools, index + 1)).toMatchObject({
        code: -32_602,
        message: expect.stringContaining(`editor.${method} params must be {`),
        data: { reason: "invalid_input", retryable: false }
      });
    }
    expect(page.requests()).toEqual([]);
    expect(harness.ctx.state.pending.size).toBe(0);
    expect(harness.toolsConn(tools).pending).toBe(0);
  });

  it("checks the params before it looks for a page", () => {
    const harness = createHarness();
    const tools = harness.connect("tools");

    harness.send(tools, request(1, "editor", method, bad[0]));

    expect(errorOf(tools, 1)?.code).toBe(-32_602);
  });

  it("fails -32003 no_editor_page naming the editor page url when no page is open", () => {
    const harness = createHarness();
    harness.ctx.state.editorPort = 3000;
    const tools = harness.connect("tools");
    const other = harness.connect("tools");

    harness.send(tools, request(1, "editor", method, params));

    expect(errorOf(tools, 1)).toEqual({
      code: -32_003,
      message:
        "[moku-editor] no editor page is open. Open the editor page: http://127.0.0.1:3000/__editor/",
      data: { reason: "no_editor_page", retryable: false }
    });
    expect(other.requests()).toEqual([]);
    expect(harness.toolsConn(tools).pending).toBe(0);
  });

  it("waits callTimeoutMs, the deadline of a plain call, then fails -32002", () => {
    const { harness, page, tools } = setup(300);
    harness.send(tools, request(7, "editor", method, params));

    vi.advanceTimersByTime(299);
    expect(page.requests()).toHaveLength(1);
    expect(errorOf(tools, 7)).toBeUndefined();
    vi.advanceTimersByTime(1);

    expect(errorOf(tools, 7)).toMatchObject({ code: -32_002, data: { reason: "timeout" } });
    expect(harness.ctx.state.pending.size).toBe(0);
  });
});

describe("editor.device, editor.show and editor.node", () => {
  it("relay empty or absent params of device and show as {}: they read the state", () => {
    const { harness, page, tools } = setup();

    harness.send(tools, request(1, "editor", "device"));
    harness.send(tools, request(2, "editor", "device", {}));
    harness.send(tools, request(3, "editor", "show"));
    harness.send(tools, request(4, "editor", "show", {}));

    expect(page.requests().map(relayed => [relayed.method, relayed.params])).toEqual([
      ["device", {}],
      ["device", {}],
      ["show", {}],
      ["show", {}]
    ]);
  });

  it("name the method and the expected shape in the -32602 message, select as before", () => {
    const { harness, page, tools } = setup();

    harness.send(tools, request(1, "editor", "select", { card: "yes" }));
    harness.send(tools, request(2, "editor", "device", { folded: "yes" }));
    harness.send(tools, request(3, "editor", "show", { workspace: "settings" }));
    harness.send(tools, request(4, "editor", "node"));

    expect([1, 2, 3, 4].map(id => errorOf(tools, id))).toEqual(
      [
        "editor.select params must be { key?: string, ref?: SelectionRef, rect?: SelectionRect, card?: boolean }",
        'editor.device params must be { preset?: string, orientation?: "portrait" | "landscape", folded?: boolean }',
        "editor.show params must be { workspace?: WorkspaceName }",
        "editor.node params must be { id: string (1 to 256 chars) }"
      ].map(message => ({
        code: -32_602,
        message: `[moku-editor] ${message}`,
        data: { reason: "invalid_input", retryable: false }
      }))
    );
    expect(page.requests()).toEqual([]);
  });

  it("go to the page that published the selection while it is open, else the newest (A7)", () => {
    const harness = createHarness();
    const first = harness.page();
    const second = harness.page();
    const tools = harness.connect("tools");
    harness.send(first, selectionNote(INFO_JSON));

    harness.send(tools, request(1, "editor", "show", { workspace: "flow" }));
    expect(first.requests().map(relayed => relayed.method)).toEqual(["show"]);
    expect(second.requests()).toEqual([]);

    harness.close(first);
    const third = harness.page();
    harness.send(tools, request(2, "editor", "node", { id: "main/home" }));
    expect(third.requests().map(relayed => relayed.method)).toEqual(["node"]);
    expect(second.requests()).toEqual([]);
  });

  it("fail -32001 page_closed when the page closes before it answers", () => {
    const { harness, page, tools } = setup();
    harness.send(tools, request(1, "editor", "device", {}));

    harness.close(page);

    expect(errorOf(tools, 1)).toEqual({
      code: -32_001,
      message: "[moku-editor] editor page closed",
      data: { retryable: true, reason: "page_closed" }
    });
    expect(harness.ctx.state.pending.size).toBe(0);
  });

  it("are never settled by another page nor by a plain tools conn", () => {
    const harness = createHarness();
    const first = harness.page();
    const second = harness.page();
    const tools = harness.connect("tools");
    harness.send(first, selectionNote(INFO_JSON));
    harness.send(tools, request(7, "editor", "node", { id: "main/home" }));
    const id = lastHubId(first);

    harness.send(second, success(id, toWireValue(NODE_INFO)));
    harness.send(tools, success(id, toWireValue(NODE_INFO)));
    expect(resultOf(tools, 7)).toBeUndefined();

    harness.send(first, success(id, toWireValue(NODE_INFO)));
    expect(resultOf(tools, 7)).toEqual(toWireValue(NODE_INFO));
  });

  it.each([
    "devices",
    "nodes",
    "constructor",
    "toString",
    "hasOwnProperty",
    "__proto__"
  ])("still refuse the unknown editor method %s with -32601 and relay nothing", method => {
    const { harness, page, tools } = setup();

    harness.send(tools, request(1, "editor", method, {}));

    expect(errorOf(tools, 1)).toEqual({
      code: -32_601,
      message: `[moku-editor] unknown method editor.${method}`,
      data: { retryable: false }
    });
    expect(page.requests()).toEqual([]);
  });

  it("leave editor.selection to the hub: answered from the kept value, never relayed", () => {
    const { harness, page, tools } = setup();
    harness.send(page, selectionNote(INFO_JSON));
    page.clear();

    harness.send(tools, request(1, "editor", "selection", {}));

    expect(resultOf(tools, 1)).toEqual(INFO_JSON);
    expect(page.requests()).toEqual([]);
  });
});

describe("deadlineFor editor.device, editor.show and editor.node", () => {
  it.each(UI_REQUEST_ROWS)("is callTimeoutMs for %s, a plain call", (method, { params }) => {
    expect(deadlineFor(method, params, 5000)).toBe(5000);
    expect(deadlineFor(method, undefined, 5000)).toBe(5000);
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
