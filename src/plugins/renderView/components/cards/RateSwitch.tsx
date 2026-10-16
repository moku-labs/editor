/**
 * @file renderView components (cards) — the rate switch in the FPS card (spec 09 § M9 Rate switch):
 * a radio group "Frame rate on {name}" of 60, 120 and Adaptive (roving tabindex; the arrow keys move
 * and send), the pending line while `game.frameRate` is in flight, the answer line (✓ taken, a held
 * pin in warn, a refusal in red; the checked radio stays on the previous choice for both), and the
 * rate-now line with its reason.
 */
import type { JSX } from "preact";
import { activeSourcePlugin } from "../../../activeSource";
import { answerTone, checkedRate, rateCommandText, rateLine } from "../../derive/rate";
import type { RateChoice, RenderViewApi, RenderViewCtx } from "../../types";
import { Spinner } from "../parts";
import { start } from "../start";

/**
 * Props of `RateSwitch`.
 */
export type RateSwitchProps = { readonly ctx: RenderViewCtx; readonly api: RenderViewApi };

/** The radios, in order. */
const CHOICES: readonly (readonly [RateChoice, string])[] = [
  [60, "60"],
  [120, "120"],
  ["adaptive", "Adaptive"]
];

/** The step of each arrow key through the radios. */
const ARROWS: Readonly<Record<string, number>> = {
  ArrowLeft: -1,
  ArrowUp: -1,
  ArrowRight: 1,
  ArrowDown: 1
};

/**
 * The rate switch.
 *
 * @param props - ctx and the api.
 * @returns The switch and its lines.
 */
export function RateSwitch(props: RateSwitchProps): JSX.Element {
  const { ctx, api } = props;
  const { mission } = ctx.state;
  const name = ctx.require(activeSourcePlugin).label().name;
  const { pending, answer } = mission.rate;
  const checked = checkedRate(mission.second, answer);
  const focusable = checked ?? CHOICES[0]?.[0];
  const now = rateLine(mission.second);

  const onKeyDown = (event: KeyboardEvent): void => {
    const step = ARROWS[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const radios = [
      ...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>("[role='radio']")
    ];
    const at = radios.indexOf(event.target as HTMLElement);
    const next = radios[(at + step + radios.length) % radios.length];
    next?.focus();
    const choice = CHOICES[radios.indexOf(next as HTMLElement)]?.[0];
    if (choice !== undefined) start(ctx, api.setRate(choice));
  };

  return (
    <div data-rate>
      <div
        role="radiogroup"
        aria-label={`Frame rate on ${name}`}
        data-segmented="rate"
        onKeyDown={onKeyDown}
      >
        {CHOICES.map(([choice, label]) => (
          // biome-ignore lint/a11y/useSemanticElements: a segment is a button acting as a radio (design G segmented control; the arrow keys move and send)
          <button
            key={label}
            type="button"
            role="radio"
            aria-checked={checked === choice}
            tabIndex={focusable === choice ? 0 : -1}
            onClick={() => start(ctx, api.setRate(choice))}
          >
            {label}
          </button>
        ))}
      </div>
      {now === undefined ? undefined : (
        <p data-rate-now data-tone={now.tone} role="status">
          {now.text}
        </p>
      )}
      {pending === undefined ? undefined : (
        <p data-rate-answer="pending" role="status">
          <Spinner />
          <code>{rateCommandText(pending)}</code>
          sent to {name}…
        </p>
      )}
      {pending !== undefined || answer === undefined ? undefined : (
        <p data-rate-answer={answerTone(answer)} role="status">
          <code>{rateCommandText(answer.choice)}</code>
          {answer.ok ? <b>✓</b> : undefined}
          {answer.text}
        </p>
      )}
    </div>
  );
}
