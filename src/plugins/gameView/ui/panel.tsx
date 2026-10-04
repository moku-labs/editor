/**
 * @file gameView plugin — the Game panel (definePanel data) and the GameWorkspace root, which
 * is composition only (commands run through panels.run, R9): toolbar, stage, the Element panel
 * (the shared SidePanel `game.side`, D-29) with the Element and Device tabs, and the floats
 * (series popover, capture card, sheet).
 */
import type { VNode } from "preact";
import { h } from "preact";
import { definePanel } from "../../panels/define";
import { SidePanel } from "../../panels/shared/side-panel";
import type { PanelSpec, PanelTools } from "../../panels/types";
import type { Json } from "../../registry/protocol";
import { positionOf } from "../capture/naming";
import { GAME_COMMANDS } from "../commands";
import { SIDE_PANEL, SIDE_SIZE, SIDE_TITLE } from "../side";
import type { GameCommands, GameViewCtx } from "../types";
import { setTab } from "../view-state";
import { CaptureCard } from "./CaptureCard";
import { ContactSheet } from "./ContactSheet";
import { DeviceTab } from "./DeviceTab";
import { DeviceToolbar } from "./DeviceToolbar";
import { ElementTab } from "./ElementTab";
import { SeriesPopover } from "./SeriesPopover";
import { Stage } from "./Stage";
import { useGameView } from "./useGameView";

/**
 * Props of the Game workspace root.
 */
export type GameWorkspaceProps = {
  readonly ctx: GameViewCtx;
  readonly position: Json;
  readonly tools: PanelTools<GameCommands> | PanelTools<Readonly<Record<string, string>>>;
};

/**
 * The Game panel: source game.position; commands capture, series, seriesStop.
 *
 * @param ctx - Domain context of gameView.
 * @returns The frozen PanelSpec.
 */
export function createGamePanel(ctx: GameViewCtx): PanelSpec {
  return definePanel({
    id: "game",
    title: "Game",
    workspace: "game",
    sources: { position: "game.position" },
    commands: GAME_COMMANDS,
    /**
     * Renders the Game workspace root with the position value and the panel tools.
     *
     * @param values - The panel values (position).
     * @param tools - The panel tools.
     * @returns The workspace root.
     */
    view: (values, tools) => h(GameWorkspace, { ctx, position: values.position, tools })
  });
}

/**
 * The Game workspace root: toolbar, stage, the Element panel, floats.
 *
 * @param props - Plugin context, the position value and the panel tools.
 * @returns The workspace.
 */
export function GameWorkspace(props: GameWorkspaceProps): VNode {
  const { ctx, position, tools } = props;
  const { state } = ctx;
  const tab = useGameView(state, () => state.tab);
  const flowNode = positionOf(position).path;

  return (
    <div data-game="workspace">
      <DeviceToolbar ctx={ctx} />
      <div data-part="body">
        <Stage ctx={ctx} status={tools.status} />
        <SidePanel id={SIDE_PANEL} side="end" title={SIDE_TITLE} {...SIDE_SIZE}>
          <div data-game="side">
            <div role="tablist" data-tabs="" aria-label="Inspector">
              <button
                type="button"
                role="tab"
                id="game-tab-element"
                aria-controls="game-tab-panel"
                aria-selected={tab === "element"}
                onClick={() => setTab(state, "element")}
              >
                Element
              </button>
              <button
                type="button"
                role="tab"
                id="game-tab-device"
                aria-controls="game-tab-panel"
                aria-selected={tab === "device"}
                onClick={() => setTab(state, "device")}
              >
                Device
              </button>
            </div>
            <div
              role="tabpanel"
              id="game-tab-panel"
              aria-labelledby={tab === "element" ? "game-tab-element" : "game-tab-device"}
            >
              {tab === "element" ? (
                <ElementTab ctx={ctx} flowNode={flowNode} />
              ) : (
                <DeviceTab ctx={ctx} />
              )}
            </div>
          </div>
        </SidePanel>
      </div>
      <SeriesPopover ctx={ctx} />
      <CaptureCard ctx={ctx} />
      <ContactSheet ctx={ctx} />
    </div>
  );
}
