/**
 * @file gameView plugin — the Element tab (C7) and the Element F5 strings: empty state, render-tree
 * breadcrumb, name and type, bounds with the device, texture with its manifest data, entity,
 * children, the resolved style, the layout style card with its steppers (or the read-only call,
 * or where the key is defined, `(loop)` for a key built in a loop), the Code section (round 2b
 * R12), the reference block for the chat with Copy (round 2 R2), "Show in render tree"
 * (workspace:reveal) and "Pick another".
 */
import type { VNode } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { ElementRef, SceneNode, SceneSnapshot } from "../../panels/shared/scene";
import { ancestorsOf, refId } from "../../panels/shared/scene";
import type { StyleField } from "../../panels/shared/style-edit";
import { fieldRule, formatNumber } from "../../panels/shared/style-edit";
import { workspacePlugin } from "../../workspace";
import { resolveDevice } from "../../workspace/devices";
import {
  highlightElement,
  openInFiles,
  revealElement,
  selectElement,
  setPicker
} from "../element/select";
import { openStyleCard, stepStyle, styleErrorText } from "../element/styles";
import { referenceText } from "../reference/facts";
import { copySelectedReference } from "../reference/pick";
import { readManifest } from "../scene/manifest";
import type { GameViewCtx, StyleCard, StyleLookup } from "../types";
import { CodeSection } from "./CodeSection";
import { styleValue } from "./text";
import { useGameView } from "./useGameView";

/**
 * Props of `ElementTab`: the context and "<flow>/<node>" of the game position (the panel's
 * `game.position`), undefined when not known.
 */
export type ElementTabProps = { readonly ctx: GameViewCtx; readonly flowNode?: string | undefined };

/**
 * A chip that selects an element and draws the pink box while hovered.
 *
 * @param props - The context, the node and its label.
 * @param props.ctx - Domain context of gameView.
 * @param props.node - The node.
 * @returns The chip button.
 */
function NodeChip(props: { readonly ctx: GameViewCtx; readonly node: SceneNode }): VNode {
  const { ctx, node } = props;
  return (
    <button
      type="button"
      data-chip=""
      onClick={() => selectElement(ctx, node.ref)}
      onPointerEnter={() => highlightElement(ctx, node.ref)}
      onPointerLeave={() => highlightElement(ctx)}
      onFocus={() => highlightElement(ctx, node.ref)}
      onBlur={() => highlightElement(ctx)}
    >
      {node.name}
    </button>
  );
}

/**
 * One field of the style card: a stepper when the shared module has a rule, else read-only.
 *
 * @param props - The context, the card and the field.
 * @param props.ctx - Domain context of gameView.
 * @param props.card - The style card.
 * @param props.field - The field.
 * @returns The field row.
 */
function FieldRow(props: {
  readonly ctx: GameViewCtx;
  readonly card: StyleCard;
  readonly field: StyleField;
}): VNode {
  const { ctx, card, field } = props;
  const editable = field.kind === "number" && fieldRule(card.ref, field.path) !== undefined;
  const pending = card.pending?.path === field.path ? card.pending.next : undefined;
  const value = pending === undefined ? field.raw : formatNumber(pending);
  return (
    <div data-field={field.path}>
      <dt>{field.path}</dt>
      <dd>
        {editable && (
          <button
            type="button"
            aria-label={`Decrease ${field.path}`}
            onClick={event => stepStyle(ctx, field.path, -1, event.shiftKey)}
          >
            −
          </button>
        )}
        <output>{value}</output>
        {editable && (
          <button
            type="button"
            aria-label={`Increase ${field.path}`}
            onClick={event => stepStyle(ctx, field.path, 1, event.shiftKey)}
          >
            +
          </button>
        )}
      </dd>
    </div>
  );
}

/**
 * The layout style card: where, Open in Files, the block lines with a gutter, the fields, a
 * refusal line.
 *
 * @param props - The context and the card.
 * @param props.ctx - Domain context of gameView.
 * @param props.card - The style card.
 * @returns The card body.
 */
