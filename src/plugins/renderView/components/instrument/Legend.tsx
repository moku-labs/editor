/**
 * @file renderView components (instrument) — the legend under the instrument (spec 09 § M8 Legend):
 * the bar parts (JS, GPU — "off" or "not measured" when it is —, rest, GC pause), the budget lines,
 * one flag swatch per spike cause in its tools-page colour (`MISSION_CAUSE`), the GC and rate-change
 * marks, and the Passes lane's views in their lane colours with the compile mark.
 */
import type { JSX } from "preact";
import { graphFlags } from "../../derive/mission";
import { passesSummaryOf } from "../../source/contract";
import { paintedScene } from "../../timeline/loop";
import type { PaletteKey } from "../../timeline/palette";
import { laneColourKey } from "../../timeline/scene";
import type { RenderViewCtx } from "../../types";

/**
 * Props of `Legend`.
 */
export type LegendProps = { readonly ctx: RenderViewCtx };

/** A legend entry's mark: a square, a line, a dashed line, a diamond or a flag swatch. */
type Mark = "square" | "line" | "dash" | "diamond" | "flag";

/**
 * Props of `Item`.
 */
type ItemProps = { readonly mark: Mark; readonly colour: PaletteKey; readonly text: string };

/**
 * One legend entry.
 *
 * @param props - Its mark, colour and words.
 * @returns The entry.
 */
function Item(props: ItemProps): JSX.Element {
  return (
    <span data-item>
      <i data-mark={props.mark} data-colour={props.colour} aria-hidden="true" />
      {props.text}
    </span>
  );
}

/** The spike causes in their tools-page colours (spec 09 § M8 `MISSION_CAUSE`). */
const CAUSES: readonly (readonly [PaletteKey, string])[] = [
  ["warn", "JS over budget"],
  ["pickPink", "GPU sustained"],
  ["phase2", "Upload ≥ 1 MB"],
  ["pickBlue", "Shader compile"],
  ["error", "Long frame"]
];

/** The GPU entry's words by the GPU's state. */
const GPU_WORDS = { on: "GPU", off: "GPU (off)", "not-measured": "GPU (not measured)" } as const;

/**
 * The legend.
 *
 * @param props - ctx.
 * @returns The legend.
 */
export function Legend(props: LegendProps): JSX.Element {
  const { ctx } = props;
  const { mission } = ctx.state;
  const flags = graphFlags(mission);
  const summary = mission.passes ? passesSummaryOf(mission.passes) : undefined;
  const views: string[] = [];
  for (const pass of summary?.heaviest?.passes ?? []) {
    const view = pass.view ?? pass.kind;
    if (!views.includes(view)) views.push(view);
  }
  const scene = paintedScene(mission);
  return (
    <div data-legend>
      <Item mark="square" colour="phase3" text="JS" />
      <Item mark="square" colour="phase1" text={GPU_WORDS[flags.gpu]} />
      <Item mark="square" colour="edge" text="Rest, game idle (not a problem)" />
      <Item mark="square" colour="teal" text="GC pause" />
      <Item mark="line" colour="text2" text="Frame budget" />
      <Item mark="dash" colour="muted" text="Rest budget" />
      {CAUSES.map(([colour, text]) => (
        <Item key={text} mark="flag" colour={colour} text={text} />
      ))}
      <Item mark="diamond" colour="teal" text="GC, freed MB" />
      <Item mark="dash" colour="warn" text="Adaptive rate change" />
      <span data-part="lane">Passes lane</span>
      {views.map((view, index) => (
        <Item key={view} mark="square" colour={laneColourKey(scene, view, index)} text={view} />
      ))}
      <Item mark="diamond" colour="pickBlue" text="Shader compile" />
    </div>
  );
}
