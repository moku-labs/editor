/**
 * @file overlay plugin — the Game (C4), Record (C5) and Link (C6, F3) tabs, their buttons and
 * fields, and the toast (F2).
 */

/**
 * The Game, Record and Link tabs (components layer).
 */
export const TABS = `
  @scope ([data-overlay="card"]) {
    [data-part="button"] {
      height: 44px;
      padding: 0 12px;
      border: 1px solid var(--edge);
      border-radius: 4px;
      background: var(--ground-2);
      color: var(--ink);
      font: 600 15px/1 var(--font-cond);
      letter-spacing: .02em;
      white-space: nowrap;
      cursor: pointer;
    }
    [data-part="button"]:disabled { border-color: var(--rule); color: var(--ink-3); cursor: default; }
    [data-part="button"][data-warn] { border-color: var(--warn-border); color: var(--warning); }
    [data-part="field"] {
      flex: 1;
      min-width: 0;
      height: 44px;
      padding: 0 10px;
      border: 1px solid var(--edge);
      border-radius: 4px;
      background: var(--legend-ground);
      color: var(--ink);
      font: 500 15px var(--font-cond);
      letter-spacing: .02em;
    }
    [data-part="field"]::placeholder { color: var(--ink-3); }
    [data-toast] { margin-top: 4px; color: var(--measured); font: 500 12px var(--font-cond); }
    [data-toast="error"] { color: var(--warning); }

    [data-part="game-head"] { margin: 2px 0 7px; }
    [data-part="game-title"] { color: var(--ink); font: 600 17px/1.1 var(--font-cond); }
    [data-part="game-by"] { margin-top: 1px; color: var(--ink-3); font: 500 12px/1.3 var(--font-text); }
    [data-command] {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      height: 48px;
      margin-bottom: 5px;
      padding: 0 7px 0 11px;
      border: 1px solid var(--edge);
      border-radius: 4px;
      background: var(--ground-2);
      color: var(--ink);
      text-align: left;
      cursor: pointer;
    }
    [data-part="name"] { display: flex; flex: 1; flex-direction: column; gap: 3px; min-width: 0; }
    [data-part="name"] b { font: 600 17px/1 var(--font-cond); }
    [data-part="name"] span {
      overflow: hidden;
      color: var(--ink-3);
      font: 500 12px/1 var(--font-cond);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    [data-part="state"] {
      display: grid;
      flex: none;
      place-items: center;
      width: 44px;
      height: 28px;
      border: 1px solid var(--measured);
      border-radius: 2px;
      background: var(--legend-ground);
      color: var(--measured);
      font: 600 12px/1 var(--font-cond);
      letter-spacing: .1em;
    }
    [data-command][data-state="off"] { border-color: var(--caution); background: var(--off-ground); }
    [data-command][data-state="off"] [data-part="name"] b { color: var(--caution); }
    [data-command][data-state="off"] [data-part="state"] { border-color: var(--caution); background: var(--caution); color: var(--off-ink); }
    [data-command][data-state="refused"] { border-color: var(--rule); background: var(--disabled-ground); cursor: not-allowed; }
    [data-command][data-state="refused"] [data-part="name"] b { color: var(--ink-3); }
    [data-command][data-state="refused"] [data-part="name"] span { color: var(--ink-2); }
    [data-command][data-state="refused"] [data-part="state"] { border-color: var(--rule); color: var(--disabled-ink); }
    [data-command][data-state="busy"] { cursor: progress; }
    [data-part="game-note"] {
      display: flex;
      align-items: flex-start;
      gap: 7px;
      margin-top: 4px;
      color: var(--ink-2);
      font: 500 12px/1.3 var(--font-text);
    }
    [data-part="press-note"] { margin-top: 5px; color: var(--ink-3); font: 500 12px/1.2 var(--font-text); }

    [data-part="rec-top"] { display: flex; align-items: center; gap: 8px; height: 44px; }
    [data-part="clock"] { color: var(--ink); font: 600 30px/1 var(--font-cond); letter-spacing: .02em; }
    [data-part="clock"][data-dim] { color: var(--ink-3); }
    [data-part="rec-stats"] { display: flex; flex-direction: column; color: var(--ink-2); font: 500 12px/1.2 var(--font-cond); }
    [data-part="rec-stats"] b { color: var(--measured); font-weight: 600; }
    [data-part="rec-top"] [data-part="button"] { min-width: 64px; margin-left: auto; }
    [data-part="sent"] {
      display: flex;
      align-items: baseline;
      gap: 10px;
      margin-top: 5px;
      color: var(--ink-2);
      font: 500 12px/1 var(--font-cond);
    }
    [data-part="sent"] b { color: var(--live); font-weight: 600; }
    [data-part="sent"] em { color: var(--caution); font-style: normal; font-weight: 600; }
    [data-part="meter"] { position: relative; height: 5px; margin-top: 4px; border: 1px solid var(--rule); background: var(--legend-ground); }
    [data-part="meter"] i { position: absolute; top: 0; bottom: 0; left: 0; background: var(--live); }
    [data-part="mark-row"] { display: flex; gap: 6px; margin-top: 6px; }
    [data-part="marks"] { margin-top: 4px; list-style: none; }
    [data-part="marks"] li { display: flex; gap: 8px; color: var(--ink); font: 500 12px/15px var(--font-cond); }
    [data-part="marks"] b { width: 30px; color: var(--budget); font-weight: 600; }
    [data-part="marks"] em { color: var(--ink-3); font-style: normal; }
    [data-part="logs"] { margin-top: 5px; border-top: 1px solid var(--rule); list-style: none; }
    [data-part="logs"] li { display: flex; align-items: center; gap: 4px; height: 44px; border-bottom: 1px solid var(--rule); }
    [data-part="log-name"] {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-width: 0;
      overflow: hidden;
      color: var(--ink);
      font: 500 12.5px/1.2 var(--font-cond);
      white-space: nowrap;
    }
    [data-part="log-name"] span { color: var(--ink-3); font-size: 11.5px; }
    [data-part="log-name"] b { color: var(--live); font-weight: 600; }
    [data-part="log-name"] em { color: var(--warning); font-style: normal; font-weight: 600; }
    [data-part="logs"] [data-part="button"] { height: 44px; padding: 0 9px; font-size: 14px; }

    [data-part="modes"] { display: grid; grid-template-columns: 1.05fr 1.3fr .8fr .8fr; gap: 4px; }
    [data-part="mode"] {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 3px;
      height: 44px;
      border: 1px solid var(--rule);
      border-radius: 3px;
      background: var(--legend-ground);
      color: var(--disabled-ink);
    }
    [data-part="mode"] b { font: 600 12px/1 var(--font-cond); letter-spacing: .06em; }
    [data-part="mode"] i { font: 500 11px/1 var(--font-text); font-style: normal; }
    [data-part="mode"][data-lit] { border-color: var(--c); background: var(--c); color: var(--legend-ground); }
    [data-part="mode"][data-candidate] { border-color: var(--c); color: var(--c); }
    [data-part="address"] { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
    [data-part="address-label"] { flex: none; width: 58px; color: var(--ink-2); font: 600 13px/1.05 var(--font-cond); }
    [data-part="tag"] { color: var(--live); font: 600 12px var(--font-cond); }
    [data-part="hint"] { margin-top: 4px; color: var(--warning); font: 500 12px/1.3 var(--font-text); }
    [data-pairing] {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-top: 6px;
      padding: 4px 10px;
      border: 1px solid var(--edge);
      border-radius: 4px;
      background: var(--legend-ground);
    }
    [data-part="code"] { color: var(--measured); font: 600 52px/1 var(--font-cond); letter-spacing: .12em; }
    [data-pairing] p { color: var(--ink-2); font: 500 12.5px/1.3 var(--font-text); }
    [data-pairing] p b { display: block; color: var(--caution); font-family: var(--font-cond); font-weight: 600; }
    [role="tabpanel"][data-tab="link"] [data-caution] {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin-top: 6px;
      padding: 6px 8px;
      border: 1px solid var(--caution);
      border-radius: 3px;
      background: var(--off-ground);
    }
    [role="tabpanel"][data-tab="link"] [data-caution] p { color: var(--ink); font: 500 12px/1.3 var(--font-text); }
    [role="tabpanel"][data-tab="link"] [data-caution] b { color: var(--caution); font-family: var(--font-cond); font-weight: 600; }
    [data-part="live"] {
      display: flex;
      align-items: center;
      gap: 10px;
      height: 44px;
      margin-top: 6px;
      padding: 0 10px;
      border: 1px solid var(--rule);
      border-radius: 4px;
      background: var(--legend-ground);
    }
    [data-part="live"] b { color: var(--live); font: 600 18px var(--font-cond); }
    [data-part="live"] span { color: var(--ink-2); font: 500 12.5px var(--font-cond); }
    [data-part="seen"] { margin-top: 6px; color: var(--ink-3); font: 500 12px/1.3 var(--font-cond); }
    [data-part="seen"] b { color: var(--ink); font-weight: 600; }
  }`;
