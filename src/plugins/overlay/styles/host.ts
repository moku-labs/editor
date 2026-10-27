/**
 * @file overlay plugin — the host box (fixed, docked by `data-dock`, placed by the custom
 * properties the layout writes), the safe-area probes and the one slide of an opening.
 */
import { Z_INDEX } from "../types";

/**
 * The host, the probes and the slide (components layer).
 */
export const HOST = `
  :host {
    position: fixed;
    z-index: ${Z_INDEX};
    top: var(--overlay-top, 0px);
    display: block;
    color: var(--ink);
    font-family: var(--font-text);
    font-variant-numeric: tabular-nums;
    -webkit-text-size-adjust: 100%;
  }
  :host([hidden]) { display: none; }
  :host([data-dock="right"]) { right: var(--overlay-side, 0px); }
  :host([data-dock="left"]) { left: var(--overlay-side, 0px); }
  :host([data-opening][data-dock="right"]) [data-overlay] { animation: overlay-in-right 120ms ease-out 1; }
  :host([data-opening][data-dock="left"]) [data-overlay] { animation: overlay-in-left 120ms ease-out 1; }
  @keyframes overlay-in-right { from { transform: translateX(28px); } to { transform: none; } }
  @keyframes overlay-in-left { from { transform: translateX(-28px); } to { transform: none; } }
  [data-safe-probe] {
    position: fixed;
    left: 0;
    top: 0;
    visibility: hidden;
    pointer-events: none;
  }
  [data-safe-probe="start"] {
    width: var(--moku-safe-left, var(--moku-device-safe-left, env(safe-area-inset-left, 0px)));
    height: var(--moku-safe-top, var(--moku-device-safe-top, env(safe-area-inset-top, 0px)));
  }
  [data-safe-probe="end"] {
    width: var(--moku-safe-right, var(--moku-device-safe-right, env(safe-area-inset-right, 0px)));
    height: var(--moku-safe-bottom, var(--moku-device-safe-bottom, env(safe-area-inset-bottom, 0px)));
  }`;
