# files

> Standard plugin (server core): the project-root sandbox of the editor server (D-09).

`files` is the only code in the package that touches the file system for the tools page. It lists,
reads and writes text files, writes image captures and reads images back as data URLs. It works
strictly inside one configured `root`. `hub` calls it for files-channel requests from `tools`
connections. `pages` reads `root()`.

Node built-ins only (`node:fs`, `node:fs/promises`, `node:path/posix`, `node:crypto`). No `Bun.*`.

## API

Paths are relative posix paths from the root, for example `src/nodes/merge.ts`. No leading `/` or `./`.

| Method | Returns | Notes |
|---|---|---|
| `list(dir)` | `Promise<FileEntry[]>` | Direct children. `""` or `"."` is the root. Folders first, then allowed files, each sorted by path. `size` is 0 for folders. No `version`. |
| `read(path)` | `Promise<FileText>` | UTF-8 (invalid bytes become U+FFFD). `version` is the lowercase hex sha1 of the bytes. Max 2 MiB. |
| `write(path, text, version?)` | `Promise<WriteResult>` | Atomic. Creates missing parent folders inside the root. A stale `version` fails with -32005. Max 2 MiB. Emits `files:written`. |
| `writeBinary(path, bytes)` | `Promise<WriteResult>` | Only under `.moku/captures/`, image extensions only. Max 16 MiB. Emits `files:written` with `kind: "capture"`. |
| `readBinary(path)` | `Promise<FileBinary>` | Image extensions only. `{ dataUrl, version }`. Max 16 MiB. Emits nothing. |
| `resolve(path)` | `string` | Synchronous full check. The absolute real path. A missing file gives the path it would have. |
| `root()` | `string` | The real, symlink-resolved root. |

Image extensions: `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, case-insensitive.

```ts
const { text, version } = await app.files.read("features/ui/styles.ts");
await app.files.write("features/ui/styles.ts", edited, version);
```

### Helper: `decodeDataUrl(text, path)`

Exported next to the plugin for `hub`. It decodes the files-channel `writeBinary {path, data}`.
It accepts only `data:image/(png|jpeg|webp|gif);base64,<payload>`. The mime must match the extension of `path`.

```ts
const path = ".moku/captures/2026-09-24-1012-board.png";
await app.files.writeBinary(path, decodeDataUrl(data, path));
```

### Errors

Every rejection is a protocol `wireError` (`Error & WireError`). `isWireError(err)` is true.
Messages start with `[moku-editor]` and name the relative path only, never the absolute root.

| Situation | code | `data.reason` | extra `data` |
|---|---|---|---|
| Path fails a sandbox rule | -32004 | `forbidden_path` | `id` |
| File or folder missing | -32601 | `unknown_id` | `id` |
| Stale `version`, or a `version` for a missing file | -32005 | `version_conflict` | `id` |
| Text over 2 MiB, binary over 16 MiB on write, bad data URL | -32602 | `invalid_input` | `field: "text"` or `"data"` |
| Text over 2 MiB or image over 16 MiB on read, any other IO error | -32000 | `command_failed` | none |

## Sandbox rules

1. **Lexical**, before any file-system call: not empty, at most 1024 chars, no NUL, no backslash,
   not absolute, not drive-like, no empty, `.` or `..` segment. Nothing is decoded: `%2e%2e/x.ts` is a literal name.
2. **Deny**: the lowercased path and each folder prefix against the deny globs.
3. **Allow** (files only): the path must match an allow glob. This check is case-sensitive.
4. **Real path**: `realpath` of the target, or of its nearest existing ancestor. It must stay
   under the real root. When it differs, the real relative path must also pass deny, allow and the image rules.
5. **Kind**: `list` needs a folder. Every other operation needs a regular file.

Glob dialect: `**/` matches zero or more whole segments. A trailing `/**` matches the folder itself and anything below it.
`**` elsewhere matches anything. `*` matches inside one segment. `?` matches one character. `{a,b}` is an alternation without nesting.
Dot files match like any other name.

Writes go to `<dir>/.<name>.<8 hex>.tmp` with flag `wx`. The write keeps the mode of the existing file, or uses 0o644.
Then come fsync, close and a rename onto the real target. Writes to one path run one after another under a lock.
A write through an in-root symlink updates the target, and the link stays.

**Residual risk, not tested:** a symlink swapped between the realpath check and the rename (TOCTOU).
To narrow that window, the write checks the real path of the parent folder again right before the rename.

## Configuration

Set through `pluginConfigs.files`. Shallow merge, so an array replaces the default.

| Option | Default | Notes |
|---|---|---|
| `root` | `"."` | Absolute, or relative to the working folder. Resolved once in `onInit`. It must be an existing folder. |
| `allow` | `["**/*.ts", "**/*.tsx", "**/*.json", "**/*.md", "**/*.css", ".moku/**"]` | Must not be empty. |
| `deny` | `["**/node_modules/**", "**/.git/**", "**/dist/**", "**/.env*"]` | Matched case-insensitively. |

`createApp` throws when the root is wrong:

```
[moku-editor] files.root "<root>" is not a directory.
  Pass pluginConfigs.files.root pointing at the game project.
```

## Events

| Event | Payload | When |
|---|---|---|
| `files:written` (global server event) | `{ path, bytes, kind }` | After each successful `write` or `writeBinary`. |

`kind` comes from the path. The first matching rule wins:

1. `.moku/captures/…` gives `capture`.
2. `.moku/notes/…` gives `note`.
3. `.moku/editor/layout.json` gives `layout`.
4. `.css`, `styles.ts(x)` and `*.styles.ts(x)` give `style`.
5. Other `.ts` and `.tsx` files give `code`.
6. Everything else gives `other`.

The emit is not awaited. If the emit fails, the error is logged as `files:emit-failed`.

This plugin hooks no events.
