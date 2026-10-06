/**
 * @file gameView plugin — the Code section of the Element tab (round 2b R12): a ui element's JSX
 * and the style block it uses, each with `file:line`, Open in Files and the shared highlighter
 * (20 lines, then "Show all"); an entity's projection with the line that defines it (or why the
 * project index has none), and its components with their values. Read again when the element,
 * its source or its style file changes, and for an entity on every new project state.
 */
import type { VNode } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { linkPlugin } from "../../link";
import { langOf, renderTokens, tokenizeLines } from "../../panels/shared/highlight";
import { notFoundText } from "../../panels/shared/project";
import type { SceneNode } from "../../panels/shared/scene";
import type { ProjectState } from "../../registry/protocol";
import { elementCode } from "../element/code";
import { openInFiles } from "../element/select";
import type { CodeSnippet, ElementCode, GameViewCtx } from "../types";

/**
 * Props of `CodeSection`: the context and the selected node.
 */
export type CodeSectionProps = { readonly ctx: GameViewCtx; readonly node: SceneNode };

/**
 * The lines a snippet shows before "Show all".
 */
const SHOWN_LINES = 20;

/**
 * One snippet: its title, `file:line`, Open in Files and the highlighted lines with a gutter.
 *
 * @param props - The context, the title and the snippet.
 * @param props.ctx - Domain context of gameView.
 * @param props.title - "JSX", "Style · coinPill".
 * @param props.snippet - The lines and where they are.
 * @returns The snippet.
 */
function SnippetView(props: {
  readonly ctx: GameViewCtx;
  readonly title: string;
  readonly snippet: CodeSnippet;
}): VNode {
  const { ctx, title, snippet } = props;
  const { path, line } = snippet;
  const [all, setAll] = useState(false);
  const lines = useMemo(
    () => tokenizeLines(snippet.lines.join("\n"), langOf(path)),
    [path, snippet.lines]
  );
  const shown = all ? lines : lines.slice(0, SHOWN_LINES);

  return (
    <div data-part="snippet">
      <header>
        <span data-part="title">{title}</span>
        <code data-part="where">
          {path}:{line}
        </code>
        <button type="button" onClick={() => openInFiles(ctx, path, line)}>
          Open in Files
        </button>
      </header>
      <div data-part="code-lines">
        {shown.map((tokens, index) => (
          <div key={`${line + index}`} data-line={line + index}>
            <span data-part="gutter">{line + index}</span>
            <code>{renderTokens(tokens)}</code>
          </div>
        ))}
      </div>
      {shown.length < lines.length && (
        <button
          type="button"
          data-variant="ghost"
          data-action="show-all"
          onClick={() => setAll(true)}
        >
          Show all {lines.length} lines
        </button>
      )}
    </div>
  );
}

/**
 * The entity part: the projection that spawns it with its definition (or why the index has
 * none), and its components.
 *
 * @param props - The context and the entity code.
 * @param props.ctx - Domain context of gameView.
 * @param props.code - The entity code.
 * @returns The part.
 */
function EntityCode(props: {
  readonly ctx: GameViewCtx;
  readonly code: Extract<ElementCode, { readonly kind: "entity" }>;
}): VNode {
  const { ctx, code } = props;
  const { spawn } = code;
  return (
    <>
      <p data-part="spawn">
        Spawned by <code>{code.projection}</code>
        {" · "}
        {spawn === undefined ? (
          <span data-part="not-found">
            {notFoundText(ctx.require(linkPlugin).project(), `projection:${code.projection}`)}
          </span>
        ) : (
          <button
            type="button"
            data-variant="ghost"
            title="Open in Files"
            onClick={() => openInFiles(ctx, spawn.path, spawn.line)}
          >
            {spawn.path}:{spawn.line}
          </button>
        )}
      </p>
      <dl data-part="components">
        {code.components.map(row => (
          <div key={row.name}>
            <dt>{row.name}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

/**
 * Which project state an entity's projection was last asked of: the revision when the index is
 * on, the reason when it is off, undefined before the first state. A new value asks again, so an
 * entity picked before the first state, or before the index knew its projection, follows.
 *
 * @param project - The project state (`link.project()`).
 * @returns The revision, `off: <reason>`, or undefined.
 * @example
 * ```ts
 * projectStamp({ state: "off", reason: "typescript is not installed" }); // "off: typescript is not installed"
 * ```
 */
function projectStamp(project: ProjectState | undefined): string | undefined {
  if (project === undefined) return undefined;
  return project.state === "on" ? project.revision : `off: ${project.reason}`;
}

/**
 * The Code section; nothing until the code is read, nothing for a ui element whose source is
 * not found. An entity's projection is asked again on every project state.
 *
 * @param props - The context and the selected node.
 * @returns The section, undefined while there is nothing to show.
 */
export function CodeSection(props: CodeSectionProps): VNode | undefined {
  const { ctx, node } = props;
  const { state } = ctx;
  const [code, setCode] = useState<ElementCode | undefined>();
  const found = node.key === undefined ? undefined : state.found.get(node.key);
  const source = found === undefined ? undefined : `${found.path}:${found.line}`;
  const version = state.styles?.current.version;
  const stamp =
    node.entity === undefined ? undefined : projectStamp(ctx.require(linkPlugin).project());
  useEffect(() => {
    let alive = true;
    elementCode(ctx, node).then(
      next => {
        if (alive) setCode(next);
      },
      (error: unknown) => {
        ctx.log.warn("gameView: element code failed", { error });
      }
    );
    return () => {
      alive = false;
    };
  }, [node.id, state.lookup?.status, source, version, stamp]);

  if (code === undefined) return undefined;
  if (code.kind === "ui" && code.jsx === undefined && code.style === undefined) return undefined;
  return (
    <section data-part="code" aria-label="Code">
      <h4>Code</h4>
      {code.kind === "entity" ? (
        <EntityCode ctx={ctx} code={code} />
      ) : (
        <>
          {code.jsx !== undefined && <SnippetView ctx={ctx} title="JSX" snippet={code.jsx} />}
          {code.style !== undefined && (
            <SnippetView ctx={ctx} title={`Style · ${code.style.name}`} snippet={code.style} />
          )}
        </>
      )}
    </section>
  );
}
