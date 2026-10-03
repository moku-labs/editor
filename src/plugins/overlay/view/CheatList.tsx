/**
 * @file overlay plugin — the cheat buttons: one native button per one-click cheat.
 */
import type { VNode } from "preact";
import type { CheatView } from "../types";

/**
 * Props of `CheatList`.
 *
 * @example
 * ```ts
 * const props: CheatListProps = { cheats: view.cheats, onCheat: id => runCheat(octx, id) };
 * ```
 */
export type CheatListProps = {
  readonly cheats: readonly CheatView[];
  readonly onCheat: (id: string) => void;
};

/**
 * The text mark of a result state, so colour is never the only signal.
 */
const MARKS: Readonly<Record<CheatView["state"], string>> = {
  idle: "",
  busy: "",
  ok: "✓",
  error: "!"
};

/**
 * One cheat button. Busy buttons are disabled and `aria-busy`; an error shows its message as
 * the title.
 *
 * @param props - The cheat and the click handler.
 * @param props.cheat - The cheat as painted.
 * @param props.onCheat - Called with the cheat id on click, Enter or Space.
 * @returns The list item.
 * @example
 * ```tsx
 * <CheatButton cheat={cheat} onCheat={onCheat} />
 * ```
 */
function CheatButton(props: {
  readonly cheat: CheatView;
  readonly onCheat: (id: string) => void;
}): VNode {
  const { cheat, onCheat } = props;
  const busy = cheat.state === "busy";
  const mark = MARKS[cheat.state];

  /**
   * Passes the click on with the cheat id.
   */
  const click = (): void => {
    onCheat(cheat.id);
  };

  return (
    <li>
      <button
        type="button"
        data-cheat={cheat.id}
        data-state={cheat.state}
        aria-busy={busy ? "true" : undefined}
        disabled={busy}
        title={cheat.message}
        onClick={click}
      >
        <span data-label="">{cheat.title}</span>
        {mark === "" ? undefined : <span data-mark="">{mark}</span>}
      </button>
    </li>
  );
}

/**
 * The cheat list, or the muted line "No cheats registered".
 *
 * @param props - The cheats and the click handler.
 * @returns The list.
 * @example
 * ```tsx
 * <CheatList cheats={view.cheats} onCheat={id => runCheat(octx, id)} />
 * ```
 */
export function CheatList(props: CheatListProps): VNode {
  if (props.cheats.length === 0) return <p data-empty="">No cheats registered</p>;

  return (
    <ul data-cheats="">
      {props.cheats.map(cheat => (
        <CheatButton key={cheat.id} cheat={cheat} onCheat={props.onCheat} />
      ))}
    </ul>
  );
}
