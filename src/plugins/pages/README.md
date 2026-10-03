# pages

> Standard plugin (server core). It serves the tools page and its assets from the editor server. It also serves the `hello` route that the game page's bridge calls to learn the websocket URL and the token. The `moku-editor` bin lives here too.

`depends: [filesPlugin, hubPlugin]`. `onInit` checks the config, finds the built page and registers the routes with `hub.addRoutes`. There is no `onStart` and no `onStop`.

## API

| Method | Returns | Notes |
|---|---|---|
| `routes()` | `EditorRoutes` | The frozen object that was registered with the hub. |

Routes, with `P = hub.path()` (default `/__editor`). Each handler runs `hub.guard` first. Methods other than GET and HEAD get 405 with `Allow: GET, HEAD`.

| Route | Guard | Answer |
|---|---|---|
| `P` | navigate | 308 to `P/`, keeps the query |
| `P/` | navigate | The tools page with `<script type="application/json" id="moku-editor-boot">` (`ToolsBoot`). Headers: `no-store`, `no-referrer`, `nosniff`, and the CSP below. 503 when the page is not built or the editor is not started. |
| `P/hello` | same-origin | `{ ws, token }` (`HelloBody`), `no-store`. No CORS headers. 503 before start. |
| `P/assets/*` | navigate | A file from `pageDir/assets/`, cached as `immutable`. Unsafe names get 404. A malformed escape gets 400. |

CSP: the R3 policy word for word, then `frame-ancestors 'none'; base-uri 'none'; form-action 'none'`.

```ts
const editor = createApp({ pluginConfigs: { files: { root: "." } } });
await editor.start();
Bun.serve(editor.hub.serve({ port: 3000, routes: { "/": index } }));
// tools page: http://127.0.0.1:3000/__editor/
```

## Configuration

| Option | Default | Rule |
|---|---|---|
| `title` | `"moku editor"` | 1 to 120 characters |
| `editorUrl` | `"vscode://file/{path}:{line}"` | Must contain `{path}`. The scheme cannot be `javascript`, `data` or `vbscript`. |
| `pageDir` | `undefined` | `undefined` means `dist/tools` next to the bundle, then the repo `dist/tools` |
| `gameUrl` | `"/"` | Same-origin path. It starts with `/`, does not start with `//`, and has no `\`. |

A bad value makes `createApp` throw `[moku-editor] pages.<field> ….`

## Tools page build

`bun run build:tools` (`scripts/build-tools.ts [--outdir dir]`) bundles `page/index.html` into `dist/tools/`. By default Bun inlines CSS fonts as data URLs, and the CSP blocks those. So the script keeps the woff2 files external. It copies them into `assets/` with hashed names. Then it runs the layout checks.

## Bin

```
moku-editor <game-html> [--port 3000] [--root .] [--help]
```

One `Bun.serve` on 127.0.0.1 serves three things: the game HTML (a Bun HTML import), the files of the game folder, and the editor. It prints the Game and Tools URLs and never prints the token. Exit codes: 0 for help or serving, 1 for a runtime error (for example the port is in use), 2 for bad arguments.

## Events

None. Emits none and hooks none.
