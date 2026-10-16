/**
 * @file renderView components (connection) — the facts row of the bar (spec 09 § M7): label over
 * value cells — a device's OS, Browser, Build (with its debug and "engine differs" tags), Display,
 * Rate now (with the adaptive reason, calm or warn) and dpr or Address; the local preview's Browser,
 * Display, Rate now and dpr; "Source · No game running" when nothing runs.
 */
import type { JSX } from "preact";
import { activeSourcePlugin } from "../../../activeSource";
import { linkPlugin } from "../../../link";
import { factsOf } from "../../derive/connection";
import type { RenderViewCtx } from "../../types";
import { Tag } from "../parts";

/**
 * Props of `Facts`.
 */
export type FactsProps = { readonly ctx: RenderViewCtx };

/**
 * The facts row.
 *
 * @param props - ctx.
 * @returns The row.
 */
export function Facts(props: FactsProps): JSX.Element {
  const { ctx } = props;
  const activeSource = ctx.require(activeSourcePlugin);
  const source = ctx.state.mission.source ?? activeSource.current();
  const facts = factsOf({
    source,
    label: activeSource.label(),
    second: ctx.state.mission.second,
    computerEngine: ctx.require(linkPlugin).engine()
  });
  return (
    <dl data-facts>
      {facts.map(fact => (
        <div key={fact.label} data-fact={fact.label === "Rate now" ? "rate" : undefined}>
          <dt>{fact.label}</dt>
          <dd>
            <span>{fact.value}</span>
            {fact.em === undefined ? undefined : <em data-tone={fact.em.tone}>{fact.em.text}</em>}
            {fact.tags?.map(tag => (
              <Tag key={tag.text} tag={tag} />
            ))}
          </dd>
        </div>
      ))}
    </dl>
  );
}
