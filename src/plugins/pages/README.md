# pages

> Complex plugin (server core). It serves the tools page and its assets from the editor server. It also serves the `hello` route that the game page's bridge calls to learn the websocket URL and the token. The `moku-editor` bin lives here too, with its `mcp` and `mcp-config` subcommands and the `.moku/editor.json` discovery file.

`onInit` checks the config, finds the built page and registers five routes with `hub.addRoutes`. There is no `onStart` and no `onStop`. After `stop` the hub has no token, so the page, `hello` and a `hmr` POST answer 503.

## Configuration

Set through `pluginConfigs.pages`. Defaults are in `index.ts`.

| Option | Type | Default | Meaning and rule |
|---|---|---|---|
| `title` | `string` | `"moku editor"` | Tools page `<title>` and `ToolsBoot.title`. 1 to 120 characters. |
| `editorUrl` | `string` | `"vscode://file/{path}:{line}"` | "Open in editor" link template. `{path}` is the absolute file path, `{line}` the 1-based line. Must contain `{path}`. The scheme cannot be `javascript`, `data` or `vbscript`, in any case. |
| `pageDir` | `string \| undefined` | `undefined` | Folder with the built page (`index.html` and `assets/`). A set value wins, built or not. `undefined` tries `dist/tools` next to the bundled module, then the repo `dist/tools`. |
| `gameUrl` | `string` | `"/"` | Same-origin URL of the game page the tools page embeds. Starts with `/`, not with `//`, and has no `\`. |

A bad value makes `createApp` throw `[moku-editor] pages.<field> <problem>.` with a fix line below it.

## API

`app.pages` (`PagesApi`):

| Member | Signature | Notes |
|---|---|---|
| `routes` | `routes(): EditorRoutes` | A copy of the routes registered with the hub in `onInit`. |
| `attachServer` | `attachServer(options: BunServeOptions, restart?: RestartServer): void` | The bin calls it right after its first `Bun.serve`. The bin owns hot reload from then on; HMR is read from `options.development`; the state is published with `hub.publish("hotReload", …)`. `restart(options)` stops the bin's current server and serves `options` on the same port; with it `setHotReload` can switch (see Hot reload). |
| `hotReload` | `hotReload(): HotReload` | A fresh `{ hmr, owner }`. Owner `"server"` with `hmr: false` until `attachServer`. |
| `setHotReload` | `setHotReload(on: boolean): Promise<boolean>` | The bin with a restart switches: true at once, the server restarts after the answer. The same value answers true. Owner `"server"` always answers false. Publishes the state in every case. |

```ts
Object.keys(editor.pages.routes()); // ["/__editor", "/__editor/", "/__editor/hello", "/__editor/hmr", "/__editor/assets/*"]
editor.pages.hotReload(); // { hmr: true, owner: "bin" } in the bin
await editor.pages.setHotReload(false); // true: the bin's server restarts without HMR
```

`AttachedServer` is `{ port?, stop(closeActiveConnections?) }`; Bun's Server is one. `serve.ts` uses it for the bin's game server. `RestartServer` is `(options: BunServeOptions) => Promise<void>`. Both are in `types.ts`.

### Hot reload (R6, D-23, D-32)

The bin serves the game with Bun HMR on: Bun reloads the game page after a source save. The
editor does not hold, delay or queue that reload; the bridge keeps the game state across it
(see bridge README, Checkpoint). `--no-hmr` starts the bin without it.

The Hot reload switch changes it while the bin runs. Bun cannot switch HMR on a running server
(spike below), so the bin restarts its server with HMR flipped, on the same port (D-32):

1. `POST P/hmr { hmr }` calls `setHotReload(on)`. The bin owns the server, gave its restart, and
   `on` differs from `hmr`.
2. The asked state is set and published (`hotReload` to every tools page) at once. The POST
   answers 200 with it.
3. On the next macrotask, after the answer went out (A1), `restart(next)` runs. `next` is the
   current options with `development.hmr` flipped; the other `development` fields stay.
4. The restart (`serve.ts`) first awaits `hub.closeAll(1012, "editor restarting")`: every agent
   and tools socket gets a clean close 1012 instead of a dropped socket (1006), and the stop
   waits until Bun reported the closes, at most 500 ms, so the close frames go out. Then it stops the
   current server with its open connections, waiting at most 500 ms, and serves `next` on the same
   port. A bin started with `--port 0` keeps its port.
5. The hub plugin is not stopped. The token and `.moku/editor.json` stay. The tools page's link
   and the game's bridge log the 1012 close at info and reconnect: link retries after 1 s, the
   bridge fetches `hello` again.
6. Success logs `pages:hot-reload-switched { hmr }`.
7. A failure, such as a port taken in between, logs `pages:hot-reload-restart-failed`. The old
   state is published again and the old options are served again. A failure of that logs
   `pages:hot-reload-serve-again-failed`.

The game page has to load again to gain or drop Bun's HMR client (`/_bun/client`). workspace
reloads the game frame with its state after an accepted switch (workspace README, Hot reload).

| `setHotReload(on)` | Answer | What happens |
|---|---|---|
| Owner `"server"` | false | Nothing. The state is published unchanged. |
| The bin, `on` equals `hmr` | true | Nothing. The state is published. |
| The bin with its restart, `on` differs | true | The switch above. |
| The bin without a restart (`attachServer` with one argument) | false | `pages:hot-reload-read-only` at info. The state stays. |

History: why the switch restarts the server. **Spike, Bun 1.3.14: `server.reload` does not
switch HMR.** Verified with a real Chromium page on a `Bun.serve` with an HTML route:

| Start | `server.reload({ ...options, development: { hmr } })` | Result |
|---|---|---|
| `hmr: false` | `hmr: true` | The page keeps the production bundle: no `/_bun/client` script, `/_bun/hmr` refuses the socket, a save does not reload. |
| `hmr: true` | `hmr: false` | The page keeps the HMR client; a save still reloads the page, also after a manual page reload. |

Spike 2026-10-05: `await server.stop(true)`, then `Bun.serve({ ...options, development: { hmr:
!hmr, console: true } })` on the same port works. The page HTML gains or loses `/_bun/client`.
The bin integration test flips it twice and checks both.

| `hotReload()` | When |
|---|---|
| `{ hmr: true, owner: "bin" }` | The moku-editor bin (it passes `development: { hmr: true, console: true }`). |
| `{ hmr: false, owner: "bin" }` | The moku-editor bin started with `--no-hmr` (it passes `development: { hmr: false, console: true }`). |
| `{ hmr, owner: "bin" }` | `attachServer` with other options: `development: true` or an object whose `hmr` is not false is on; `false` or no `development` is off. |
| `{ hmr: false, owner: "server" }` | A game's own `Bun.serve` that never called `attachServer`. |

### Routes

`P = hub.path()` (default `/__editor`). Each handler runs `hub.guard(req, server, mode)` first and returns its refusal. Methods other than GET and HEAD get 405 with `Allow: GET, HEAD` (`P/hmr` also takes POST: `Allow: GET, HEAD, POST`). HEAD keeps the headers and drops the body.

| Route | Guard mode | Answer |
|---|---|---|
| `P` | `navigate` | 308 to `P/`. The query is kept. |
| `P/` | `navigate` | The tools page with the boot tag. 503 when the page is not built, when `index.html` has no `</head>`, or before start. |
| `P/hello` | `same-origin` | `HelloBody` JSON `{ ws, token }`. No CORS headers. 503 before start. |
| `P/hmr` | `same-origin` | GET: `HotReload` JSON `{ hmr, owner }`. POST `{ hmr: boolean }` with `Authorization: Bearer <boot.token>`: 200 with the state. For a switch the bin makes, that is the asked state, and the server restarts after the answer. A refused change (a game's own server) also answers 200: the caller compares `hmr` with the asked value. 401 without the token, 400 for another body (or over 1024 characters), 503 before start. |
| `P/assets/*` | `navigate` | A regular file of `pageDir/assets/`. 404 for an unsafe or missing name. 400 for a malformed escape. |

Headers:

| Route | Header | Value |
|---|---|---|
| `P/` | `content-type` | `text/html; charset=utf-8` |
| `P/` | `cache-control` | `no-store` (the token rotates per start) |
| `P/` | `referrer-policy` | `no-referrer` |
| `P/` | `content-security-policy` | `PAGE_CSP`: the R3 policy, then `frame-ancestors 'none'; base-uri 'none'; form-action 'none'` |
| `P/hello`, `P/hmr` | `content-type`, `cache-control` | `application/json; charset=utf-8`, `no-store` |
| `P/assets/*` | `cache-control` | `public, max-age=31536000, immutable` (names are hashed) |
| all | `x-content-type-options` | `nosniff` |

`PAGE_CSP` (exported from `routes.ts`):

```
default-src 'self'; script-src 'self'; worker-src 'self' blob:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:* ws://localhost:*; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'
```

### Boot tag

On each page request `buildBoot` makes a `ToolsBoot` and `injectBoot` puts it before the first `</head>` as `<script type="application/json" id="moku-editor-boot">`. It also writes the escaped `title` into the first `<title>`.

| Key | Value |
|---|---|
| `v` | `1` |
| `ws` | `ws://<Host><P>/ws`, no query |
| `token` | `hub.token()` |
| `path` | `hub.path()` |
| `title`, `editorUrl`, `gameUrl` | From the config |
| `root` | `files.root()` |

`safeJson` escapes `<`, `>`, `&`, U+2028 and U+2029, so no value can close the script tag. `escapeHtml` escapes `& < > " '`. The token appears only in this tag and in the `hello` body.

### Asset names and types

An asset name must match `[\w.-]` segments joined by `/`. No segment may start with `.`. `contentType` (`mime.ts`) maps `js mjs css map json html svg png jpg jpeg webp woff2 woff wasm txt md`. Text types get `; charset=utf-8`. Anything else is `application/octet-stream`.

## Events

| Kind | Name | Payload | When |
|---|---|---|---|
| Emits | none | | |
| Hooks | none | | |

Log lines (not events):

| Level | Name | Data | When |
|---|---|---|---|
| warn | `pages:not-built` | `{ tried }` | `onInit` found no candidate folder with `index.html`. |
| info | `pages:hot-reload` | `{ hmr, owner }` | `attachServer`. |
| info | `pages:hot-reload-switched` | `{ hmr }` | The bin's server restarted with the asked HMR. |
| info | `pages:hot-reload-read-only` | `{ hmr }` | A change asked of a bin attached without a restart; `hmr` stays. |
| error | `pages:hot-reload-restart-failed` | `{ hmr, message }` | The restart with the asked HMR failed. The old state is published again. |
| error | `pages:hot-reload-serve-again-failed` | `{ hmr, message }` | Serving the old options again failed too. |
| error | `pages:not-built` | `{ pageDir }` | First `P/` request with no readable template. Once per app. |

## Dependencies

| Kind | Value |
|---|---|
| `depends` | `[filesPlugin, hubPlugin]` |
| `filesPlugin` | `root()` for `ToolsBoot.root` |
| `hubPlugin` | `addRoutes` (in `onInit`), `guard`, `path`, `token`, `publish` |
| Global events | none |
| Protocol types | `ToolsBoot`, `HelloBody`, `HotReload` from `registry/protocol` |
| Engine page (bin) | `preparePage` of `@moku-labs/game/cli` (game `>= 0.10.0`), imported from the game root at run time; the source imports only its types |

## Usage

```ts
import { createApp } from "@moku-labs/editor/server";
import index from "./index.html";

const editor = createApp({
  pluginConfigs: {
    files: { root: `${import.meta.dir}/..` },
    pages: { editorUrl: "cursor://file/{path}:{line}" }
  }
});
await editor.start();
Bun.serve(editor.hub.serve({ port: 3000, routes: { "/": index } }));
// tools page: http://127.0.0.1:3000/__editor/
```

## Tools page

Source in `page/`:

| File | Role |
|---|---|
| `index.html` | Bare shell with `[data-editor-root]`. No inline style or script. |
| `index.css` | CSS entry. Imports `workspace/styles/index.css`, then every view sheet in `layer(components)`. No rule of its own. |
| `main.tsx` | `createApp({})` from `tools`, `await editor.start()`, then `editor.workspace.mount(root)`. On a throw it writes the message into the root and sets `data-editor-fatal`. |

`bun run build:tools` runs `scripts/build-tools.ts [--outdir dir]`. It bundles `page/index.html` with `Bun.build` into `dist/tools/`. Bun would inline the woff2 fonts as data URLs, which the CSP refuses. So the script marks `*.woff2` external and copies the fonts into `assets/` with hashed names. Then it runs the layout checks: `index.html` at the root, every other file under `assets/`, `</head>` present, every `src`/`href` starts with `./assets/`, one stylesheet, at least one woff2. `bun run build` runs tsdown, then `build:tools`.

## Bin

```
moku-editor [--root DIR] [--preload FILE]… [--serve-plugin FILE]… [--port 3000] [--no-hmr]
moku-editor <game-html> [--port 3000] [--root .] [--no-hmr] [--help]
moku-editor mcp [<game-html>] [--port N] [--root DIR] [--no-hmr]
moku-editor mcp-config [<game-html>] [--port N]
moku-editor e2e -c <playwright config> [playwright args…]
```

`package.json` maps `moku-editor` to `./dist/bin.mjs` (from `bin.ts`). Bun only.

| Flag | Short | Default | Rule |
|---|---|---|---|
| `--port` | `-p` | `3000` | Digits, 0 to 65535. `0` picks a free port. |
| `--root` | `-r` | `.` | Project root the editor reads and writes; the moku-game folder of the engine page. Not empty. |
| `--no-hmr` | | hot reload on | Serves the game without Bun HMR. Takes no value. |
| `--preload` | | none | A file Bun preloads in the serving process. Repeatable, kept in order. Engine page only. |
| `--serve-plugin` | | none | A Bun plugin the engine page bundles with, after the engine's hot plugin. Repeatable, kept in order. Engine page only. |
| `--help` | `-h` | | Prints usage, exit 0. |

The positional is optional: at most one file ending in `.html`. Without it the bin serves the engine page (see Engine page). `--preload` and `--serve-plugin` with an html file are an error: "--preload and --serve-plugin need the engine page: drop the html file". Paths stay as given; the bin resolves them against the cwd. Unknown flags are errors, so there is no `--host`. The server always binds 127.0.0.1.

### Engine page

A game written for `moku-game` (a folder with `index.ts` and `config.ts`, no `web/`) runs with `moku-editor --root <game>` and no html (`runEngine` in `cli.ts`, `engine-page.ts`, B5). The game needs no `web/index.html`, no dev entry, no `[serve.static]` in its own `bunfig.toml` and no agent wiring.

1. First the real process. Without it (`deps.reexec`, unit seams) the bin prints "[moku-editor] the engine page needs the real process: pass the game HTML file" and exits 1. Then the folder: `rootPath = resolve(cwd, root)`. A folder without `index.ts` or `config.ts` prints "[moku-editor] <root> has no index.ts and config.ts: pass the game HTML file, or run in a moku-game folder" and exits 2.
2. The bin imports `@moku-labs/game/cli` as the game root resolves it (`Bun.resolveSync`), never from the editor's own `node_modules`. When it does not resolve, or has no `preparePage`: "[moku-editor] @moku-labs/game/cli does not resolve from <root>: install @moku-labs/game >=0.10.0 in the game", exit 1.
3. `preparePage(rootPath, { agents: ["@moku-labs/editor/agent/page"], preload, servePlugins })` writes `<root>/.moku/index.html`, `main.ts`, `dev.ts` and `bunfig.toml`. `preload` and `servePlugins` are the flags resolved against the cwd. A throw prints the engine's `[game] …` message as is, exit 1.
4. Editor working tree (D-50): `packageRoot(Bun.main)` is the nearest folder above the bin's real path whose `package.json` is named `@moku-labs/editor` (`dist/bin.mjs` and `src/plugins/pages/bin.ts` both find it). When that folder is not inside `realpath(<root>)/node_modules` and `<packageRoot>/scripts/tree/bundle.ts` exists, that file is appended to `servePlugins` (once). The plugin sends `@moku-labs/editor`, `/agent`, `/agent/page` and `/tools` to the tree's `dist/`, and rewrites the shared imports of those files (engine, Pixi, core, common, preact) to the game's copies when they load (never in `onResolve`: demos#46). The published package has no `scripts/`, so an installed editor never adds it.
5. The bin always re-runs itself (D-51): Bun reads `--config=` only at process start. `reexecEngine` (`reexec.ts`) spawns `[process.execPath, "--config=<root>/.moku/bunfig.toml", Bun.main, <root>/.moku/index.html, "--root", <root>, "--port", <port>]` (plus `--no-hmr`), with `cwd: root`, `MOKU_EDITOR_REEXEC=1`, detached, SIGINT/SIGTERM/SIGHUP forwarded, and exits with the child's code.
6. The child serves `<root>/.moku/index.html` as any re-spawned bin (the html path below): the engine's hot plugin, `[serve.static]`, the dev define and the preloads come from that bunfig. The static fallback refuses dot segments, so `.moku/` is never served as files; the page is the `/` route bundle. The discovery file's `html` is `<root>/.moku/index.html`.

### bunfig.toml of the game root

The `bunfig.toml` of the game root is honoured. Hot swap needs `[serve.static] plugins = ["@moku-labs/game/hot"]` in it.

Bun reads `[serve.static] plugins` once, at process start, from the `bunfig.toml` in the process cwd. `process.chdir` comes too late (spike, Bun 1.3.14). So the bin re-spawns itself in the root (`reexec.ts`):

| Rule | Value |
|---|---|
| When | `run` only. The root's `bunfig.toml` has a `[serve.static]` table, and the cwd is another folder (real paths compared). |
| Child | The same bin (`[process.execPath, Bun.main]`) with absolute html and root, the same port, and `--no-hmr` when hot reload is off. `cwd` is the root. stdio is inherited. |
| Loop guard | The child gets `MOKU_EDITOR_REEXEC=1` and never re-spawns. |
| Signals | The parent forwards SIGINT, SIGTERM and SIGHUP. The child runs in its own process group, so a terminal Ctrl+C reaches it once. |
| Exit | The parent exits with the child's code. |
| Orphan | A parent killed by SIGKILL forwards nothing. The child reads `process.ppid` every second (an unref'd timer). Once it changed, the child stops gracefully (discovery file, editor, game server), prints "stopped" and exits 0. |
| Discovery | The child writes `.moku/editor.json`, so `pid` is the child's. |

Started from the game root, or from the MCP launcher (it spawns with `cwd: root`), the bin serves itself as before.

### Subcommands

A first positional `mcp` or `mcp-config` picks a subcommand (`args.ts`). Anywhere else it is a second positional and an error. A first word `e2e` picks `e2e` before any other check, so its `--help` goes to Playwright.

| Subcommand | `BinArgs` | What it does |
|---|---|---|
| `mcp [<game-html>] [--port N] [--root DIR] [--no-hmr]` | `{ kind: "mcp", html?, port?, root, hmr }` | The stdio MCP server for Claude Code (`mcp/`). A live `.moku/editor.json` under `root` (default `.`) wins; `html`, `port` and `hmr` only feed the bin it starts when none runs. `port` is absent unless `--port` is given. |
| `mcp-config [<game-html>] [--port N]` | `{ kind: "mcp-config", html?, port? }` | Prints the `.mcp.json` snippet, a blank line and the `claude mcp add` line to stdout, verbatim, then exits 0. `--root` and `--no-hmr` are errors here. |
| `e2e -c <playwright config> [playwright args…]` | `{ kind: "e2e", config, rest }` | `e2e.ts`, D-52, D-53: one Playwright process, so one fresh editor bin, per project and spec file, because Bun's dev server degrades after many hot reloads in one process. The plan comes from `bun x playwright test -c <config> --list --reporter=json --pass-with-no-tests <files> --project=<p>… <other> <listOnly>` (`listPlan`: projects in config order, files in list order, unnamed projects skipped), so the user's `--project`, files and `-g` narrow it. Each pair runs as `--project=<name> ^<rootDir>/<file>$ --pass-with-no-tests <other> <reporters>` (`fileFilter`, escaped, `/` separators) with `PORT` = `PORT` (else 4417) + its index, one after another, all of them. `splitRest` sorts the words: `--project X Y…` (variadic, up to the next `-` word) or `--project=X`; files (a word not starting with `-` and not a flag's value); `--reporter` / `--add-reporter` (runs only); `--shard` / `--last-failed` (list only); the rest. After each run `ui.info("<project> · <file> · passed|failed (code N) · <s> s")`, at the end `ui.info("e2e: <n> runs · <failed> failed · <s> s")`. A failed run's line and a failing summary print as errors; a warning names the tests of an unnamed project that did not run. A `--list`, an empty plan or no named project runs once as given. `CI=true` installs Chromium first. Only `-c` / `--config` is read (missing: "[moku-editor] e2e needs the Playwright config: -c <file>", exit 2); exit: the first failing code, 1 when the list fails ("[moku-editor] could not list the tests of <config>: <reason>"), else 0. |

Both take at most one `.html` positional and the same `--port` rule. Both refuse `--preload` and `--serve-plugin`: "--preload and --serve-plugin belong to the serving bin". `mcp-config` writes only what was given:

```
$ moku-editor mcp-config web/index.html --port 3000
{
  "mcpServers": {
    "moku-editor": {
      "type": "stdio",
      "command": "bunx",
      "args": [
        "moku-editor",
        "mcp",
        "web/index.html",
        "--port",
        "3000"
      ]
    }
  }
}

claude mcp add moku-editor -- bunx moku-editor mcp web/index.html --port 3000
```

The shell line single-quotes a word with a space or a quote (`mcp-config.ts`).

### Discovery file

After `Bun.serve` the bin writes `<root>/.moku/editor.json` (`discovery.ts`). The MCP bridge reads it to find the running editor.

```json
{ "version": 1, "pid": 4242, "port": 3000, "url": "http://127.0.0.1:3000", "ws": "ws://127.0.0.1:3000/__editor/ws", "token": "<hub token>", "root": "/abs/game", "html": "/abs/game/web/index.html", "startedAt": 1759600000000 }
```

| Rule | Value |
|---|---|
| Type | `EditorDiscovery` (`types.ts`) |
| Mode | `0600`. It holds the hub token. Never printed or logged. |
| Write | `.moku/` created when missing, a fresh temp file `editor.json.<pid>.tmp`, then a rename. A reader never sees half a file. |
| Removed | On stop (SIGINT, SIGTERM) before the editor stops, and in a process `exit` listener. Only when the file still carries this pid: a newer bin's file stays. |
| Write fails | One warning `[moku-editor] could not write .moku/editor.json: <reason>`. The bin keeps serving. |
| Served | No. The static fetch answers 404 for a segment starting with `.`. |

A bin killed with SIGKILL leaves the file behind. The bridge treats a dead pid as no bin.

### MCP bridge (`mcp/`)

`moku-editor mcp` is the stdio MCP server Claude Code starts (D-31). It is a separate process, not a plugin: plain modules that use only `registry/protocol`, `../discovery`, `../types`, `package.json`, `@moku-labs/common/cli` (stderr console) and Bun/node built-ins. It is a hub **tools client**, like the tools page, so the hub picks the session, checks ids and inputs and keeps the files sandbox (D-09) exactly as for the page.

| File | Role |
|---|---|
| `bridge.ts` | `runBridge(args)`: stdin to the dispatcher until stdin ends or a SIGINT or SIGTERM arrives, then the same teardown. Exit code 0. |
| `rpc.ts` | Newline-delimited JSON-RPC 2.0. stdout carries only protocol frames; logs go to stderr. |
| `server.ts` | `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`, `logging/setLevel`, `notifications/cancelled`. |
| `hub-client.ts` | `${ws}?token=…&kind=tools` with `Origin: http://127.0.0.1:<port>`. Sessions, heartbeats, `hotReload`, game, files and editor requests, `watch`/`value`/`unwatch`. The bridge is a plain tools client, never `role=page`. |
| `discovery.ts` | Reads `.moku/editor.json`; `process.kill(pid, 0)` tells a live bin from a stale file. |
| `launcher.ts` | Starts `moku-editor <html> --port <port> --root <root> [--no-hmr]` detached, output in `.moku/editor.log` (0600), waits at most 15 s for its discovery file. |
| `connection.ts` | The bin side: startup, reconnect once, start, stop only an owned bin. Reports each open and each lost connection (`onConnected`, `onDisconnected`). |
| `tools.ts` and `*-tools.ts` | The generic tool table. `schema.ts` checks arguments, `results.ts` builds content, `shapes.ts` reads hub answers. |
| `door-tools.ts` | One tool per command door of the selected session (D-35), rebuilt only when the session's `manifestHash` moves (D-37). `follow(client)` listens to the sessions of each hub client the link opens; `unfollow()` starts the 5 s grace. |

Protocol:

| Message | Answer |
|---|---|
| `initialize` | `{ protocolVersion, capabilities: { tools: { listChanged: true }, logging: {} }, serverInfo: { name: "moku-editor", version }, instructions }`. Versions `2025-11-25`, `2025-06-18`, `2025-03-26`: the client's when listed, else `2025-11-25`. No `protocolVersion`: -32602. `instructions` says which tools are generic, which are doors, and that the list changes. |
| `ping`, `logging/setLevel` | `{}` |
| `tools/list` | The generic tools below, then the door tools. The first `tools/list` waits for the door tools at most 3 s; later ones answer at once. |
| `tools/call` | The tool result. No `name` or an unknown tool: -32602. A door tool that is gone: `isError` "`<name>` is gone: the game changed. Call moku_manifest, or moku_run { id }." Bad arguments: an `isError` result naming the argument, so the model can fix the call. |
| An unknown method | -32601. Claude Code 2.1.280 sends `server/discover` (draft protocol 2026-07-28) first and falls back to `initialize` on this answer. |
| A line that is not JSON | -32700 with id `null` |
| A message without id | Never answered. `notifications/cancelled {requestId}` aborts that call (a `moku_wait` unwatches) and drops its answer. Others are ignored. |

The handshake of the installed Claude Code (2.1.280) is recorded in `__tests__/fixtures/claude-discover-probe.json` and `claude-initialize.json` (captured from its stdin during `claude mcp list`): `server/discover`, then `initialize` with `protocolVersion: "2025-11-25"` and id 0, `notifications/initialized`, `tools/list`. `unit/mcp/claude-code.test.ts` replays it.

`serverInfo.version` is the package version, inlined from `package.json` at build time. `notifications/progress` goes out during `moku_wait` and `moku_series` when the request carries `_meta.progressToken`. `notifications/tools/list_changed` goes out only when the door tools change (below), and never before the first `tools/list` was answered: that list already reads the new tools. A change after it but before `notifications/initialized` is kept and sent once right after it.

Which bin:

1. A live `.moku/editor.json` under `--root` (default the working directory) wins: its port, token and socket URL. A different `--port` prints one stderr line.
2. Without one, the bridge starts the bin when it knows a game html: the argv `<html>`, else the html of the last discovery file it saw (a stale one counts). Port: `--port`, else the last port, else 3000. The bridge then owns that bin.
3. Without an html, tools answer `isError`: "moku-editor is not running. Start it (`bunx moku-editor web/index.html --port 3000`) or call moku_start." `moku_status` answers `running: false` with that hint instead.
4. When the hub socket closes, the bridge reads the discovery file again and reconnects once. Every later tool call tries one connect to a live bin; `moku_start` starts one.
5. On stdin end, SIGINT or SIGTERM (the same steps): pending calls are aborted, every watch is dropped, the socket closes. An owned bin gets SIGTERM, then SIGKILL after 2 s. A bin the bridge did not start keeps running. The signal handlers stay until the teardown is done, so a second Ctrl+C cannot leave an owned bin behind. After a signal the bridge lets go of stdin, so the process exits 0 even while the client keeps the pipe open. Lines that arrive after a signal are not handled.

Generic tools. Every name starts with `moku_`; every input schema is a closed object (`additionalProperties: false`); every game tool takes an optional `session` (the hub rule picks one otherwise; `choose_session` answers `isError` listing the sessions). Annotations are static (M6): `readOnlyHint: true, openWorldHint: false` for the read-only tools; the others below.

| Tool | Input | Does | Annotations |
|---|---|---|---|
| `moku_status` | `{}` | running, owned, game and tools URLs, port, pid, root, html, hot reload, sessions with heartbeat | read-only |
| `moku_sessions` | `{}` | sessions with `heartbeat { frame, paused, silent }` and `manifestHash` | read-only |
| `moku_manifest` | `{ session? }` | game, page, sources and commands | read-only |
| `moku_read` | `{ id, input?, session? }` | hub `read` | read-only |
| `moku_wait` | `{ id, input?, until?, changedFrom?, timeoutMs? (100–25000, 10000), session? }` | hub `watch` until the value deep-equals `until`, differs from `changedFrom`, or (neither) first changes; `{ timedOut, value, waitedMs }`; always unwatches | read-only |
| `moku_run` | `{ id, input?, session? }` | hub `run`; text `effect: <effect>` then `{ value, frame, state }` | destructive, not idempotent |
| `moku_screenshot` | `{ maxWidth? (64–4096, 1080), key?, format? ("jpeg" \| "png", "jpeg"), session? }` | liveness check, `editor.capture { maxWidth, format, key? }` (`key` crops to that ui element plus 8 px; an unknown key answers the agent's -32602), image and `{ frame, device, key?, maxWidth, kb }` | read-only |
| `moku_series` | `{ frames? (2–12, 6), everyMs? (1–5000, 500), session? }` | liveness check, game ≥ 0.4 check (`game.capture` lists `sheet`), then `editor.sheet { frames, everyMs, maxWidth: 1080, format: "jpeg" }`, or `game.capture { sheet }` at full size when the agent has no `editor.sheet`; one image and `{ frames, everyMs, columns, frame, maxWidth?, kb }` | read-only |
| `moku_reference` | `{ id? ("latest") }` | a reference card and its crop image. Cards are `.moku/captures/<YYYY-MM-DD>/*.md` (day folders, newest day first; other folder names do not count) and the older flat `.moku/captures/*.md`. `"latest"` is the newest card of all by modification time; a name (`.md` optional) is the newest card with that name; a path is that card. The crop link is read next to the card, never from the bin's private files | read-only |
| `moku_selection` | `{ session? }` | hub `editor.selection`: the `SelectionInfo` the editor page published, as JSON, then its `crop` read with `files.readBinary`. `null` answers "Nothing is selected in the editor."; a selection of another session than the asked one says whose it is | read-only |
| `moku_select` | `{ key?, rect? { x, y, w, h }, card? (true) }` | exactly one of `key` (a ui key, `"hud/infoBar"` allowed) or `rect` (an area in game page CSS px); hub `editor.select`, relayed to the editor page, which picks like the Reference picker; the `SelectionInfo` as JSON and its crop. An area with no element is a valid selection: the text starts with the line "No elements in the area.", then the JSON and the area's picture. No editor page open: the hub's -32003 `no_editor_page` with the URL to open | not destructive, not idempotent |
| `moku_files_list` | `{ dir? ("") }` | hub `files.list` without `.moku/editor.json` and `.moku/editor.log` | read-only |
| `moku_files_read` | `{ path }` | `{ path, version }`, then the text | read-only |
| `moku_files_write` | `{ path, text, version? }` | hub `files.write` | destructive, not idempotent |
| `moku_reload` | `{ restore? (true), session? }` | `editor.reload`, then waits at most 15 s for the game to connect again; `{ restored, frame, session, game }`. A -32001 on that run is expected. | not destructive, not idempotent |
| `moku_start` | `{ html?, port? }` | starts the bin when none runs | not destructive, idempotent |
| `moku_stop` | `{}` | stops an owned bin; another bin answers `isError` | destructive, idempotent |

Door tools (D-35, D-36, D-37). Each command door of the selected session gets its own tool with a typed input schema, so the model does not guess `input` for `moku_run`. Sources stay behind `moku_read`.

| Rule | |
|---|---|
| Name | The id with `.` as `_`: `game.tap` is `game_tap`, `timber.openShop` is `timber_openShop`. Cheat and raw doors carry the effect first: `cheat_game_fill`, `raw_game_restore`. |
| No tool | A name that starts with `moku_` or is longer than 40 characters, an id outside `[A-Za-z0-9._-]`, an input field named `_session` or outside `[A-Za-z0-9_-]{1,64}`, two doors with the same name (both), and the doors the generic tools cover: `game.capture`, `editor.capture`, `editor.sheet`, `editor.series`, `editor.seriesStop`, `editor.reload`. Screenshots go only through `moku_screenshot`: JPEG by default, about 300 KB at most. Each is logged once per hash on stderr; `moku_run` still runs it. |
| Input | One property per field: `string`, `number` (any finite number), `boolean`, and `json` (any JSON). Fields without `?` are required. `_session` routes the call to another session. |
| Run | Hub `run { id, input }` (`input` left out when empty) in the session; the answer reads like `moku_run`: `effect: <effect>`, then `{ value, frame, state }`. |
| Description, annotations | `[<effect>] <title>. Command door <id> of <game>. Same as moku_run { id: "<id>" }.` `read` is read-only; `route` and `cosmetic` are not destructive; `cheat` and `raw` are destructive. Claude Code ignores annotations for permissions, so the name prefix is the guard. |
| Selected session | The one `moku_run` uses without `session`: the only one, else the one embedded. Several without one embedded: no door tools. |
| Change | The hub stamps `manifestHash` (the hash of the commands) on every session. The doors are rebuilt, and `list_changed` sent, only when that hash moves. Without a session the set stays 5 s, so a hot reload of the same game changes nothing. A bin without `manifestHash` is fetched once per session. A failed manifest fetch keeps the set and settles the wait of the first `tools/list`; the next `sessions` push retries. |

Deny the cheat and raw doors in Claude Code settings:

```json
{ "permissions": { "deny": ["mcp__moku-editor__cheat_*", "mcp__moku-editor__raw_*"] } }
```

A client that does not refresh its list after `list_changed` keeps the old door tools. A door that is gone answers `isError`; `moku_run` runs every door.

Results: a text item first (pretty JSON or a message), then images as `{ type: "image", data, mimeType }`. The `mimeType` follows the data URL the editor answered: `image/jpeg` for the default JPEG pictures (D-34), `image/png` for `format: "png"`. A page that cannot decode or encode the picture (no canvas, such as a headless agent) answers the game's own PNG, and the image item says `image/png`. A screenshot above 300 KB of base64 is taken once more at half its width: half of `maxWidth`, or half of the picture when the picture is narrower (its width is read from the PNG header or the JPEG SOF0/SOF2 frame header). A picture still above 300 KB (the page could not shrink it, or a contact sheet, which is not taken twice) is answered anyway, with `note` giving its size. A contact sheet comes from `editor.sheet`, shrunk in the page to 1080 px wide; an agent without `editor.sheet` (an older capture plugin) gets `game.capture { sheet }` at full size.

Liveness (M7): screenshot and series read the session's heartbeat first. Paused or silent answers `isError` "game paused or hidden at frame N — bring the editor pane to front or resume" instead of a timeout. The heartbeat is the hub's `sessions` readout, kept current by the forwarded `game.heartbeat` notifications.

Safety: `.moku/editor.json` holds the token. The bridge never prints or logs it, hides it and `.moku/editor.log` from `moku_files_list`, and refuses both in `moku_files_read` and `moku_files_write` (any spelling: `./`, `//`, letter case). There is no network surface: stdio only.

What `main` (`cli.ts`) does:

1. `parseBinArgs(argv)`. Help prints usage. An error prints it and usage. `mcp-config` prints the Claude Code setup and exits 0. `mcp` runs `runBridge(args)`, which catches SIGINT and SIGTERM itself, and exits with its code (0) when stdin ends or a signal arrives.
   A `run` without an html file gets the engine page and re-runs the bin under its bunfig (see Engine page). A `run` whose root has a `[serve.static]` bunfig, started elsewhere, re-spawns the bin there and exits with its code (see bunfig.toml of the game root). The steps below run in that child.
2. Imports the game HTML at run time as a Bun HTML bundle.
3. `createApp({ pluginConfigs: { files: { root }, pages: { gameUrl: "/" } } })` and `start()`. Warn and error log lines go to the branded console, and the info line `files:project-on { files, keys, ms }`, so the server log shows the project index is on.
4. `createGameServer(editor.hub.serve(...), editor.hub.closeAll)` (`serve.ts`) runs `Bun.serve` with `development: { hmr: true, console: true }` (`hmr: false` with `--no-hmr`), the game at `/`, and `createStaticFetch(root, editor.hub.guard)` for every other path. Bun HMR reloads the game page on a save (D-23, superseding D-22); `console: true` forwards the browser console to the terminal over the HMR socket. The game server keeps one mutable current server (A9): a restart closes every editor socket with 1012 `editor restarting`, waits until Bun reported the closes (at most 500 ms), stops it, bounded to 500 ms, and serves the next options on the same port. Restarts and the final stop run one after another and always reach the current server.
5. `editor.pages.attachServer(options, next => game.restart(next))`: the bin owns hot reload, `P/hmr` answers `{ hmr: true, owner: "bin" }` (`hmr: false` with `--no-hmr`), every tools page gets the `hotReload` notification, and the Hot reload switch can restart the server (see Hot reload).
6. Writes `.moku/editor.json` (see Discovery file).
7. Prints the Game, Tools and Root lines. The token is never printed.
8. On `SIGINT` or `SIGTERM`, once: removes `.moku/editor.json`, `editor.stop()`, then stops the current game server (after a restart under way) with `stop(true)` bounded to 500 ms, prints `stopped`, exits 0.

> **Note: Bun stability.** D-22 saw Bun 1.3.14 crash after about 23 HMR reloads (1.13 GB RSS). D-23 accepts it as a Bun issue: restart the bin when it happens.
>
> **Note: `"sideEffects": false` in a game.** Only without HMR does Bun bundle the page like `Bun.build` and honour the game's `"sideEffects": false`, dropping a bare `import "./x"`. The bin serves with HMR by default, so this applies to the bin with `--no-hmr` and to a game's own server with HMR off: such a page must not declare `"sideEffects": false` in the nearest `package.json`, or must list that file: `"sideEffects": ["./src/x.ts"]`.

`createStaticFetch` (`static.ts`) serves the root's files: `navigate` guard, GET and HEAD only, `cache-control: no-cache`. It answers 404 for a NUL, a `\`, a segment starting with `.`, a `node_modules` segment, a missing file, or a real path outside the real root. A malformed escape gets 400. `/manifest.json` answers with `generated/manifest.json` when the game has one (game 0.13+, where `moku-game keys` writes it), else with the root's.

| Exit code | When |
|---|---|
| 0 | Help, `mcp-config`, `mcp` after stdin ended or a SIGINT/SIGTERM, or serving |
| child's code | A bin re-spawned in the game root, or re-run under the engine page's bunfig, ended |
| 1 | Runtime error: missing or bad HTML file, start failed, port in use; the engine page could not be written |
| 2 | Bad arguments; without an html file, a root that is not a moku-game folder |

## Integration notes

| Plugin | Note |
|---|---|
| `hub` | Routes must be added in `onInit`. `hub.serve()` freezes routes after `start()`. `hub` never requires `pages`. |
| `files` | `files.root()` is the absolute real root carried in `ToolsBoot.root` for `editorUrl`. |
| `link` (tools core) | Reads the tag with its `boot` selector `"#moku-editor-boot"` and exposes it as `link.boot()`. Appends `?token=&kind=tools` to `ws`. |
| `bridge` (agent core) | Fetches `hello` (its config default `"/__editor/hello"`) from the same origin. A cross-site request gets 403 from the guard. Keeps the game state across Bun's reload. |
| `link` (hot reload) | `link.hotReload()` mirrors the published state; `link.setHotReload(on)` POSTs `P/hmr` with the boot token. When the restart cuts the answer off, it waits for the reconnect to deliver the state (A1). |
| `workspace` | Mounted by `page/main.tsx` after `start()`, not in its own `onStart`. |

## Limits

- Engine page and MCP: the discovery file's `html` is `<root>/.moku/index.html`. When that bin is gone, the MCP launcher reuses it (`mcp/connection.ts`) and starts `moku-editor <root>/.moku/index.html --root <root>` without `--config=<root>/.moku/bunfig.toml`, so the page has no hot plugin. `moku-editor mcp` without an html file does not start the engine page yet. Follow-up: the launcher re-runs the engine form when the html ends in `/.moku/index.html`.
- The page must be built first. In a source checkout without `dist/tools`, `P/` answers 503 "tools page not built · run bun run build:tools".
- The template is read once per app. A rebuild needs a restart.
- `gameUrl` must be same-origin. The game's bridge fetches `hello` from this server.
- The bin serves one game HTML file at `/` and binds 127.0.0.1 only.
- Hot reload is switched by restarting the bin's server (D-32): every socket closes with 1012 and reconnects within about a second, and the game page has to load again. A game's own server cannot be switched.
- MCP: screenshots and series need the game page visible (a hidden tab stops heartbeats). Frame sources reach `moku_wait` about once per second (D-15).
- MCP: `moku_series` is one forwarded `run`. A run of `editor.sheet` waits `frames × everyMs` on top of the call deadline (capped at +60 s) in bridge, hub and link, so 12 frames every 5000 ms fit. The `game.capture { sheet }` fallback keeps the plain deadline (`callTimeoutMs`, 5 s by default): a longer sheet there answers -32002 `timeout`.
- MCP: game pictures compress poorly. On merge-game in a 393 × 852 page a full shot is about 890 KB of base64, so the default screenshot comes back about 200 px wide. A 4-frame sheet is about 2 MB at full size; `editor.sheet` shrinks it to 1080 px wide in the page, and a sheet still above 300 KB is sent with the size note.
- MCP: a screenshot shown in Claude Code needs a browser with the game page open and visible. `claude mcp list` alone starts the bridge, which starts the bin, but no game session.
