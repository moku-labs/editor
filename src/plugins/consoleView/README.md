# consoleView

> Standard plugin of the **tools** core (`createToolsPlugin`). The Console workspace: the game log as a table.

The Console shows the game's log trace (`game.log`) as a table: Frame, Level, Source, Message.
It has a level filter with counts, a search with highlight, Clear and Preserve log.
It also holds the errors of commands run from the tools page ("Logged in Console", D1).
It feeds the Console rail badge.

The plugin keeps the log for the whole session, not the panel.
So the badge and Preserve log work while another workspace is open.

## Configuration

| Option | Type | Default | Meaning |
|---|---|---|---|
| `maxLines` | `number` | `5000` | Most lines kept (entries and meta rows). The oldest go first. |
| `preserveLog` | `boolean` | `false` | Initial state of the Preserve log switch. |
| `freshMs` | `number` | `1200` | How long a fresh error row keeps its highlight, in ms. |
| `summaryChars` | `number` | `160` | Characters of non-string `data` shown inline in the Message cell. |

## API

`app.consoleView` is `ConsoleApi` (`types.ts`). The view, the palette items and tests use it.

| Member | Signature | What |
|---|---|---|
| `lines` | `() => readonly LogLine[]` | Every held line, oldest first, at most `maxLines`. A copy. |
| `visible` | `() => readonly LogLine[]` | Entries of the filter level (`all` includes debug) whose `source + " " + message` contains the query, case-insensitive. Meta rows always show. |
| `counts` | `() => LevelCounts` | `{ all, debug, info, warn, error }` over entry lines. Meta rows are not counted. |
| `filter` | `() => { level: LevelFilter; query: string }` | The current filter, a copy. |
| `setFilter` | `(next: Partial<{ level: LevelFilter; query: string }>) => void` | Merges the filter. Notifies. |
| `clear` | `() => void` | Leaves one meta row "Console cleared" and closes the drawer. Consumed entries never come back. Clears the badge. |
| `preserve` | `() => boolean` | Whether Preserve log is on. |
| `setPreserve` | `(on: boolean) => void` | Sets Preserve log. Notifies. |
| `select` | `(key?: number) => void` | The line in the detail drawer. No key closes it. |
| `selected` | `() => LogLine \| undefined` | The drawer line, if still held. |
| `refresh` | `() => void` | One `link.read("game.log")`, ingested like a watched value. Ingest is idempotent. A failure logs `consoleView:read-failed` at debug. |
| `focusFrame` | `(frame: number) => void` | Emits the global `workspace:focus-frame { frame }`. |
| `subscribe` | `(fn: () => void) => () => void` | Change listener. Returns an idempotent unsubscribe. |

`LevelFilter` is `"all" | "info" | "warn" | "error"`. `LogLine` is `EntryLine | MetaLine`.

```ts
// The design log: 6 info lines and 2 warnings.
app.consoleView.counts(); // { all: 8, debug: 0, info: 6, warn: 2, error: 0 }

app.consoleView.setFilter({ level: "warn", query: "texture" });
app.consoleView.visible().length; // 2

app.consoleView.select(5);
app.consoleView.selected(); // { kind: "entry", key: 5, level: "warn", source: "assets", … }

app.consoleView.clear();
app.consoleView.lines().map(line => line.kind); // ["meta"]

app.consoleView.focusFrame(1778); // flowView shows Flow at frame 1778
```

### Lines

- **Source:** the event head before the first `:` when it matches `^[A-Za-z][\w.-]{0,23}$`, else the entry's `plugin`, else `game`.
- **Message:** the rest of the event, plus the data. String data joins with ` · `. Other JSON is stringified and cut at `summaryChars` with `…`.
- **Frame:** a numeric `data.frame` gives an exact frame (`1778`). Otherwise the frame is "at or before" the frame at which the value arrived (`≤1840`, with a tooltip).
- **Command error (D1):** level `error`, source `editor`, message like `-32602 game.step: frames must be a number`. The `[moku-editor]` prefix is stripped with `bareMessage` (R7).

### Meta rows