function StyleCardView(props: { readonly ctx: GameViewCtx; readonly card: StyleCard }): VNode {
  const { ctx, card } = props;
  const { block } = card;
  const lines = card.current.text.split("\n").slice(block.line - 1, block.endLine);
  return (
    <>
      <header>
        <code data-part="where">
          {card.path}:{block.line}
        </code>
        <button type="button" onClick={() => openInFiles(ctx, card.path, block.line)}>
          Open in Files
        </button>
      </header>
      <ol data-part="lines" aria-label="Style block">
        {lines.map((text, index) => (
          <li key={block.line + index} data-part="line">
            <span data-part="gutter">{block.line + index}</span>
            <code>{text}</code>
          </li>
        ))}
      </ol>
      <dl data-part="fields">
        {block.fields.map(field => (
          <FieldRow key={field.path} ctx={ctx} card={card} field={field} />
        ))}
      </dl>
      {card.error !== undefined && (
        <p data-part="error" role="alert">
          {styleErrorText(card.error)}
        </p>
      )}
    </>
  );
}

/**
 * The read-only card of a style computed by a call: where the call is, Open in Files, the call.
 *
 * @param props - The context and the call lookup.
 * @param props.ctx - Domain context of gameView.
 * @param props.lookup - The lookup with status "call".
 * @returns The card body.
 */
function CallCard(props: {
  readonly ctx: GameViewCtx;
  readonly lookup: Extract<StyleLookup, { readonly status: "call" }>;
}): VNode {
  const { ctx, lookup } = props;
  return (
    <>
      <header>
        <code data-part="where">
          {lookup.path}:{lookup.line}
        </code>
        <button type="button" onClick={() => openInFiles(ctx, lookup.path, lookup.line)}>
          Open in Files
        </button>
      </header>
      <code data-part="call">{lookup.call}</code>
      <p data-part="read-only">Computed by a call · read-only</p>
    </>
  );
}

/**
 * What the style card section says while no card is shown: the search failed, found a style
 * call (read-only card), found the key without a style ("Defined at"), found nothing, or still
 * runs.
 *
 * @param props - The context, the lookup and the ui key.
 * @param props.ctx - Domain context of gameView.
 * @param props.lookup - The style search of the selected element.
 * @param props.nodeKey - The ui key.
 * @returns The note.
 */
function LookupNote(props: {
  readonly ctx: GameViewCtx;
  readonly lookup: StyleLookup | undefined;
  readonly nodeKey: string;
}): VNode {
  const { ctx, lookup, nodeKey } = props;
  if (lookup?.status === "failed") {
    return (
      <p data-part="error" role="alert">
        {styleErrorText(lookup.error)}{" "}
        <button type="button" onClick={() => openInFiles(ctx, lookup.path, lookup.error.line ?? 1)}>
          Open in Files
        </button>
      </p>
    );
  }
  if (lookup?.status === "call") return <CallCard ctx={ctx} lookup={lookup} />;
  if (lookup?.status === "defined") {
    return (
      <p data-part="defined">
        Defined at{" "}
        <code data-part="where">
          {lookup.path}:{lookup.line}
        </code>{" "}
        {lookup.loop === true && <span data-part="loop">(loop) </span>}
        <button type="button" onClick={() => openInFiles(ctx, lookup.path, lookup.line)}>
          Open in Files
        </button>
      </p>
    );
  }
  if (lookup?.status === "missing") return <p>Source not found for key {nodeKey}</p>;
  return <p>Searching the sources for {nodeKey}…</p>;
}

/**
 * The style card section of a keyed ui node: searching, missing, refused, or the card.
 *
 * @param props - The context and the ui key.
 * @param props.ctx - Domain context of gameView.
 * @param props.nodeKey - The ui key.
 * @returns The section.
 */
function StyleSection(props: { readonly ctx: GameViewCtx; readonly nodeKey: string }): VNode {
  const { ctx, nodeKey } = props;
  const { styles, lookup } = ctx.state;
  return (
    <section data-part="style-card" aria-label="Layout style">
      {styles === undefined ? (
        <LookupNote ctx={ctx} lookup={lookup} nodeKey={nodeKey} />
      ) : (
        <StyleCardView ctx={ctx} card={styles} />
      )}
    </section>
  );
}

