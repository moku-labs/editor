/**
 * @file overlay plugin — the Game tab (C4, F6): the game's overlay commands as toggle and button
 * rows, a toggle's choices under its switch, greyed with their reason when the build refuses them;
 * the READ-ONLY note; the press note or the toast.
 */
import type { VNode } from "preact";
import { Fragment } from "preact";
import type { OverlayActions } from "../actions";
import { COLOUR } from "../model/format";
import { READ_ONLY_NOTE } from "../model/game";
import type { GameChoice, GameRow, GameView } from "../model/types";
import { Legend, legendOf } from "./Legend";
import { Toast } from "./Toast";

/**
 * The choices of a toggle: a group of its own, because a button cannot hold a button, disabled and
 * titled with the row. `data-state` carries the row's state, so one rule greys the group.
 *
 * @param props - The row, its choices and the actions.
 * @param props.row - The row.
 * @param props.choices - Its choices.
 * @param props.actions - The actions.
 * @returns The group.
 */
function Choices(props: {
  readonly row: GameRow;
  readonly choices: readonly GameChoice[];
  readonly actions: OverlayActions;
}): VNode {
  const { row, choices, actions } = props;
  return (
    <div data-part="choices" data-state={row.state}>
      {choices.map(choice => (
        <button
          key={choice.value}
          type="button"
          data-choice={choice.value}
          data-current={choice.current ? "" : undefined}
          aria-pressed={choice.current}
          disabled={row.disabled}
          title={row.title}
          onClick={() => {
            actions.choose(row.id, choice.value);
          }}
        >
          {choice.value}
        </button>
      ))}
    </div>
  );
}

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
        <Fragment key={row.id}>
          <button
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
          {row.choices === undefined ? undefined : (
            <Choices row={row} choices={row.choices} actions={actions} />
          )}
        </Fragment>
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
