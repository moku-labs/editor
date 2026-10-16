# activeSource

Tools plugin (Standard tier). One active source per tools page: the local preview (this page's own
game frame) or a device session. Choosing a device pauses the local preview (`game.pause` on its
session) before link chooses the device, and resumes only what activeSource paused when the page
returns to the local preview. It also carries the Connect panel's actions (through connect's editor
methods), the telemetry lease of a wired device, the disconnect notice and the timeline markers.
The full specification is `.planning/specs/11-source.md` § 4.

**Status:** skeleton of build wave 0. The config, the types (`types.ts`) and the per-plugin events
are final; every api member exists with its final signature and throws
`[moku-editor] activeSource.<member> is not built yet.` until build wave 2 replaces the stub.

## Config

| Field | Type | Default | Meaning |
|---|---|---|---|
| `autoUse` | `boolean` | `true` | a device that links while the local preview is the source becomes the source |
| `pauseLocal` | `boolean` | `true` | pause the local preview while a device is the source |
| `rejoinMs` | `number` | `15000` | a lost device that returns within this becomes the source again |
| `noticeMs` | `number` | `12000` | how long the disconnect notice shows |
| `renewMs` | `number` | `4000` | how often the scan and watch leases are renewed |
| `markers` | `number` | `32` | markers kept |

## Events

| Event | Payload | When |
|---|---|---|
| `activeSource:changed` (per-plugin) | `SourceChange { from, to, reason, at }` | every source switch |
| `activeSource:connect-requested` (per-plugin) | `{ tab: "wire" \| "network" \| undefined }` | `openConnect()` |

Both are visible to plugins that depend on `activeSourcePlugin` (workspace, renderView).

## Dependencies

`linkPlugin`. Tools order: `link, activeSource, workspace, panels, …`.