/**
 * The texture box: the key, and from the manifest `w×h · GPU MB · bundle`.
 *
 * @param props - The context and the texture key.
 * @param props.ctx - Domain context of gameView.
 * @param props.texture - The texture key.
 * @returns The box.
 */
function TextureBox(props: { readonly ctx: GameViewCtx; readonly texture: string }): VNode {
  const { ctx, texture } = props;
  const info = ctx.state.manifest?.textures.get(texture);
  return (
    <section data-part="texture" aria-label="Texture">
      <h4>Texture</h4>
      <code data-tag="">{texture}</code>
      {info !== undefined && (
        <span>
          {info.width}×{info.height} · {info.gpuMb.toFixed(2)} MB · {info.bundle}
        </span>
      )}
    </section>
  );
}

/**
 * The full reference block of the node, read-only, with Copy (round 2 R2): Copy writes the card
 * and puts its one line on the clipboard (round 2b R13). It is gathered again when the node, its
 * style search, its style block, its bounds, the flow node or the last pick changes; not on every
 * scene frame.
 *
 * @param props - The context, the scene, the node and the flow node.
 * @param props.ctx - Domain context of gameView.
 * @param props.scene - The scene.
 * @param props.node - The selected node.
 * @param props.flowNode - "<flow>/<node>" of the game position (a change gathers again).
 * @returns The section.
 */
function ReferenceSection(props: {
  readonly ctx: GameViewCtx;
  readonly scene: SceneSnapshot;
  readonly node: SceneNode;
  readonly flowNode: string | undefined;
}): VNode {
  const { ctx, scene, node, flowNode } = props;
  const { state } = ctx;
  const [text, setText] = useState<string | undefined>();
  const block = node.key === undefined ? undefined : state.blocks.get(node.key);
  const where = block === undefined ? undefined : `${block.path}:${block.line}`;
  const bounds = node.rect === undefined ? undefined : Object.values(node.rect).join(",");
  useEffect(() => {
    let alive = true;
    referenceText(ctx, node, scene).then(
      next => {
        if (alive) setText(next);
      },
      (error: unknown) => {
        ctx.log.warn("gameView: reference block failed", { error });
      }
    );
    return () => {
      alive = false;
    };
  }, [node.id, state.lookup?.status, where, bounds, flowNode, state.pick]);

  return (
    <section data-part="reference-block" aria-label="Reference">
      <header>
        <h4>Reference</h4>
        <button
          type="button"
          data-variant="ghost"
          data-action="copy-reference"
          title="Write the reference card and copy its line for the chat"
          onClick={() => void copySelectedReference(ctx)}
        >
          Copy
        </button>
      </header>
      <pre data-part="reference" aria-busy={text === undefined}>
        {text ?? "Gathering the reference…"}
      </pre>
    </section>
  );
}

/**
 * The filled tab for one node.
 *
 * @param props - The context, the scene, the node and the flow node.
 * @param props.ctx - Domain context of gameView.
 * @param props.scene - The scene.
 * @param props.node - The selected node.
 * @param props.flowNode - "<flow>/<node>" of the game position.
 * @returns The tab body.
 */
