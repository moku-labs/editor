/**
 * @file overlay plugin — the tokens layer: the design §2 palette as primitives (from the prototype's
 * `styles.scss :root`), then the semantic names the components use, and the font stacks. One fixed
 * dark cockpit theme (design §2 Theming): single values, no `light-dark()`.
 */

/**
 * The tokens layer.
 */
export const TOKENS = `
@layer tokens {
  :host {
    --prim-slate: #16243D;
    --prim-slate-2: #0F1B30;
    --prim-slate-3: #1C2E4E;
    --prim-well: #0B1629;
    --prim-rule: #2A4270;
    --prim-edge: #3A5686;
    --prim-ink: #E9F0FA;
    --prim-ink-2: #9DB0CC;
    --prim-ink-3: #7A8FB2;
    --prim-cyan: #3FDCF5;
    --prim-magenta: #FF4FD8;
    --prim-amber: #FFB320;
    --prim-red: #FF4545;
    --prim-green: #3DE37A;
    --prim-legend-ground: #0A1426;
    --prim-drop: #050A14;
    --prim-off-ground: #241F12;
    --prim-off-ink: #1A1405;
    --prim-disabled-ground: #122038;
    --prim-disabled-ink: #4E6890;
    --prim-key-divider: #1F3256;
    --prim-warn-border: #7A2C3A;
    --prim-phase-bar: #6E83A6;
    --prim-js: #A8F0FF;
    --prim-gpu: #2F78C4;
    --prim-idle: #24406B;

    color-scheme: dark;
    --ground: var(--prim-slate);
    --ground-2: var(--prim-slate-2);
    --ground-3: var(--prim-slate-3);
    --well: var(--prim-well);
    --rule: var(--prim-rule);
    --edge: var(--prim-edge);
    --ink: var(--prim-ink);
    --ink-2: var(--prim-ink-2);
    --ink-3: var(--prim-ink-3);
    --measured: var(--prim-cyan);
    --budget: var(--prim-magenta);
    --caution: var(--prim-amber);
    --warning: var(--prim-red);
    --live: var(--prim-green);
    --legend-ground: var(--prim-legend-ground);
    --drop: var(--prim-drop);
    --off-ground: var(--prim-off-ground);
    --off-ink: var(--prim-off-ink);
    --disabled-ground: var(--prim-disabled-ground);
    --disabled-ink: var(--prim-disabled-ink);
    --key-divider: var(--prim-key-divider);
    --warn-border: var(--prim-warn-border);
    --phase-bar: var(--prim-phase-bar);
    --stack-js: var(--prim-js);
    --stack-gpu: var(--prim-gpu);
    --stack-idle: var(--prim-idle);
    --font-cond: "Barlow Condensed", "Arial Narrow", sans-serif;
    --font-text: Barlow, system-ui, sans-serif;
  }
}`;
