/**
 * @file overlay plugin — the Game tab (C4, F6): the game's overlay commands as toggle and button
 * rows, greyed with their reason when the build refuses them; the READ-ONLY note; the press note or
 * the toast.
 */
import type { VNode } from "preact";
import type { OverlayActions } from "../actions";
import { COLOUR } from "../model/format";
import { READ_ONLY_NOTE } from "../model/game";
import type { GameView } from "../model/types";
import { Legend, legendOf } from "./Legend";
import { Toast } from "./Toast";

/**
 * The Game tab.
 *
 * @param props - The Game view and the actions.
 * @param props.game - The Game view.
 * @param props.actions - The actions.
 * @returns The tab's content.
 */
export function GameTab(props: {
  readonly game: GameView;
  readonly actions: OverlayActions;
}): VNode {
  const { game, actions } = props;
  return (
    <>
      <div data-part="game-head">
        <div data-part="game-title">Game commands</div>
        <div data-part="game-by">{game.by}</div>
      </div>
      {game.rows.map(row => (
        <button
          key={row.id}
          type="button"
          data-command={row.id}
          data-state={row.state}
          aria-pressed={row.pressed}
          aria-disabled={row.disabled ? "true" : undefined}
          disabled={row.disabled}
          title={row.title}
          onClick={() => {
            actions.press(row.id);
          }}
        >
          <span data-part="name">
            <b>{row.name}</b>
            <span>{row.line}</span>
          </span>
          <span data-part="state">{row.legend}</span>
        </button>
      ))}
      {game.readOnly ? (
        <p data-part="game-note">
          <Legend legend={legendOf("READ-ONLY", COLOUR.ink2)} />
          <span>{READ_ONLY_NOTE}</span>
        </p>
      ) : undefined}
      {game.toast === undefined ? (
        <p data-part="press-note">Each press is written to the log as a mark.</p>
      ) : (
        <Toast toast={game.toast} />
      )}
    </>
  );
}
