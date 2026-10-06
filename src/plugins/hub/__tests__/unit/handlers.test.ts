import { describe, expect, it } from "vitest";
import type { ProjectState } from "../../../registry/protocol";
import { createHubApi } from "../../api";
import { createHandlers } from "../../handlers";
import { createCtx, createHarness, fakeSocket, paramsOf } from "../helpers";

/** An open index with one node key and one changed file. */
const ON: ProjectState = {
  state: "on",
  revision: "r2",
  previous: "r1",
  manifest: "src/manifest.ts",
  defs: { "node:board/merge": ["nodes/merge.ts"] },
  uses: { "node:board/merge": ["flows/board.ts"] },
  broken: {},
  change: { files: ["nodes/merge.ts"], moved: [], removed: [] }
};

/** The index turned off. */
const OFF: ProjectState = { state: "off", reason: "disabled" };

// ─────────────────────────────────────────────────────────────────────────────
// hub hooks: `files:project` from the files plugin becomes the published
// `editor.project` state, sent to every tools page, kept and replayed.
// ─────────────────────────────────────────────────────────────────────────────

describe("createHandlers", () => {
  it("publishes files:project as editor.project to every tools page, never to an agent", () => {
    const harness = createHarness();
    const { agent } = harness.hello();
    const tools = harness.connect("tools");
    tools.clear();

    createHandlers(harness.ctx)["files:project"](ON);

    const notes = tools.notes("editor", "project");
    expect(notes).toHaveLength(1);
    expect(paramsOf(notes[0])).toEqual({
      state: "on",
      revision: "r2",
      previous: "r1",
      manifest: "src/manifest.ts",
      defs: { "node:board/merge": ["nodes/merge.ts"] },
      uses: { "node:board/merge": ["flows/board.ts"] },
      broken: {},
      change: { files: ["nodes/merge.ts"], moved: [], removed: [] }
    });
    expect(agent.notes("editor", "project")).toEqual([]);
  });

  it("keeps the last state and replays it to a tools page that opens later", () => {
    const harness = createHarness();
    const hooks = createHandlers(harness.ctx);
    hooks["files:project"](ON);
    hooks["files:project"](OFF);

    const later = harness.connect("tools");

    const methods = later.messages().map(message => ("method" in message ? message.method : ""));
    expect(methods).toEqual(["sessions", "project"]);
    expect(paramsOf(later.notes("editor", "project")[0])).toEqual({
      state: "off",
      reason: "disabled"
    });
  });

  it("keeps a state announced before the hub starts for the first tools page", () => {
    const ctx = createCtx();
    createHandlers(ctx)["files:project"](OFF);
    expect(ctx.state.published.get("project")).toEqual({ state: "off", reason: "disabled" });

    ctx.state.token = "t".repeat(43);
    const tools = fakeSocket("tools", ctx.state.nextConn++);
    createHubApi(ctx).websocket.open(tools);
    expect(tools.notes("editor", "project")).toHaveLength(1);
  });
});
