/**
 * @file overlay plugin — the annunciator legend (`an`): boxed text in its colour, lit = filled,
 * hollow = dashed; and the small status dots.
 */

/**
 * The legend and the dots (components layer).
 */
export const LEGEND = `
  @scope ([data-overlay]) {
    [data-legend] {
      display: inline-flex;
      flex: none;
      align-items: center;
      gap: 3px;
      height: 20px;
      padding: 0 5px;
      border: 1.5px solid var(--c);
      border-radius: 2px;
      background: var(--legend-ground);
      color: var(--c);
      font: 600 12px/1 var(--font-cond);
      letter-spacing: .07em;
      white-space: nowrap;
    }
    [data-legend][data-lit] { background: var(--c); color: var(--legend-ground); }
    [data-legend][data-hollow] { border-style: dashed; }
    [data-legend] svg { width: 9px; height: 9px; }
    [data-legend] small { margin-left: 2px; font: 600 11px/1 var(--font-cond); letter-spacing: 0; }
    [data-part="dot"] { width: 7px; height: 7px; border-radius: 50%; background: var(--c); }
  }`;
