# files

> Standard plugin (server core): the project-root sandbox of the editor server (D-09).

`files` is the only code in the package that touches the file system for the tools page. It lists,
reads and writes text files, writes image captures and reads images back as data URLs. It works
strictly inside one configured `root`. `hub` calls it for files-channel requests from `tools`
connections. `pages` reads `root()`.

Node built-ins only (`node:fs`, `node:fs/promises`, `node:path/posix`, `node:crypto`). No `Bun.*`.

## Configuration

Set through `pluginConfigs.files`. Shallow merge, so an array replaces the default.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `root` | `string` | `"."` | Project root. Absolute, or relative to the working folder. Resolved once in `onInit` with `realpathSync`. It must be an existing folder. |
| `allow` | `readonly string[]` | `["**/*.ts", "**/*.tsx", "**/*.json", "**/*.md", "**/*.css", ".moku/**"]` | Globs a file must match to be read or written. Case-sensitive. Must not be empty. |
| `deny` | `readonly string[]` | `["**/node_modules/**", "**/.git/**", "**/dist/**", "**/.env*"]` | Globs that are never listed, read or written. Case-insensitive. |

`onInit` is synchronous, so `createApp` throws at once on a bad config:

```
[moku-editor] files.root "<root>" is not a directory.
  Pass pluginConfigs.files.root pointing at the game project.
```

```
[moku-editor] files.allow is empty.
  Pass at least one glob in pluginConfigs.files.allow.
```

Fixed limits in `io.ts`, not config:

| Constant | Value |
|---|---|
| `MAX_TEXT_BYTES` | 2 MiB, for `read` and `write` |
| `MAX_BINARY_BYTES` | 16 MiB, for `readBinary` and `writeBinary` |
| `MAX_PATH_LENGTH` | 1024 chars |

## API

`FilesApi`, mounted at `app.files` and returned by `ctx.require(filesPlugin)`.

Paths are relative posix paths from the root, for example `src/nodes/merge.ts`. No leading `/` or `./`.

| Method | Returns | Notes |
|---|---|---|
| `list(dir: string)` | `Promise<FileEntry[]>` | Direct children. `""` or `"."` is the root. Folders first, then allowed files, each sorted by path. `size` is 0 for folders. No `version`. |
| `read(path: string)` | `Promise<FileText>` | UTF-8 (invalid bytes become U+FFFD). `version` is the lowercase hex sha1 of the bytes. Max 2 MiB. |
| `write(path: string, text: string, version?: string)` | `Promise<WriteResult>` | Atomic. Creates missing parent folders inside the root. A stale `version` fails with -32005. Max 2 MiB. Emits `files:written`. |
| `writeBinary(path: string, bytes: Uint8Array)` | `Promise<WriteResult>` | Only under `.moku/captures/`, image extensions only. Creates missing parent folders. Max 16 MiB. Emits `files:written` with `kind: "capture"`. |
| `readBinary(path: string)` | `Promise<FileBinary>` | Image extensions only. `{ dataUrl, version }`. Max 16 MiB. Emits nothing. |
| `resolve(path: string)` | `string` | Synchronous full check, as for a write. The absolute real path. A missing file gives the path it would have. |
| `root()` | `string` | The real, symlink-resolved root. |

