/**
 * @file workspace plugin — D2, the registry popover (top layer, Esc layer `registry`): what the
 * game registered: sources (id, title, inputs, change tag) and commands (id, title, inputs,
 * effect tag; `route` in accent). It opens under the Registry button, or under the ⋯ button in
 * the compact bar.
 */
import type { VNode } from "preact";
import { linkPlugin } from "../../link";
import { Icon } from "../../panels/shared/icons";
import type { Effect } from "../../registry/protocol";
import { closePopover } from "../actions";
import type { WorkspaceCtx } from "../types";
import { usePopover } from "./popover";
import { useElement, useWorkspace } from "./store";
import { schemaText } from "./text";

/**
 * Props of `RegistryPopover`.
 */
export type RegistryPopoverProps = {
  readonly ctx: WorkspaceCtx;
  /** The `data-popover-anchor` it opens under; default "registry". */
  readonly anchor?: string;
};

/**
 * Tag tone of every command effect.
 */
const EFFECT_TONE: Readonly<Record<Effect, string>> = {
  read: "mut",
  route: "acc",
  cosmetic: "mut",
  cheat: "warn",
  raw: "err"
};

/**
 * The registry popover.
 *
 * @param props - The workspace domain context.
 * @returns The popover.
 */
export function RegistryPopover(props: RegistryPopoverProps): VNode {
  const { ctx } = props;
  const { state } = ctx;
  useWorkspace(state.ui, () => state.ui.version);
  const element = useElement<HTMLElement>();
  const open = state.popover === "registry";
  usePopover(element, open, state, props.anchor ?? "registry");
  const manifest = ctx.require(linkPlugin).manifest();

  return (
    <section data-ui="registry-popover" popover="manual" aria-label="Registry" ref={element.ref}>
      {open && (
        <>
          <header>
            <h2>
              Registry · <span data-mono>{manifest?.game ?? "no game"}</span> · what the game
              registered
            </h2>
            <button
              type="button"
              data-variant="ghost"
              data-size="sm"
              aria-label="Close"
              onClick={() => closePopover(state, "registry")}
            >
              <Icon name="close" />
            </button>
          </header>
          {manifest === undefined ? (
            <p data-muted>No game connected.</p>
          ) : (
            <div data-columns>
              <section aria-label="Sources">
                <h3>
                  Sources <span>{manifest.sources.length}</span>
                </h3>
                <ul>
                  {manifest.sources.map(source => (
                    <li key={source.id}>
                      <span data-mono>{source.id}</span>
                      <span>{source.title}</span>
                      <span data-mono data-muted>
                        {schemaText(source.input)}
                      </span>
                      <span data-tag="mut">{source.changes}</span>
                    </li>
                  ))}
                </ul>
              </section>
              <section aria-label="Commands">
                <h3>
                  Commands <span>{manifest.commands.length}</span>
                </h3>
                <ul>
                  {manifest.commands.map(command => (
                    <li key={command.id}>
                      <span data-mono>{command.id}</span>
                      <span>{command.title}</span>
                      <span data-mono data-muted>
                        {schemaText(command.input)}
                      </span>
                      <span data-tag={EFFECT_TONE[command.effect]}>{command.effect}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          )}
        </>
      )}
    </section>
  );
}