function NodeDetails(props: {
  readonly ctx: GameViewCtx;
  readonly scene: SceneSnapshot;
  readonly node: SceneNode;
  readonly flowNode: string | undefined;
}): VNode {
  const { ctx, scene, node, flowNode } = props;
  const choice = ctx.require(workspacePlugin).device();
  const size = resolveDevice(choice.preset, choice.orientation);
  const ancestors = ancestorsOf(scene, node.id).flatMap(id => scene.nodes.get(id) ?? []);
  const children = node.children.flatMap(id => scene.nodes.get(id) ?? []);
  const style = node.style === undefined ? [] : Object.entries(node.style);

  return (
    <div data-part="element">
      <nav data-part="crumbs" aria-label="Render tree path">
        {ancestors.map(ancestor => (
          <NodeChip key={ancestor.id} ctx={ctx} node={ancestor} />
        ))}
      </nav>
      <header>
        <h3 data-part="name">{node.name}</h3>
        <span data-tag="" data-part="type">
          {node.type}
        </span>
      </header>
      <section aria-label="Bounds">
        <h4>Bounds</h4>
        {node.rect === undefined ? (
          <p>Not placed on screen.</p>
        ) : (
          <dl data-part="bounds">
            <dt>x</dt>
            <dd>{Math.round(node.rect.x)}</dd>
            <dt>y</dt>
            <dd>{Math.round(node.rect.y)}</dd>
            <dt>w</dt>
            <dd>{Math.round(node.rect.w)}</dd>
            <dt>h</dt>
            <dd>{Math.round(node.rect.h)}</dd>
          </dl>
        )}
        <p data-part="device">
          {choice.preset.name} {choice.orientation} · {size.w}×{size.h}
        </p>
      </section>
      {node.texture !== undefined && <TextureBox ctx={ctx} texture={node.texture} />}
      {node.entity !== undefined && (
        <section data-part="entity" aria-label="Entity">
          <h4>Entity</h4>
          <dl>
            <dt>id</dt>
            <dd>{node.entity.id}</dd>
            <dt>owner</dt>
            <dd>{node.entity.owner}</dd>
          </dl>
          <div>
            {node.entity.components.map(component => (
              <span key={component} data-chip="">
                {component}
              </span>
            ))}
          </div>
        </section>
      )}
      {children.length > 0 && (
        <section data-part="children" aria-label="Children">
          <h4>Children</h4>
          {children.map(child => (
            <NodeChip key={child.id} ctx={ctx} node={child} />
          ))}
        </section>
      )}
      <section data-part="style" aria-label="Styles">
        <h4>Styles</h4>
        {style.length === 0 ? (
          <p>No style of its own.</p>
        ) : (
          <dl data-props="">
            {style.map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{styleValue(value)}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
      {node.ref.kind === "ui" && node.key !== undefined && (
        <StyleSection ctx={ctx} nodeKey={node.key} />
      )}
      <CodeSection key={node.id} ctx={ctx} node={node} />
      <ReferenceSection ctx={ctx} scene={scene} node={node} flowNode={flowNode} />
      <footer>
        <button type="button" data-variant="ghost" onClick={() => revealElement(ctx, node.ref)}>
          Show in render tree
        </button>
        <button type="button" data-variant="ghost" onClick={() => setPicker(ctx, true)}>
          Pick another
        </button>
      </footer>
    </div>
  );
}

/**
 * Loads what the tab shows for the selected element: its style card and the texture catalogue.
 *
 * @param ctx - Domain context of gameView.
 * @param selected - The selected element.
 * @param texture - Its texture key.
 */
function loadDetails(
  ctx: GameViewCtx,
  selected: ElementRef | undefined,
  texture: string | undefined
): void {
  if (selected !== undefined) {
    openStyleCard(ctx, selected).catch((error: unknown) => {
      ctx.log.warn("gameView: style card failed", { error });
    });
  }
  if (texture !== undefined && ctx.state.manifest === undefined) {
    readManifest(ctx).catch((error: unknown) => {
      ctx.log.warn("gameView: manifest failed", { error });
    });
  }
}

/**
 * The Element tab.
 *
 * @param props - The gameView domain context.
 * @returns The tab.
 */
export function ElementTab(props: ElementTabProps): VNode {
  const { ctx } = props;
  const flowNode = props.flowNode ?? ctx.state.reference.node;
  const { state } = ctx;
  useGameView(state, () => state.selected);
  const { selected, scene } = state;
  const id = selected === undefined ? undefined : refId(selected);
  const node = id === undefined ? undefined : scene?.nodes.get(id);
  const placed = node !== undefined;
  useEffect(() => loadDetails(ctx, selected, node?.texture), [id, placed]);

  if (selected === undefined) {
    return (
      <div data-part="element" data-empty="">
        <button type="button" data-variant="primary" onClick={() => setPicker(ctx, true)}>
          Select element <kbd>⇧⌘C</kbd>
        </button>
        <p>
          Pick an element in the game to see its place in the render tree, its bounds, texture and
          styles.
        </p>
      </div>
    );
  }
  if (scene === undefined || node === undefined) {
    return (
      <div data-part="element">
        <p>Waiting for the scene of the selected element…</p>
      </div>
    );
  }
  return <NodeDetails ctx={ctx} scene={scene} node={node} flowNode={flowNode} />;
}