Image extensions: `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, case-insensitive (`IMAGE_EXTENSIONS`).
With the default `allow`, images are readable and writable only under `.moku/**`.

Wire shapes come from `../registry/protocol`:

| Type | Shape |
|---|---|
| `FileEntry` | `{ path, kind: "file" \| "dir", size, version? }` |
| `FileText` | `{ text, version }` |
| `FileBinary` | `{ dataUrl, version }` |
| `WriteResult` | `{ path, bytes, version }` |

```ts
await app.files.list("src/nodes"); // [{ path: "src/nodes/await-intent.ts", kind: "file", size: 812 }, …]

const { text, version } = await app.files.read("features/ui/styles.ts");
await app.files.write("features/ui/styles.ts", edited, version); // { path, bytes, version }

await app.files.writeBinary(".moku/captures/2026-09-24-1012-board.png", bytes);
const { dataUrl } = await app.files.readBinary(".moku/captures/2026-09-24-1012-board.png");
// dataUrl: "data:image/png;base64,…"

app.files.resolve("src/main.ts"); // "/Users/alex/game/src/main.ts"
app.files.root(); // "/Users/alex/game"
```

### Helper: `decodeDataUrl(text, path)`

Exported from `src/plugins/files/index.ts` next to the plugin, for `hub`. It decodes the files-channel
`writeBinary {path, data}`. It accepts only `data:image/(png|jpeg|webp|gif);base64,<payload>`.

| Input | Result |
|---|---|
| Valid data URL, mime matches the extension of `path` | `Uint8Array` of the bytes |
| `path` without an image extension | -32004 `forbidden_path` |
| Not a base64 png, jpeg, webp or gif data URL | -32602 `field: "data"` |
| Mime does not match the extension of `path` | -32602 `field: "data"` |

```ts
const path = ".moku/captures/2026-09-24-1012-board.png";
await app.files.writeBinary(path, decodeDataUrl(data, path));
```

### Errors

Every rejection is a protocol `wireError` (`Error & WireError`). `isWireError(err)` is true.
Messages start with `[moku-editor]` and name the relative path only, never the absolute root.
`hub` forwards them unchanged.

| Situation | code | `data.reason` | extra `data` |
|---|---|---|---|
| Path fails a sandbox rule | -32004 | `forbidden_path` | `id` |
| File or folder missing | -32601 | `unknown_id` | `id` |
| Stale `version`, or a `version` for a missing file | -32005 | `version_conflict` | `id` |
| Text over 2 MiB, binary over 16 MiB on write, bad data URL | -32602 | `invalid_input` | `field: "text"` or `"data"` |
| Text over 2 MiB or image over 16 MiB on read, any other IO error | -32000 | `command_failed` | none |

Example messages: `[moku-editor] forbidden path: ../x.ts`, `[moku-editor] write failed: src/a.ts (EACCES)`.

### Sandbox rules

Every call runs these checks in order.

1. **Lexical**, before any file-system call: not empty, at most 1024 chars, no NUL, no backslash,
   not absolute, not drive-like, no empty, `.` or `..` segment. Nothing is decoded: `%2e%2e/x.ts` is a literal name.
2. **Deny**: the lowercased path and each folder prefix against the deny globs.
3. **Allow** (files only): the path must match an allow glob. This check is case-sensitive.
   `readBinary` and `writeBinary` also need an image extension. `writeBinary` also needs `.moku/captures/`.
4. **Real path**: `realpath` of the target, or of its nearest existing ancestor. It must stay
   under the real root. When it differs, the real relative path must also pass deny, allow and the image rules.
5. **Kind**: `list` needs a folder. Every other operation needs a regular file.

`list` hides children instead of failing: denied names, dangling symlinks, symlinks leaving the root,
files outside `allow`, and anything that is neither a file nor a folder. A symlink is listed with the kind of its target.

Glob dialect: `**/` matches zero or more whole segments. A trailing `/**` matches the folder itself and anything below it.
`**` elsewhere matches anything. `*` matches inside one segment. `?` matches one character. `{a,b}` is an alternation without nesting.
Dot files match like any other name.

Writes go to `<dir>/.<name>.<8 hex>.tmp` with flag `wx`. The write keeps the mode of the existing file, or uses 0o644.
Then come fsync, close and a rename onto the real target. On failure the temp file is removed.
Writes to one path run one after another under a lock (`withLock`). The `version` check runs under the lock.
A write through an in-root symlink updates the target, and the link stays.
Identical content is still written and still emits.

## Events

| Event | Payload | When |
|---|---|---|
| `files:written` (global, `ServerEvents` in `src/config.ts`) | `FilesWritten`: `{ path, bytes, kind }` | After each successful `write` or `writeBinary`, after the rename. |

`kind` is a `WrittenKind`, from `classifyWrite(path)`. The first matching rule wins:

| Order | Rule | `kind` |
|---|---|---|
| 1 | starts with `.moku/captures/` | `capture` |
| 2 | starts with `.moku/notes/` | `note` |
| 3 | equals `.moku/editor/layout.json` | `layout` |
| 4 | ends with `.css`, basename `styles.ts` or `styles.tsx`, or ends with `.styles.ts` or `.styles.tsx` | `style` |
| 5 | other `.ts` and `.tsx` | `code` |
| 6 | everything else | `other` |

The emit is not awaited. If the emit throws, the error is logged as `files:emit-failed`.

This plugin hooks no events.

## Dependencies

| Item | Value |
|---|---|
| `depends` | none. `files` is first in the server core (files ← hub ← pages). |
| Global events emitted | `files:written` |
| Global events hooked | none |
| Lifecycle | `onInit` only (`validateFilesConfig`). No `onStart`, no `onStop`. |

## Usage

From the consumer side, through the server entry:

```ts
import { createApp } from "@moku-labs/editor/server";

const editor = createApp({ pluginConfigs: { files: { root: `${import.meta.dir}/..` } } });
await editor.start();
const entries = await editor.files.list("src");
```

From another server plugin, with `ctx.require` and a hook on `files:written`:

```ts
import { createPlugin, filesPlugin, type Files } from "@moku-labs/editor/server";

const seen: Files.FilesWritten[] = [];

const auditPlugin = createPlugin("audit", {
  depends: [filesPlugin],
  hooks: () => ({ "files:written": payload => { seen.push(payload); } })
});
```

## Integration notes

| Plugin | How it uses `files` |
|---|---|
| `hub` | `depends: [filesPlugin]`. `dispatchFiles(ctx.require(filesPlugin), method, params)` serves the files channel of `tools` connections: `list {dir}`, `read {path}`, `write {path, text, version?}`, `writeBinary {path, data}`, `readBinary {path}`. Params pass `checkInput` first. `writeBinary` decodes `data` with `decodeDataUrl(data, path)`. |
| `pages` | `depends: [filesPlugin, hubPlugin]`. `ctx.require(filesPlugin)` in `onInit`. The tools boot JSON puts `files.root()` in `root`, for "Open in editor" links. |
| `link` (tools core) | `link.files` mirrors the files-channel methods for the tools views. It reaches `files` only through `hub`. |

## Limits and follow-ups

- **Residual risk, not tested:** a symlink swapped between the realpath check and the rename (TOCTOU).
  To narrow that window, the write checks the real path of the parent folder again right before the rename.
- `list` is not recursive and sets no `version`. Hashing a whole folder is too costly.
- Text is capped at 2 MiB, images at 16 MiB. Larger files fail.
- `writeBinary` takes bytes. The data URL of the wire is decoded by `hub`, not by the api.
- `files:written` is there for a later MCP layer to react to writes. No plugin in this package hooks it yet.
