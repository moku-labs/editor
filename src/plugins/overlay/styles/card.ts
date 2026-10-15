/**
 * @file overlay plugin — the card (C2–C8): its box (radius 12 on the free corners, a hard 3 px
 * drop), the header (B1), the scrolling body, the key bar (B2) and the engine line (B3).
 */

/**
 * The card, header, body, keys and engine line (components layer).
 */
export const CARD = `
  @scope ([data-overlay="card"]) {
    :scope {
      display: flex;
      flex-direction: column;
      width: var(--overlay-w, 344px);
      height: var(--overlay-h, 372px);
      overflow: hidden;
      border: 1px solid var(--edge);
      background: var(--ground);
      box-shadow: 0 3px 0 var(--drop);
      color: var(--ink);
    }
    [data-part="header"] {
      display: flex;
      flex: none;
      align-items: center;
      gap: 4px;
      height: 44px;
      border-bottom: 1px solid var(--rule);
      background: var(--ground-2);
    }
    [data-part="header"] [data-part="grip"] {
      display: grid;
      flex: none;
      place-items: center;
      width: 24px;
      height: 44px;
      border: 0;
      background: var(--ground-2);
      color: var(--ink-3);
      cursor: grab;
      touch-action: none;
    }
    [data-part="grip"]:active { cursor: grabbing; }
    [data-part="grip"] svg { width: 10px; height: 16px; }
    [data-part="fps"] { display: flex; align-items: baseline; gap: 2px; margin-right: 4px; }
    [data-part="fps"] b { color: var(--measured); font: 600 26px/1 var(--font-cond); }
    [data-part="fps"] small { color: var(--ink-2); font: 500 12px/1 var(--font-cond); }
    [data-part="spikes"] { display: inline-flex; flex: none; align-items: center; gap: 3px; }
    [data-part="spikes-label"] { color: var(--ink-2); font: 500 11px/11px var(--font-cond); white-space: nowrap; }
    [data-part="spacer"] { flex: 1; }
    [data-part="header"] button {
      display: grid;
      flex: none;
      place-items: center;
      width: 44px;
      height: 44px;
      border: 0;
      background: var(--ground-2);
      color: var(--ink-2);
      cursor: pointer;
    }
    [data-part="header"] button:hover { color: var(--ink); }
    [data-part="header"] button svg { width: 19px; height: 19px; }
    [role="tabpanel"] {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 5px 10px 4px;
      scrollbar-color: var(--edge) var(--ground);
      scrollbar-width: thin;
    }
    [role="tabpanel"][data-view="record"] { display: flex; flex-direction: column; overflow: hidden; padding-bottom: 0; }
    [role="tablist"] {
      display: grid;
      flex: none;
      grid-template-columns: repeat(4, 1fr);
      height: 46px;
      border-top: 1px solid var(--rule);
      background: var(--ground-2);
    }
    [role="tablist"][data-count="3"] { grid-template-columns: repeat(3, 1fr); }
    [role="tab"] {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      border: 0;
      border-right: 1px solid var(--key-divider);
      background: var(--ground-2);
      color: var(--ink-2);
      font: 600 15px/1 var(--font-cond);
      letter-spacing: .02em;
      cursor: pointer;
    }
    [role="tab"]:last-child { border-right: 0; }
    [role="tab"][aria-selected="true"] { background: var(--ground-3); color: var(--measured); }
    [role="tab"][aria-selected="true"]::before {
      content: "";
      position: absolute;
      top: 0;
      right: 10px;
      left: 10px;
      height: 3px;
      background: var(--measured);
    }
    [data-part="engine"] {
      flex: none;
      padding: 3px 10px 4px;
      border-top: 1px solid var(--rule);
      background: var(--ground-2);
      color: var(--ink-3);
      font: 500 12px/13px var(--font-cond);
      letter-spacing: .01em;
      white-space: nowrap;
    }
    [data-part="engine"] > div { display: flex; align-items: center; gap: 8px; height: 13px; }
    [data-part="engine"] b { color: var(--ink); font-weight: 600; }
    [data-part="engine"][data-stale] [data-part="engine-id"] { color: var(--caution); }
    [data-part="profile"] { color: var(--ink-2); }
    [data-part="engine"] [data-legend] { height: 13px; padding: 0 3px; border-width: 1px; font-size: 11px; }
    [data-part="engine"][data-inline] { margin-top: 8px; padding: 0; border: 0; background: var(--ground); }
  }
  :host([data-dock="right"]) [data-overlay="card"] { border-right: 0; border-radius: 12px 0 0 12px; }
  :host([data-dock="left"]) [data-overlay="card"] { border-left: 0; border-radius: 0 12px 12px 0; }`;
