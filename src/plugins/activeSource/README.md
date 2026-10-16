# activeSource

Tools plugin (Standard tier). One active source per tools page: the local preview (this page's own
game frame), a device session, or another game page. Every workspace keeps reading `link` (the
chosen session); activeSource is the only plugin that changes that choice for a source switch, so
the page never mixes sources. The full specification is `.planning/specs/11-source.md` § 4.

## Overview

- **Switching to a device** (`useDevice`, a phone that links, `connectDevice`, a rejoin) pauses the
  local preview **before** link chooses the device: `game.pause` on the own session, unless the
  hub's heartbeat readout of that session (`SessionInfo.heartbeat.paused`, kept by link, L9) says
  the person had paused it already. Then the preview is `held` and activeSource never resumes it.
  Only a `game.pause` that answered `true` makes the session the resume target (`pausedSession`).
  A refused or failed pause leaves the preview `unpausable` with the reason, and the switch still
  happens: the person asked for the device.
- **Back to the local preview** (`useLocal`, the device leaving, device mode stopped) chooses the
  own session in link, then `game.resume` goes to `pausedSession` only, and only while it is open.
- **A reload of the local frame** while a device is the source (hot reload, D-07) gives a new own
  session: it is paused again and becomes the resume target.
- **A device that links** while the local preview is the source becomes the source (`autoUse`),
  once per device id: a re-list never switches back to a phone the person left. While a device is
  the source, another one only raises the notice "<name> connected — Use".
- **The active device leaving** returns the page to the local preview (reason `lost`, or `stopped`
  while `stopDevices` runs or when `editor.devices` says device mode is off), shows the notice for
  `noticeMs` and adds the marker "<name> disconnected here · Local preview resumed". The same device
  id back within `rejoinMs` becomes the source again (reason `rejoined`) unless the person chose a
  source meanwhile; after `reconnect()` the rule holds without a time limit.
- **A choice made elsewhere** (`link:status` naming a session activeSource did not choose: link's
  own pick, the session menu of an older build, a test) is adopted (reason `adopted`, no marker)
  and the pause rule of its kind applies.
- **Leases on connect**: the scan lease while `scan()` handles are open and the watch lease of the
  active device, renewed by one interval every `renewMs` that runs only while a lease is needed.
- Switches are serialized: a newer one supersedes an older one at its next step, so a late answer
  of the first never wins. `game.pause` and `game.resume` run one at a time, in order.

## Config