| Text | When |
|---|---|
| `Console cleared` | `clear()` |
| `Log cleared: the game page reloaded. Turn on Preserve log to keep it.` | Game page reload, Preserve log off. The lines are dropped. |
| `Game page reloaded · log preserved` | Game page reload, Preserve log on. The lines are kept. |

A reload is detected by a new first entry (`ts`, `event`) or a trace shorter than the consumed count.
After a game that logged nothing, a new link session (`link.session()`) marks the reload.

### Rail badge

`warn + error`, tone `error` when any error, else `warn`. Label like `2 warn · 1 error`.
No badge when both are zero. It counts what the Console holds, not what is unseen.

## Events

| Kind | Name | Payload | When |
|---|---|---|---|
| Declares | none | | |
| Emits | `workspace:focus-frame` (global) | `{ frame: number }` | A frame link is clicked, or `focusFrame()`. |
| Hooks | `link:status` | `{ status, session? }` | Re-renders the view. Marks "ever connected" on `live` or `paused`. Reads nothing. |
| Hooks | `workspace:ran` | `RanEvent` | A failed run appends the D1 line and pushes the badge. A successful run does nothing. |

Log events: `consoleView:read-failed` (debug, from `refresh()`), `consoleView:unexpected-log` (warn, a value that is not a trace).

## Dependencies

| Plugin | Used for |
|---|---|
| `linkPlugin` | `watch("game.log")`, `read("game.log")`, `status()`, `session()` |
| `workspacePlugin` | `badge("console", …)`, `palette.add`, `keys.bind` |
| `panelsPlugin` | `register` the `console` panel |

consoleView depends on no other view (R4).

## Lifecycle

| Phase | What |
|---|---|
| `onInit` | Registers the `console` panel. |
| `onStart` | One `link.watch("game.log")` for the session (R6). Palette items "Clear console" and "Preserve log: on / off". The key `/` focuses the search in Console. Clears a stale badge. |
| `onStop` | Drops the watch, the palette items, the key binding and every view listener. |

## Usage

```ts
const app = createApp({
  pluginConfigs: { consoleView: { preserveLog: true, maxLines: 2000 } }
});
await app.start();
app.consoleView.setFilter({ level: "error" });
```

From an MCP tool or another plugin:

```ts
const off = app.consoleView.subscribe(() => report(app.consoleView.counts().error));
off();
```

## Integration

- **link** keeps the watch while disconnected and re-sends it after every reconnect and session change.
- The bridge re-reads the trace once per heartbeat and after each run. It sends a value only when it changed.
- Ingest is incremental: only entries past the consumed count become lines. No timer, no heartbeat-driven read.
- **flowView** hooks `workspace:focus-frame`: it shows Flow and focuses the edge taken at that frame. consoleView calls no flowView api.
- **workspace** shows the badge on the Console rail item and runs the palette items and the `/` key.

## View

| Part | What |
|---|---|
| Toolbar | Level segments with counts (warn amber, error red when > 0). Search "Search the log"; Esc clears and blurs it. Clear. Preserve log switch. |
| Log table | `<table role="grid">`, sticky header, fixed 27 px rows, windowed (rows in view ± 20 with spacers). Frame links, level tags, `<mark data-hit>` hits, meta rows, a highlight on a fresh error. Auto-scroll at the bottom; otherwise an "N new lines ↓" pill. ↑/↓ move the selection, Esc closes the drawer. |
| Detail drawer | Time `HH:MM:SS.mmm`, level, source, frame link, raw event, data as pretty JSON. Close button and Esc. |
| Empty states | "No game connected. The log starts when a game connects." / "The log is empty. Lines appear here as the game logs." / "No lines match this filter." |

Log text renders as text nodes only, never as markup.
Each component has one sheet with `@scope ([data-panel="console"] [data-part="…"])` and no `@layer` wrapper (R7).
Reduced motion turns off the highlight and smooth scroll.

## Limits and game follow-ups

| Limit | Follow-up |
|---|---|
| `game.log` returns the whole trace on every read. | F-L1: a `since` input so a value carries only new entries. |
| Log entries carry no frame. The frame is `data.frame` or "at or before". | F-L1: a frame per entry. |
| Frame links focus Flow only roughly. | F-H1: `frame` on history entries (flowView side). |
