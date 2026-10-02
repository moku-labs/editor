/**
 * @file gameView plugin — the Game panel (definePanel data) and the GameWorkspace root, which
 * is composition only (commands run through panels.run, R9).
 */
import type { VNode } from "preact";
import type { PanelSpec, PanelTools } from "../../panels/types";
import type { Json } from "../../registry/protocol";
import type { GameCommands, GameViewCtx } from "../types";

/**
 * Props of the Game workspace root.
 */
export type GameWorkspaceProps = {
  readonly ctx: GameViewCtx;
  readonly position: Json;
  readonly tools: PanelTools<GameCommands>;
};

/**
 * The Game panel: source game.position; commands capture, series, seriesStop.
 *
 * @param _ctx - Domain context of gameView.
 * @example
 * ```ts
 * ctx.require(panelsPlugin).register(createGamePanel(ctx));
 * ```
 */
export function createGamePanel(_ctx: GameViewCtx): PanelSpec {
  throw new Error("not implemented");
}

/**
 * The Game workspace root: toolbar, stage, side panel, floats.
 *
 * @param _props - Plugin context, the position value and the panel tools.
 * @example
 * ```tsx
 * <GameWorkspace ctx={ctx} position={values.position} tools={tools} />
 * ```
 */
export function GameWorkspace(_props: GameWorkspaceProps): VNode {
  throw new Error("not implemented");
}
