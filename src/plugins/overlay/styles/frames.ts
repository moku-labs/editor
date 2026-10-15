/**
 * @file overlay plugin — the Frames tab (C2, C7, C8, D1): the graph row with prev / next and the
 * well, the counters (12 columns, 35 px rows, 1 px rule gaps; the compact row of three and the
 * More key), the More row and its text, the offline note and the notes.
 */

/**
 * The Frames tab (components layer).
 */
export const FRAMES = `
  @scope ([data-overlay="card"]) {
    [data-part="graph-row"] { display: flex; gap: 4px; height: 110px; }
    :scope[data-compact] [data-part="graph-row"] { height: 88px; }
    [data-part="nav"] { display: flex; flex: none; flex-direction: column; justify-content: space-between; width: 44px; }
    [data-spike-nav] {
      display: grid;
      flex: none;
      place-items: center;
      width: 44px;
      height: 44px;
      border: 1px solid var(--edge);
      border-radius: 3px;
      background: var(--ground-2);
      color: var(--ink);
      cursor: pointer;
    }
    [data-spike-nav]:hover:not(:disabled) { border-color: var(--measured); color: var(--measured); }
    [data-spike-nav]:disabled { border-color: var(--rule); color: var(--ink-3); cursor: default; }
    [data-spike-nav] svg { width: 18px; height: 18px; }
    [data-part="count"] {
      display: grid;
      place-items: center;
      min-width: 30px;
      color: var(--ink-2);
      font: 600 12px/1 var(--font-cond);
    }
    [data-part="nav"] [data-part="count"] { flex: 1; }
    [data-graph] {
      position: relative;
      flex: 1;
      min-width: 0;
      overflow: hidden;
      border: 1px solid var(--rule);
      border-radius: 3px;
      background: var(--well);
    }
    [data-graph] canvas {
      display: block;
      width: 100%;
      height: 100%;
      cursor: crosshair;
      touch-action: manipulation;
      will-change: transform;
    }
    [data-graph] canvas[data-fixed] { position: absolute; top: 0; left: 0; pointer-events: none; }
    [data-graph] [data-legend] { position: absolute; top: 36px; left: 5px; pointer-events: none; }
    [data-part="counters"] {
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      grid-auto-rows: 35px;
      gap: 1px;
      margin-top: 4px;
      border: 1px solid var(--rule);
      background: var(--rule);
    }
    [data-counter] { grid-column: span 4; overflow: hidden; padding: 4px 7px 0; background: var(--ground); }
    [data-counter][data-span="3"] { grid-column: span 3; }
    [data-counter][data-span="6"] { grid-column: span 6; }
    [data-counter] i {
      display: block;
      overflow: hidden;
      color: var(--ink-3);
      font: 500 12px/13px var(--font-cond);
      font-style: normal;
      letter-spacing: .01em;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    [data-counter] b { display: block; color: var(--measured); font: 600 17px/18px var(--font-cond); white-space: nowrap; }
    [data-counter] small { margin-left: 2px; color: var(--ink-2); font-size: 11px; font-weight: 500; }
    [data-counter][data-caution] b { color: var(--caution); }
    [data-counter] [data-part="rate"] { margin-left: 0; }
    [data-counter] [data-part="rate"][data-caution] { color: var(--caution); }
    [data-part="counters"][data-compact] { grid-template-columns: 1fr 1fr 1fr 44px; grid-auto-rows: 44px; }
    [data-part="counters"][data-compact] [data-counter] { grid-column: auto; padding-top: 7px; }
    [data-part="counters"] [data-more] {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      border: 0;
      background: var(--ground-2);
      color: var(--ink);
      font: 600 12px/1 var(--font-cond);
      cursor: pointer;
    }
    [data-more] svg { width: 16px; height: 16px; flex: none; }
    [data-more="open"] svg { transform: rotate(180deg); }
    [data-part="more"] {
      display: flex;
      align-items: center;
      gap: 9px;
      width: 100%;
      height: 44px;
      margin-top: 4px;
      padding: 0 10px;
      border: 1px solid var(--rule);
      border-radius: 3px;
      background: var(--ground-2);
      color: var(--ink);
      text-align: left;
      cursor: pointer;
    }
    [data-part="more"] b { flex: none; font: 600 15px/1 var(--font-cond); }
    [data-part="more"] span {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      color: var(--ink-3);
      font: 500 12px/1 var(--font-cond);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    [data-part="xtra"] { margin-top: 4px; color: var(--ink-3); font: 500 12px/15px var(--font-cond); letter-spacing: .01em; }
    [data-part="xtra"] b { color: var(--ink); font-weight: 600; }
    [data-part="systems"] { display: block; overflow: hidden; color: var(--ink-2); text-overflow: ellipsis; white-space: nowrap; }
    [data-part="offnote"] {
      display: flex;
      align-items: flex-start;
      gap: 7px;
      margin-top: 4px;
      color: var(--ink-2);
      font: 500 12px/14px var(--font-text);
    }
    [data-part="note"] { margin-top: 4px; color: var(--ink-2); font: 500 12px/1.35 var(--font-text); }
  }`;
