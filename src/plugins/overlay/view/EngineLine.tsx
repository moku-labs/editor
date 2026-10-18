/**
 * @file overlay plugin — the engine line (B3): the page's engine and profile, STALE, the build.
 */
import type { VNode } from "preact";
import { COLOUR } from "../model/format";
import type { EngineLineView } from "../model/types";
import { Legend, legendOf } from "./Legend";

/**
 * The engine line, fixed above the key bar on the Frames tab, or inline under the Link tab's live
 * box.
 *
 * @param props - The engine line and where it sits.
 * @param props.engine - The engine line view.
 * @param props.inline - Inline in the Link tab.
 * @returns The engine line.
 */
export function EngineLine(props: {
  readonly engine: EngineLineView;
  readonly inline: boolean;
}): VNode {
  const { engine } = props;
  return (
    <div
      data-part="engine"
      data-stale={engine.stale ? "" : undefined}
      data-inline={props.inline ? "" : undefined}
    >
      <div>
        <span>
          engine <b data-part="engine-id">{engine.engine}</b>
        </span>
        <span data-part="profile">{engine.profile}</span>
        {engine.stale ? <Legend legend={legendOf("STALE", COLOUR.caution, true)} /> : undefined}
      </div>
      <div>
        <span>
          build <b>{engine.build}</b>
        </span>
      </div>
    </div>
  );
}
