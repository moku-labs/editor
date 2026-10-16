# connect

Server plugin (Complex tier). Lets the tools page connect a phone without an agent or a terminal:
it turns the hub's device mode on and off on request (adb listener; LAN listener), supplies the
hub's pairing confirm so a LAN phone is confirmed in the tools page, keeps and publishes the device
directory (`editor.devices`: phones adb lists, pairings asking, devices linked) and, for a phone by
wire that a tools page uses as its source, attaches CDP to its WebView and publishes the wired
telemetry (`editor.deviceTelemetry`: GPU clock and busy, CPU and memory per process, JS heap and
inferred GCs) once a second. The full specification is `.planning/specs/11-source.md` § 3.

Depends on `hubPlugin`. Server order: `files, hub, connect, collector, pages`.

## Config

| Field | Type | Default | Meaning |
|---|---|---|---|
| `adb` | `string` | `"adb"` | the adb command (a name on PATH or a path) |
| `adbTimeoutMs` | `number` | `5000` | one adb call is killed after this (500–60000) |
| `scanEveryMs` | `number` | `2000` | `adb devices -l` period while a scan lease or device mode is on (500–60000) |
| `answerTimeoutMs` | `number` | `20000` | a ready phone with no session after this reads "no debug game answered" (1000–300000) |
| `leaseMs` | `number` | `10000` | a scan or watch lease not renewed for this long ends (2000–120000) |
| `telemetryEveryMs` | `number` | `1000` | the telemetry tick (250–10000) |
| `meminfoEveryMs` | `number` | `5000` | `dumpsys meminfo` period (1000–60000) |
| `heapEveryMs` | `number` | `250` | CDP `Runtime.getHeapUsage` period (100–5000) |
| `gcDropMb` | `number` | `0.5` | a heap drop of at least this is an inferred GC (0.05–64) |
| `gcTrace` | `boolean` | `false` | lets the CDP client send `Tracing.start` / `Tracing.end`; the trace reading itself waits for a measurement on the A26 (decision 2026-10-16), so GCs stay inferred |
| `wire` | `"manual" \| "auto"` | `"manual"` | `"auto"`: the adb listener on at start when `adb version` answers and the port is free (never the LAN) |

A value out of its rule throws a two-line `TypeError` in `onInit`, e.g.
`[moku-editor] connect.heapEveryMs is 10.` / `  Give a whole number from 100 to 5000, for example 250.`

## Editor methods (`editor.connect.*` on the tools socket)

Registered with `hub.addEditorMethods` in `onInit`. Only tools connections reach them (hub token,
loopback Host and Origin); the LAN listener has no tools socket. Unknown params are refused -32602.

| Method | Params | Does | Answers |
|---|---|---|---|
| `connect.scan` | `{}` | renews the scan lease; starts the scan loop (and retries a missing adb) | the `DeviceDirectory`, after the first round |
| `connect.wire` | `{}` | device mode on with the adb listener when off; connect is its owner | `{ listen }` |
| `connect.network` | `{}` | device mode on when off, then the LAN listener | `{ listen }` with `lan` |
| `connect.off` | `{ lan?: boolean }` | `lan`: the LAN listener off; else device mode off — only while it is connect's | `{ listen \| null }` |
| `connect.confirm` | `{ ticket, code }` | pairs the asking phone when `code.trim()` is its code, else refuses it | `{ paired }` |
| `connect.refuse` | `{ ticket }` | refuses the asking phone | `{ refused: true }` |
| `connect.watch` | `{ device }` | renews this tools connection's telemetry lease; attaches a wired, linked device | `{ wired, reason? }` |
| `connect.unwatch` | `{ device }` | ends this connection's lease; detaches when no other lease holds the device | `{ ok: true }` |

Wire errors: `port_in_use` (-32000, "[moku-editor] port 47600 is in use." / "Is moku-editor perf
running? Stop it, or connect from its tools page."), `no_lan` (-32000, the hub's message),
`not_owner` (-32007, device mode belongs to `moku-editor perf`), `no_ticket` (-32602).

`watch` answers `wired: false` with `not-wired` (a LAN device), `ios` (an iPhone or iPad),
`not-linked`, `adb-missing` or `ambiguous` (two phones of one model), and runs no adb then.

## Published values

- `editor.devices` — `DeviceDirectory`: device mode and its owner, `confirmIn` (`page` while device
  mode is connect's, `terminal` while it is perf's), adb's availability, the phones of
  `adb devices -l` with their phase (`unauthorized`, `offline`, `ready`, `waiting`, `no-agent`,
  `linked`), the pairings asking (never their codes), the linked devices with their open session id.
  Published only when it changed, at most every 250 ms.
- `editor.deviceTelemetry` — `DeviceTelemetry`, once per tick of a watched device; also emitted as
  the per-plugin event `connect:telemetry`.

## API

`app.connect.directory()` (the directory now, frozen) and `app.connect.telemetry(device)` (the
record of the last tick). The tools page uses the editor methods; the api is for the bin and tests.

## Events

| Event | Payload | When |
|---|---|---|
| `connect:telemetry` (per-plugin) | `DeviceTelemetry` | each tick of a watched wired device; visible to plugins that depend on `connectPlugin` (the collector) |

Hooks the hub's per-plugin `hub:device`: `listening` → device mode on (owner `other` when connect
did not cause it) and the scan loop; `connected` → the directory; `closed` → that device's
telemetry detached; `stopped` → device mode off, the pairings asking answered false, every attach
detached.

