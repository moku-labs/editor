// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PanelTools } from "../../../panels/types";
import { stopGameView } from "../../lifecycle";
import { createGamePanel } from "../../ui/panel";
import { createCtx, type TestCtx, useScene } from "../helpers";
import { click, find, findAll, type Mounted, mount } from "../ui";

let ctx: TestCtx;
let view: Mounted;

/**
 * The panel tools a view gets.
 *
 * @returns The tools.
 */
function toolsOf(): PanelTools<Readonly<Record<string, string>>> {
  return {
    run: {},
    status: { kind: "live", frame: 1841 },
    channel: ctx.link.api,
    files: ctx.link.files,
    workspace: ctx.workspace.api
  };
}

beforeEach(() => {
  ctx = createCtx();
  useScene(ctx);
  ctx.workspace.activeValue = "game";
  const spec = createGamePanel(ctx);
  view = mount(
    spec.view(
      { position: { path: "board/awaitIntent", flow: "board", node: "awaitIntent", waiting: [] } },
      toolsOf()
    )
  );
});

afterEach(() => {
  view.unmount();
  stopGameView(ctx);
  document.body.innerHTML = "";
});

describe("GameWorkspace", () => {
  it("lays out the toolbar, the stage and the side panel", () => {
    expect(find(view.root, "[data-game='workspace'] [data-game='toolbar']")).toBeDefined();
    expect(find(view.root, "[data-game='stage']")).toBeDefined();
    expect(find(view.root, "aside[data-game='side']").getAttribute("aria-label")).toBe(
      "Game inspector"
    );
  });

  it("switches between the Element and the Device tab", () => {
    const tabs = findAll(view.root, "[role='tab']");
    expect(tabs.map(tab => tab.textContent)).toEqual(["Element", "Device"]);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    expect(find(view.root, "[data-part='element']")).toBeDefined();

    click(tabs[1] as HTMLElement);
    expect(ctx.state.tab).toBe("device");
    expect(find(view.root, "[data-part='devices']")).toBeDefined();
    expect(findAll(view.root, "[role='tab']")[1]?.getAttribute("aria-selected")).toBe("true");
  });

  it("goes back to the Element tab", () => {
    click(findAll(view.root, "[role='tab']")[1] as HTMLElement);
    click(findAll(view.root, "[role='tab']")[0] as HTMLElement);
    expect(ctx.state.tab).toBe("element");
  });
});
