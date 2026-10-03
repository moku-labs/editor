/**
 * @file filesView plugin — the code viewer: a 34 px gutter with line numbers and the lines
 * coloured by the shared highlighter (`tokenizeLines` + `renderTokens`, R4); the tab's line is
 * marked and scrolled to the centre once; above WINDOW_LINES only the visible lines ± 50 render;
 * above `maxHighlightChars` the text has no colour.
 */
import type { VNode } from "preact";
import { useEffect, useLayoutEffect, useMemo, useState } from "preact/hooks";
import type { Lang, Token } from "../../panels/shared/highlight";
import { renderTokens, tokenizeLines } from "../../panels/shared/highlight";
import { WINDOW_LINES } from "../types";
import { useElement } from "./useFiles";

/**
 * Lines rendered above and below the visible ones in a windowed view.
 */
const OVERSCAN = 50;

/**
 * Line height before one is measured: Geist Mono 11.5 / 1.62.
 */
const DEFAULT_LINE_HEIGHT = 18.63;

/**
 * Viewport height before one is measured.
 */
const DEFAULT_VIEWPORT = 800;

/**
 * Props of `CodeView`.
 *
 * @example
 * ```tsx
 * <CodeView path="nodes/merge.ts" text={text} lang="script" line={12} maxHighlightChars={512_000} />
 * ```
 */
export type CodeViewProps = {
  readonly path: string;
  readonly text: string;
  readonly lang: Lang;
  /** 1-based line to mark and reveal. */
  readonly line: number | undefined;
  readonly maxHighlightChars: number;
};

/**
 * One rendered line.
 */
type Line = { readonly number: number; readonly tokens: readonly Token[] };

/**
 * The token lines of a text: coloured, or one plain token per line when colour is off.
 *
 * @param text - The file text.
 * @param lang - The language.
 * @param colour - Whether to colour.
 * @returns One token array per line.
 * @example
 * ```ts
 * tokenLines("a\nb", "plain", false); // [[{ text: "a", kind: "plain" }], [{ text: "b", kind: "plain" }]]
 * ```
 */
export function tokenLines(text: string, lang: Lang, colour: boolean): Token[][] {
  return colour
    ? tokenizeLines(text, lang)
    : text.split(/\r?\n/).map(line => [{ text: line, kind: "plain" as const }]);
}

/**
 * The lines of a window, numbered.
 *
 * @param lines - Every token line.
 * @param first - First index (0-based).
 * @param last - Index after the last one.
 * @returns The numbered lines.
 * @example
 * ```ts
 * windowOf(lines, 0, 2).map(line => line.number); // [1, 2]
 * ```
 */
function windowOf(lines: readonly (readonly Token[])[], first: number, last: number): Line[] {
  const out: Line[] = [];
  for (let index = first; index < last; index += 1) {
    out.push({ number: index + 1, tokens: lines[index] ?? [] });
  }
  return out;
}

/**
 * Renders one numbered line.
 *
 * @param line - The line.
 * @param current - The marked line.
 * @returns The line element.
 * @example
 * ```tsx
 * renderLine({ number: 1, tokens }, 1);
 * ```
 */
export function renderLine(line: Line, current: number | undefined): VNode {
  return (
    <div
      key={line.number}
      data-line={line.number}
      data-line-current={line.number === current ? "" : undefined}
    >
      <span data-gutter aria-hidden="true">
        {line.number}
      </span>
      <span data-text>{renderTokens(line.tokens)}</span>
    </div>
  );
}

/**
 * The code viewer.
 *
 * @param props - Path, text, language, the marked line and the colour limit.
 * @returns The scrolling code region.
 * @example
 * ```tsx
 * <CodeView path={tab.path} text={text} lang={langOf(tab.path)} line={tab.line} maxHighlightChars={512_000} />
 * ```
 */
export function CodeView(props: CodeViewProps): VNode {
  const { path, text, lang, line, maxHighlightChars } = props;
  const region = useElement<HTMLElement>();
  const colour = text.length <= maxHighlightChars;
  const lines = useMemo(() => tokenLines(text, lang, colour), [text, lang, colour]);
  const windowed = lines.length > WINDOW_LINES;
  const [scroll, setScroll] = useState({ top: 0, height: DEFAULT_VIEWPORT });
  const [lineHeight, setLineHeight] = useState(DEFAULT_LINE_HEIGHT);

  useLayoutEffect(() => {
    const measured = region.current?.querySelector("[data-line]")?.getBoundingClientRect().height;
    if (measured !== undefined && measured > 0) setLineHeight(measured);
  }, [region]);

  useEffect(() => {
    const element = region.current;
    if (line === undefined || element === undefined) return;
    const height = element.clientHeight || DEFAULT_VIEWPORT;
    const top = Math.max(0, (line - 1) * lineHeight - height / 2 + lineHeight / 2);
    element.scrollTop = top;
    setScroll({ top, height });
  }, [path, line, lineHeight, region]);

  let first = 0;
  let last = lines.length;
  if (windowed) {
    first = Math.max(0, Math.floor(scroll.top / lineHeight) - OVERSCAN);
    last = Math.min(lines.length, Math.ceil((scroll.top + scroll.height) / lineHeight) + OVERSCAN);
  }

  return (
    <section
      data-part="code-view"
      data-colour={colour ? undefined : "off"}
      aria-label={path}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region is keyboard-scrollable only when it can take focus
      tabIndex={0}
      ref={region.ref}
      onScroll={event => {
        const element = event.currentTarget;
        if (windowed)
          setScroll({ top: element.scrollTop, height: element.clientHeight || DEFAULT_VIEWPORT });
      }}
    >
      {!colour && <p data-code-note>Large file · colours off</p>}
      {first > 0 && (
        <div data-spacer aria-hidden="true" style={{ height: `${first * lineHeight}px` }} />
      )}
      {windowOf(lines, first, last).map(item => renderLine(item, line))}
      {last < lines.length && (
        <div
          data-spacer
          aria-hidden="true"
          style={{ height: `${(lines.length - last) * lineHeight}px` }}
        />
      )}
    </section>
  );
}