| Field | Type | Default | Rule | Meaning |
|---|---|---|---|---|
| `autoUse` | `boolean` | `true` | boolean | a device that links while the local preview is the source becomes the source |
| `pauseLocal` | `boolean` | `true` | boolean | pause the local preview while a device is the source |
| `rejoinMs` | `number` | `15000` | integer 0–600000 | a lost device that returns within this becomes the source again (0: never) |
| `noticeMs` | `number` | `12000` | integer 1000–120000 | how long the disconnect notice shows |
| `renewMs` | `number` | `4000` | integer 500–60000 | how often the scan and watch leases are renewed (connect's `leaseMs` is 10 s) |
| `markers` | `number` | `32` | integer 1–512 | markers kept |

A bad value fails `createApp` with a two-line `TypeError`, e.g.
`[moku-editor] activeSource.rejoinMs is 600001.\n  Give a whole number from 0 to 600000, for example 15000.`

## API

| Member | What it does |
|---|---|
| `current()` | the active source: `{ kind: "local", session }` (session null on a page without a local preview), `{ kind: "device", session, device }`, `{ kind: "page", session }` |
| `preview()` | the local preview: `running`, `pausing`, `paused-by-source`, `held`, `resuming`, `unpausable` (with `reason`), `none` |
| `useDevice(session)` | makes a device session the source; a session without a device is a two-line `TypeError`, an id that is not open link's -32003 `choose_session` |
| `useLocal()` | makes the local preview the source (the phone stays linked); a page without one gets the two-line `Error` |
| `onChange(fn)` | listens to source changes; a throwing listener is logged (`activeSource:listener-failed`) |
| `directory()` | connect's `editor.devices`, through link |
| `scan()` | renews connect's scan lease until the returned stop |
| `connectWire()`, `connectNetwork()` | `connect.wire` / `connect.network`: device mode on; answers the listen addresses |
| `confirmPairing(ticket, code)`, `refusePairing(ticket)` | `connect.confirm` / `connect.refuse` |
| `stopDevices(options?)` | `connect.off` (all of device mode, or `{ lan: true }`); a device it cuts falls back to the local preview (reason `stopped`) |
| `connectDevice(serial)` | device mode on for wires when off, waits up to 20 s (connect's default `answerTimeoutMs`) for the phone's debug game, then `useDevice` (reason `connected`) |
| `telemetry()`, `onTelemetry(fn)` | the active device's `editor.deviceTelemetry` only |
| `markers()`, `notice()`, `dismissNotice()`, `reconnect()` | timeline markers, the disconnect notice, Reconnect |
| `label()`, `health()`, `clockOffsetMs()` | the connection bar's name and link, the latency ring (48 samples, one per directory update of the active device, NaN for a gap, allocated once), the phone − computer clock offset (median of the last 8 heartbeats of the active device, each `at − (receivedAt − latency / 2)`; 0 for the local preview and a page, null before two beats) |
| `openConnect(tab?)` | emits `activeSource:connect-requested` |

## Events

| Event | Payload | When |
|---|---|---|
| `activeSource:changed` (per-plugin) | `SourceChange { from, to, reason, at }`, reason `connected` \| `user` \| `lost` \| `rejoined` \| `stopped` \| `adopted` | every source switch |
| `activeSource:connect-requested` (per-plugin) | `{ tab: "wire" \| "network" \| undefined }` | `openConnect()` |

Both are visible to plugins that depend on `activeSourcePlugin` (workspace, renderView). Hooks: the
global `link:status` (B8).

## Dependencies

`linkPlugin`: `sessions`, `session`, `ownSession`, `onSessions`, `onHeartbeat`, `choose`, `runIn`,
`callEditor`, `published`, `onPublished`. Server calls only through `link.callEditor("connect.*")` (connect's
editor methods: `scan`, `wire`, `network`, `off`, `confirm`, `refuse`, `watch`, `unwatch`) and
`link.runIn(own, "game.pause" | "game.resume")`. Types: `SessionDevice` (`hub/protocol`),
`DeviceDirectory`, `DeviceTelemetry`, `ListenInfo` (`connect/protocol`). Tools order:
`link, activeSource, workspace, panels, …`.

## Lifecycle

- **onInit:** validates the config.
- **onStart:** subscribes to `link.onSessions`, `link.onPublished("devices")`,
  `link.onPublished("deviceTelemetry")` and `link.onHeartbeat` (the clock offset); the first
  session list's choice becomes the source (reason `adopted`, no marker).
- **onStop:** state-only (no emit, no log): unsubscribes, clears the renew interval and the notice
  timer, cancels `connectDevice` waits, drops the listeners. It does not resume the local preview:
  the page is going away, and its frame with it.

## Files

| File | What |
|---|---|
| `index.ts` | wiring |
| `types.ts` | config, sources, change, marker, label, health, notice, state, api, events, contexts, hook |
| `state.ts` | `createActiveSourceState` (rings allocated once) |
| `api.ts` | `createActiveSourceApi` |
| `handlers.ts` | the `link:status` hook |
| `lifecycle.ts` | config check, start, stop |
| `switch.ts` | the switch: to a device, to the local preview, the loss, adoption, the pause queue |
| `sessions.ts` | the session list (loss, reload, devices linking, rejoin, first choice) and link's choice |
| `published.ts` | `editor.devices` (health samples) and `editor.deviceTelemetry` (active device only) |
| `actions.ts` | connect's editor methods, `connectDevice`, `reconnect` |
| `leases.ts` | scan and watch leases, the renew interval |
| `notice.ts` | notice and markers |
| `health.ts` | latency ring, clock offset estimator and its heartbeat feed |
| `names.ts` | kinds, device names (B9), the label |

## Limits

- **The held check has one race window of one heartbeat** (engine ask E2 deferred: `game.pause`
  answers the boolean `isPaused()`, no "already held" signal). Another editor client holding the
  same `devtools` reason between the readout and the pause makes both think they paused it; the
  first `game.resume` releases it, the second is a harmless no-op. A hold by the person under
  another reason is never released by `game.resume`, which pops only `devtools`. The hub sends the
  readout only when `paused` flips, so a game whose very first heartbeat said paused reads as
  running until its next flip.
- **`clockOffsetMs()` is as good as the heartbeat and the ping.** It is fed by `link.onHeartbeat`
  with the active device's beats (link passes the chosen session's, which is the device while it is
  the source) and takes the beat as sent half the hub's ping round trip before it arrived (0 before
  the first pong). Each beat's transit beyond half the ping (the hub's forwarding, a busy tools tab)
  reads as the phone's clock being that much further behind; the median of 8 drops a single late
  beat, not a steady delay. A switch to another device starts the ring over.
- `connectDevice` waits 20 s, connect's default `answerTimeoutMs`; a server configured otherwise
  is not read.
- Names: the directory's marketing name when a wired phone matched, else the session's model, else
  "the device". `PerfSecond.device` (B9's second choice) is renderView's to read.
