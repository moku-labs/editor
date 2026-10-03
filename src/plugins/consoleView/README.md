# consoleView

> Standard plugin (tools core). The Console workspace (design-context §6 A6, F6).

The Console shows the game's log trace (`game.log`) as a table: Frame, Level, Source, Message.
It has a level filter with counts, a search with highlight, Clear and Preserve log.
It also holds the errors of commands run from the tools page (D1 "Logged in Console") and feeds the Console rail badge (B2).

The plugin keeps the log for the whole session, not the panel.
So the badge and Preserve log work while another workspace is open.

## How the log arrives

- `onStart` opens one `link.watch("game.log")` for the session (R6).
- link keeps the watch while disconnected and re-sends it after every reconnect and session change.
- The bridge re-reads the trace once per heartbeat and after each run. It sends a value only when the trace changed.
- Ingest is incremental: only entries past the consumed count become lines.
- No timer and no heartbeat-driven read. `link.read` runs only in `refresh()`.

`game.log` entries carry no frame yet (follow-up F-L1).
A numeric `data.frame` gives an exact frame (`1778`).
Otherwise the frame is "at or before" the frame at which the value arrived (`≤1840`, with a tooltip).

A game page reload is detected by the first entry (`ts`, `event`) and by a trace shorter than the consumed count:

| Preserve log | What happens |
|---|---|
| off (default) | lines cleared, meta row "Log cleared: the game page reloaded. Turn on Preserve log to keep it." |
| on | lines kept, meta row "Game page reloaded · log preserved" |

## Configuration

| Option | Default | What |
|---|---|---|
| `maxLines` | `5000` | Most lines kept (entries and meta rows). The oldest go first. |
| `preserveLog` | `false` | Initial state of the Preserve log switch. |
| `freshMs` | `1200` | How long a fresh error row keeps its highlight, in ms. |
| `summaryChars` | `160` | Characters of non-string `data` shown inline in the Message cell. |

```ts
createApp({ pluginConfigs: { consoleView: { preserveLog: true } } });
```

## API

`app.consoleView` is `ConsoleApi`. The view, the palette items and tests use it.

| Member | What |
|---|---|
| `lines()` | Every held line, oldest first (a copy). |
| `visible()` | Entries of the filter level (`all` includes debug) whose `source + " " + message` contains the query, case-insensitive. Meta rows always. |
| `counts()` | `{ all, debug, info, warn, error }` over entry lines. |
| `filter()` / `setFilter(next)` | Read / merge `{ level, query }`. Notifies. |
| `clear()` | One meta row "Console cleared". Consumed entries never come back. Clears the badge. |
| `preserve()` / `setPreserve(on)` | Read / set Preserve log. Notifies. |
| `select(key?)` / `selected()` | The line in the detail drawer. `select()` closes it. |
| `refresh()` | One `link.read("game.log")`, ingested like a watched value. A failure logs `consoleView:read-failed` at debug. |
| `focusFrame(frame)` | Emits the global `workspace:focus-frame { frame }`. flowView hooks it. |
| `subscribe(fn)` | Change listener; returns an idempotent unsubscribe. |

```ts
app.consoleView.counts(); // { all: 8, debug: 0, info: 6, warn: 2, error: 0 }
app.consoleView.setFilter({ level: "warn", query: "texture" });
app.consoleView.visible().length; // 2
app.consoleView.focusFrame(1778); // flowView shows Flow at frame 1778
```

## Lines

- **Source:** the event head before the first `:` when it matches `^[A-Za-z][\w.-]{0,23}$`, else `plugin`, else `game`.
- **Message:** the rest of the event, plus the data: a string joins with ` · `, other JSON is stringified and cut at `summaryChars` with `…`.
- **Command error (D1):** level `error`, source `editor`, message `-32602 game.step: frames must be a number`. The `[moku-editor]` prefix is stripped with `bareMessage` (R7).

## Rail badge

`warn + error`, red when any error, label like `2 warn · 1 error`.
None when both are zero. It counts what the Console holds, not what is unseen.

## Events and hooks

- **Declares:** no events.
- **Emits:** the global `workspace:focus-frame { frame }` (frame links, `focusFrame`).
- **Hooks:** `link:status` (re-renders the view; reads nothing), `workspace:ran` (a failed run appends the D1 line and pushes the badge; a successful run does nothing).
- **Requires:** `linkPlugin` (watch, read, status), `workspacePlugin` (badge, palette, keys), `panelsPlugin` (register). No view.

## Lifecycle

- **onInit:** registers the `console` panel (`sources: {}`).
- **onStart:** the `game.log` watch; palette items "Clear console" and "Preserve log: on / off"; the key `/` focuses the search in Console; clears a stale badge.
- **onStop:** drops the watch, the palette items, the key binding and every view listener.

## View

| Part | What |
|---|---|
| Toolbar | Segmented level control with counts (warn amber, error red when > 0), search ("Search the log"; Esc clears and blurs it), Clear, Preserve log switch. |
| Log table | `<table role="grid">`, sticky header, fixed 27 px rows, windowed (rows in view ± 20 with spacers). Frame links, level tags, `<mark data-hit>` search hits, meta rows, a 1.2 s highlight on a fresh error. Auto-scroll at the bottom; otherwise an "N new lines ↓" pill. ↑/↓ move the selection, Esc closes the drawer. |
| Detail drawer | Time `HH:MM:SS.mmm`, level, source, frame link, raw event, data as pretty JSON. Close button and Esc. |
| Empty states | "No game connected. The log starts when a game connects." / "The log is empty. Lines appear here as the game logs." / "No lines match this filter." |

Log text renders as text nodes only, never as markup.
Each component has one sheet with `@scope ([data-panel="console"] [data-part="…"])` and no `@layer` wrapper (R7).
Only `data-*` attributes and elements are selected; reduced motion turns off the highlight and smooth scroll.
