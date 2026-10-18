/**
 * @file overlay plugin — the pill (C1): 138 × 36, the link light, fps, REC, the spikes legend;
 * its hit area reaches 5 px beyond every side; radius 8 on the free side.
 */

/**
 * The pill (components layer).
 */
export const PILL = `
  @scope ([data-overlay="pill"]) {
    :scope {
      position: relative;
      display: flex;
      align-items: center;
      gap: 4px;
      width: 138px;
      height: 36px;
      padding: 0 6px 0 7px;
      border: 1px solid var(--edge);
      background: var(--ground-2);
      box-shadow: 0 2px 0 var(--drop);
      color: var(--ink);
      font-family: var(--font-cond);
      text-align: left;
      cursor: pointer;
    }
    :scope::after { content: ""; position: absolute; inset: -5px; }
    [data-part="light"] { width: 8px; height: 8px; flex: none; border-radius: 50%; background: var(--c); }
    [data-part="fps"] { color: var(--measured); font: 600 24px/1 var(--font-cond); }
    [data-part="labels"] {
      display: flex;
      flex-direction: column;
      gap: 2px;
      color: var(--ink-2);
      font: 500 11px/11px var(--font-cond);
      white-space: nowrap;
    }
    [data-part="rec"] {
      display: flex;
      align-items: center;
      gap: 3px;
      color: var(--warning);
      font: 600 11px/1 var(--font-cond);
      letter-spacing: .06em;
    }
    [data-part="rec"] i { width: 8px; height: 8px; border-radius: 50%; background: var(--warning); }
    [data-legend] { height: 22px; }
  }
  :host([data-dock="right"]) [data-overlay="pill"] { border-right: 0; border-radius: 8px 0 0 8px; }
  :host([data-dock="left"]) [data-overlay="pill"] { border-left: 0; border-radius: 0 8px 8px 0; }`;