## Reading sources

Every reading names its source: `/sys/kernel/gpu` (Samsung Mali), `/sys/class/kgsl/kgsl-3d0`
(Adreno), `/sys/kernel/ged/hal` (MediaTek), `/sys/class/devfreq/<name>` (a devfreq GPU),
`/proc/<pid>/stat` (CPU), `dumpsys meminfo` (memory), `cdp Runtime.getHeapUsage` (JS heap),
`none` (nothing found). A reading that fails is `available: false` with its reason; the others
stay.

## The adb allowlist

Every adb call is built by `adbArgs` (`wire/command.ts`) from the `AdbCommand` union and nothing
else; `wire/run.ts` is the only caller of the runner. Tokens are validated first: a serial
`^[\w.:-]{1,96}$`, a pid of at most 7 digits, `head` paths only `/proc/stat`, `/proc/<pid>/stat`,
the GPU table or `/sys/class/devfreq/<name>/cur_freq` (at most 12, `-n` 1 or 64), a devtools socket
`webview_devtools_remote_<pid>` or `chrome_devtools_remote`, and a forward removal only of a port
connect recorded. A refused token throws `[moku-editor] connect: refused adb token "<t>".` before
anything runs.

| Id | Command |
|---|---|
| A0 | `version` |
| A1 | `devices -l` |
| A2 | `-s <serial> shell getprop` |
| A3 | `-s <serial> shell cat /proc/net/unix` |
| A4 | `-s <serial> shell ps -A -o PID,NAME` |
| A5 | `-s <serial> shell head -n <1\|64> <paths…>` |
| A6 | `-s <serial> shell ls /sys/class/devfreq` |
| A8 | `-s <serial> shell dumpsys meminfo <pid>` |
| A9 | `-s <serial> forward tcp:0 localabstract:<socket>` |
| A10 | `-s <serial> forward --remove tcp:<port>` |

`reverse` stays the collector's.

## CDP security

The CDP socket is full control of the page, so connect opens it only for a phone by wire that a
tools page watches, over an adb forward on this computer's loopback, from Bun with no Origin
header, and dials only a debugger URL on that forward's port. Only derived numbers are published.
The client sends only `Runtime.getHeapUsage`, `Performance.enable`, `Performance.getMetrics`,
`Memory.getDOMCounters` (and with `gcTrace` `Tracing.start` / `Tracing.end`); any other method
throws `[moku-editor] connect: CDP method <m> is not allowed.` before anything is written. The
socket closes and the forward is removed when the lease ends, the device leaves, adb stops listing
the phone, or the app stops.

## Files

| File | Holds |
|---|---|
| `index.ts` | wiring |
| `types.ts` | config, records, state, api, events, ctx |
| `state.ts` | the state, the runtime seams, an attach record |
| `api.ts`, `init.ts`, `lifecycle.ts`, `handlers.ts`, `methods.ts` | api, onInit, onStart/onStop, the `hub:device` hook, the editor methods |
| `directory.ts`, `mode.ts`, `shared.ts` | the directory and its publish, device mode on/off, small helpers |
| `wire/` | `command.ts` (the allowlist), `run.ts` (the runner), `parse.ts`, `scan.ts` |
| `pairing/confirm.ts` | the pairing confirm |
| `cdp/` | `client.ts`, `attach.ts`, `heap.ts` |
| `telemetry/` | `probe.ts`, `gpu.ts`, `cpu.ts`, `meminfo.ts`, `tick.ts`, `loop.ts` |
| `protocol/` | the runtime-free wire types and guards |

## Limits (v1, honest)

- Telemetry is Android by wire only. A LAN device reads `not-wired`, an iPhone `ios`: there is no
  iOS debug build in `@moku-labs/native` 0.3.9.
- "Discovered" means plugged in over adb, asking to pair, or linked; phones on the Wi-Fi that never
  dialled the editor are not seen. No mDNS, no QR in v1.
- A phone is matched to its linked device by model alone; two phones of one model are `ambiguous`
  (no telemetry). The app id (`header.app.id`, engine ask E3) is not on the hub's session yet.
- The app's pid comes from its WebView devtools socket; a build without WebView debugging has no
  socket, so app CPU and memory read `not-found` and the heap `no-devtools-socket`.
  surfaceflinger and the GPU still read.
- A GPU node SELinux hides answers nothing on a current adb (stderr is separate), so it reads
  `not-found`; `no-permission` shows only where adb merges stderr.
- GCs are inferred from heap drops of at least `gcDropMb`; minor GCs below it are not seen.
