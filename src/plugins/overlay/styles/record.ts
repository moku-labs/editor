/**
 * @file overlay plugin — the spike record (C3): its header row, the lead (cause legends, the cause
 * word, the frame ms over its budget in magenta), the why line with its cause rule, and the
 * scrolling details (mini bars, key / value rows, slowest systems, what changed).
 */

/**
 * The spike record (components layer).
 */
export const RECORD = `
  @scope ([data-record]) {
    :scope { display: flex; flex: 1; flex-direction: column; min-height: 0; }
    [data-part="record-head"] { display: flex; flex: none; align-items: center; gap: 5px; height: 44px; }
    [data-action="back"] {
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
    [data-action="back"] svg { width: 18px; height: 18px; }
    [data-part="rid"] { display: flex; flex-direction: column; min-width: 0; margin-left: 3px; font-family: var(--font-cond); line-height: 1.15; }
    [data-part="rid"] b { color: var(--ink); font-size: 16px; font-weight: 600; }
    [data-part="rid"] span { color: var(--ink-2); font-size: 11.5px; white-space: nowrap; }
    [data-part="lead"] { display: flex; flex: none; align-items: center; gap: 8px; margin-top: 7px; }
    [data-part="causes"] { display: flex; flex: none; gap: 4px; }
    [data-part="lead"] [data-legend] { height: 26px; padding: 0 6px; font-size: 13px; }
    [data-part="word"] {
      min-width: 0;
      overflow: hidden;
      color: var(--ink);
      font: 600 20px/1 var(--font-cond);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    [data-part="ms"] {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 2px;
      margin-left: auto;
      color: var(--ink-2);
      font: 500 12px/1.05 var(--font-cond);
      white-space: nowrap;
    }
    [data-part="ms"] > span b { font: 600 23px/1 var(--font-cond); }
    [data-part="ms"] em { font-style: normal; }
    [data-part="ms"] em b { font-weight: 600; }
    [data-part="ms"] i { color: var(--budget); font-style: normal; font-weight: 600; }
    [data-severity="amber"] { color: var(--caution); }
    [data-severity="red"] { color: var(--warning); }
    [data-part="why"] {
      flex: none;
      margin: 6px 0 5px;
      padding: 2px 0 2px 8px;
      border-left: 3px solid var(--c);
      color: var(--ink);
      font: 500 13px/1.25 var(--font-cond);
    }
    [data-part="details"] {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 5px 2px 22px 0;
      border-top: 1px solid var(--rule);
      scrollbar-color: var(--edge) var(--ground);
      scrollbar-width: thin;
    }
    [data-part="two"] { display: grid; grid-template-columns: 1fr 1fr; gap: 0 14px; margin-bottom: 6px; }
    [data-part="sec"] {
      margin-bottom: 1px;
      color: var(--ink-3);
      font: 600 11px/14px var(--font-cond);
      letter-spacing: .04em;
      white-space: nowrap;
    }
    [data-part="kv"] { display: flex; align-items: center; gap: 5px; height: 15px; font: 500 12px/15px var(--font-cond); white-space: nowrap; }
    [data-part="kv"] i { color: var(--ink-2); font-style: normal; }
    [data-part="kv"][data-bar] i { flex: none; overflow: hidden; width: 64px; text-overflow: ellipsis; }
    [data-part="bar"] { flex: none; height: 5px; background: var(--stack-gpu); }
    [data-part="bar"][data-phase] { background: var(--phase-bar); }
    [data-part="kv"] b { margin-left: auto; color: var(--measured); font-weight: 600; }
    [data-part="kv"] b[data-tone="word"] { color: var(--ink); }
    [data-part="kv"] b[data-tone="caution"] { color: var(--caution); }
    [data-part="frame-systems"], [data-part="changed"] { margin: 0 0 6px; color: var(--ink); font: 500 12px/15px var(--font-cond); }
    [data-part="frame-systems"] i, [data-part="changed"] i {
      display: block;
      color: var(--ink-3);
      font: 600 11px/14px var(--font-cond);
      font-style: normal;
      letter-spacing: .04em;
    }
  }`;
