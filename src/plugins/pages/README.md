# pages

> Standard plugin (server core). It serves the tools page and its assets from the editor server. It also serves the `hello` route that the game page's bridge calls to learn the websocket URL and the token. The `moku-editor` bin lives here too.

`onInit` checks the config, finds the built page and registers four routes with `hub.addRoutes`. There is no `onStart` and no `onStop`. After `stop` the hub has no token, so the page and `hello` answer 503.

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
| `routes` | `routes(): EditorRoutes` | The frozen object registered with the hub in `onInit`. |

```ts
Object.keys(editor.pages.routes()); // ["/__editor", "/__editor/", "/__editor/hello", "/__editor/assets/*"]
```

### Routes

`P = hub.path()` (default `/__editor`). Each handler runs `hub.guard(req, server, mode)` first and returns its refusal. Methods other than GET and HEAD get 405 with `Allow: GET, HEAD`. HEAD keeps the headers and drops the body.

| Route | Guard mode | Answer |
|---|---|---|
| `P` | `navigate` | 308 to `P/`. The query is kept. |
| `P/` | `navigate` | The tools page with the boot tag. 503 when the page is not built, when `index.html` has no `</head>`, or before start. |
| `P/hello` | `same-origin` | `HelloBody` JSON `{ ws, token }`. No CORS headers. 503 before start. |
| `P/assets/*` | `navigate` | A regular file of `pageDir/assets/`. 404 for an unsafe or missing name. 400 for a malformed escape. |

Headers:

| Route | Header | Value |
|---|---|---|
| `P/` | `content-type` | `text/html; charset=utf-8` |
| `P/` | `cache-control` | `no-store` (the token rotates per start) |
| `P/` | `referrer-policy` | `no-referrer` |
| `P/` | `content-security-policy` | `PAGE_CSP`: the R3 policy, then `frame-ancestors 'none'; base-uri 'none'; form-action 'none'` |
| `P/hello` | `content-type`, `cache-control` | `application/json; charset=utf-8`, `no-store` |
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
| error | `pages:not-built` | `{ pageDir }` | First `P/` request with no readable template. Once per app. |

## Dependencies

| Kind | Value |
|---|---|
| `depends` | `[filesPlugin, hubPlugin]` |
| `filesPlugin` | `root()` for `ToolsBoot.root` |
| `hubPlugin` | `addRoutes` (in `onInit`), `guard`, `path`, `token` |
| Global events | none |
| Protocol types | `ToolsBoot`, `HelloBody` from `registry/protocol` |

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
moku-editor <game-html> [--port 3000] [--root .] [--help]
```

`package.json` maps `moku-editor` to `./dist/bin.mjs` (from `bin.ts`). Bun only.

| Flag | Short | Default | Rule |
|---|---|---|---|
| `--port` | `-p` | `3000` | Digits, 0 to 65535. `0` picks a free port. |
| `--root` | `-r` | `.` | Project root the editor reads and writes. Not empty. |
| `--help` | `-h` | | Prints usage, exit 0. |

The positional must be one file ending in `.html`. Unknown flags are errors, so there is no `--host`. The server always binds 127.0.0.1.

What `main` (`cli.ts`) does:

1. `parseBinArgs(argv)`. Help prints usage. An error prints it and usage.
2. Imports the game HTML at run time as a Bun HTML bundle.
3. `createApp({ pluginConfigs: { files: { root }, pages: { gameUrl: "/" } } })` and `start()`. Warn and error log lines go to the branded console.
4. One `Bun.serve(editor.hub.serve(...))` with `development: true`, the game at `/`, and `createStaticFetch(root, editor.hub.guard)` for every other path.
5. Prints the Game, Tools and Root lines. The token is never printed.
6. On `SIGINT` or `SIGTERM`, once: `editor.stop()`, then `server.stop(true)` bounded to 500 ms, prints `stopped`, exits 0.

`createStaticFetch` (`static.ts`) serves the root's files: `navigate` guard, GET and HEAD only, `cache-control: no-cache`. It answers 404 for a NUL, a `\`, a segment starting with `.`, a `node_modules` segment, a missing file, or a real path outside the real root. A malformed escape gets 400.

| Exit code | When |
|---|---|
| 0 | Help, or serving |
| 1 | Runtime error: missing or bad HTML file, start failed, port in use |
| 2 | Bad arguments |

## Integration notes

| Plugin | Note |
|---|---|
| `hub` | Routes must be added in `onInit`. `hub.serve()` freezes routes after `start()`. `hub` never requires `pages`. |
| `files` | `files.root()` is the absolute real root carried in `ToolsBoot.root` for `editorUrl`. |
| `link` (tools core) | Reads the tag with its `boot` selector `"#moku-editor-boot"` and exposes it as `link.boot()`. Appends `?token=&kind=tools` to `ws`. |
| `bridge` (agent core) | Fetches `hello` (its config default `"/__editor/hello"`) from the same origin. A cross-site request gets 403 from the guard. |
| `workspace` | Mounted by `page/main.tsx` after `start()`, not in its own `onStart`. |

## Limits

- The page must be built first. In a source checkout without `dist/tools`, `P/` answers 503 "tools page not built · run bun run build:tools".
- The template is read once per app. A rebuild needs a restart.
- `gameUrl` must be same-origin. The game's bridge fetches `hello` from this server.
- The bin serves one game HTML file at `/` and binds 127.0.0.1 only.
