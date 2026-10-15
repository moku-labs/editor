/**
 * @file overlay plugin — the shadow root's one stylesheet, assembled as text (a library mounted
 * into a game page cannot rely on a bundled `.css` asset, and a shadow root needs the sheet as a
 * string): `@layer reset, tokens, components, utilities`, `@scope` per part, `data-*` selectors
 * only, opaque surfaces, one 120 ms slide that reduced motion removes.
 */
import { CARD } from "./card";
import { FRAMES } from "./frames";
import { HOST } from "./host";
import { LEGEND } from "./legend";
import { PILL } from "./pill";
import { RECORD } from "./record";
import { TABS } from "./tabs";
import { TOKENS } from "./tokens";

/**
 * The reset layer: the host takes nothing from the game page.
 */
const RESET = `
@layer reset {
  :host { all: initial; }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  button, input { color: inherit; font: inherit; }
  ul { list-style: none; }
}`;

/**
 * The utilities layer: the focus ring and reduced motion (no slide).
 */
const UTILITIES = `
@layer utilities {
  :focus-visible { outline: 2px solid var(--measured); outline-offset: 1px; }
  @media (prefers-reduced-motion: reduce) {
    [data-overlay] { animation: none; }
  }
}`;

/**
 * The overlay's stylesheet.
 */
export const overlayCss = `@layer reset, tokens, components, utilities;
${RESET}
${TOKENS}
@layer components {${HOST}${LEGEND}${PILL}${CARD}${FRAMES}${RECORD}${TABS}
}
${UTILITIES}
`;
