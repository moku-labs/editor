# workspace styles

Two-layer design tokens (design-context §2), reset, base and the data-attribute primitives every
view uses. Pure CSS: no preprocessor, no classes, `@scope` per component sheet.

## Assembly

`index.css` declares the layer order once and imports every sheet with its layer (R7: no sheet
wraps itself in `@layer`):

| Layer | Sheets |
|---|---|
| `reset` | `reset.css` |
| `tokens` | `tokens.css` |
| `base` | `base.css` |
| `components` | `primitives.css`, `ui/*.css`, `palette/Palette.css`, `frame/Frame.css` |
| `animations` | `animations.css` (keyframes: `spin`, `toast-in`, `pulse`) |
| `utilities` | `utilities.css` (reduced motion: no transitions or animations) |
| (none) | `fonts.css` (`@font-face`, unlayered) |

The tools page CSS entry (`pages/page/index.css`) imports `index.css` first, then each view sheet
in `layer(components)` (R3).

## Top-layer rule (R4, D-14)

The game iframe sits in one fixed layer above the workspace content (`[data-frame-layer]`,
`z-index: 10`). Every float that can cover it — palette, popovers, menus, toasts, sheets, the
capture card — must render in the browser top layer: a `<dialog>` opened with `showModal()` or an
element with the `popover` attribute. A float with a plain `z-index` ends up under the game.

## Tokens

Primitives are raw values (`--color-light-*`, `--color-dark-*`, `--color-phase-1…5`,
`--color-pick-blue`, `--color-pick-pink`, `--font-size-*`, `--radius-*`); views use the semantic
names, themed with `light-dark()`:

- Surfaces and text: `--surface-ground`, `--surface-panel`, `--surface-panel-2`,
  `--surface-canvas`, `--line-1`, `--line-2`, `--text-ink`, `--text-2`, `--text-muted`.
- Meaning: `--accent`, `--accent-2`, `--accent-ink` (accent as text), `--on-accent` (text on
  a solid accent), `--accent-soft` (9 % / 13 %), `--accent-soft-strong` (20 % / 28 %),
  `--status-live`, `--status-warn`, `--status-error`, `--teal`, `--edge`, `--canvas-dot`,
  `--pick-hover`, `--pick-tree`, `--phase-1` … `--phase-5`.
- Device frame: `--bezel` (`#1b1b20` light, `#2c2c34` dark, so the frame reads on the dark
  canvas), `--border-strong` (the 1 px outline of the bezel; the edge grey of each theme),
  `--device-black`. The docked game frame itself is clipped to the preset's corner radius
  (`frame/frame.ts`), not by a token.
- Code colours: `--code-<kind>` for every highlighter `TokenKind`.
- Motion: `--duration-camera` 420, `--duration-zoom` 200, `--duration-follow` 500,
  `--duration-walk` 220, `--duration-resize` 210, `--duration-toast` 180.
- Layout: `--topbar-h` 44 px, `--rail-w` 52 px (44 px at ≤ 560 px), `--inspector-w` 320 px
  (296 px at ≤ 1380 px, 260 px at ≤ 820 px, 240 px at ≤ 560 px), `--toast-band` 64 px.
- Density: `--space-1` … `--space-5`, `--row-h`, `--font-size-ui`, `--font-size-code-ui`.
  Comfortable 4/6/8/12/16 px, row 28 px, 13 / 12.5 px; `:root[data-density="compact"]`
  2/4/6/8/12 px, row 24 px, 12 / 11.5 px. workspace sets `data-density` on `<html>`. New and
  touched CSS uses them.
- Type: `--font-sans` (Geist), `--font-mono` (Geist Mono); body text 13/1.42 with `ss01`.

`:root` has `color-scheme: light dark` (the OS decides on first load); `[data-theme="light"]` /
`[data-theme="dark"]` on `<html>` forces one. The names views use from TypeScript are mirrored in
`src/plugins/panels/shared/tokens.ts`; a panels test checks every name there is declared in
`tokens.css`.

## Top bar (`ui/TopBar.css`, `ui/MoreMenu.css`)

The top bar has two layouts, picked by the component from the window width and written as
`[data-layout]` on the bar:

| Window | Layout | What the CSS does |
|---|---|---|
| 1180 px and up | `wide` | Every label visible. The search box grows to 380 px. |
| 900–1179 px | `wide` | Pause and Step show icons only; the Preview, Overlay and Hot reload switches keep their labels in a tighter box (gap 4 px). |
| 561–899 px | `compact` | Logo, game name (120 px at most, no version), link pill, Pause, Step, a 28 px search icon and the ⋯ button. |
| 560 px and below | `compact` | The game name hides too; gaps and padding use the density tokens. |

Every control keeps its size (`flex-shrink: 0`). Only the game name and the wide search box shrink.
The search box stops at 88 px and clips its own content (`overflow: hidden`), so it never runs
over a neighbour. The ⋯ menu (`[data-ui="more-menu"]`) is a top-layer popover: a row grid of
label, state and key, using `--row-h` and the spacing tokens.

## Primitives (`primitives.css`, unscoped global atoms)

`button[data-variant=primary|ghost|danger]`, `[data-size=sm]`, `[data-chip]`,
`[data-tag=ok|err|warn|acc|mut]`, `[data-badge][data-tone]`, `kbd`, `[role=switch][data-switch]`,
`[data-segmented]`, `[role=tablist][data-tabs]`, `[data-card]`, `[data-props]` (a `dt`/`dd`
grid; a pair may sit in a `<div>`, long values wrap), `[data-spinner]`,
`[data-stale]` (saturate 0.25, opacity 0.62, 210 ms) and `[data-token="<kind>"]` for the
`<span data-token>` output of the shared highlighter.

## Fonts

`fonts/Geist-Variable.woff2` and `fonts/GeistMono-Variable.woff2` (weights 100–900) from the
official `geist` npm package by Vercel, version 1.7.2, under the SIL Open Font License 1.1
(`fonts/OFL.txt`). No CDN.
