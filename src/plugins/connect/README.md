# connect

Server plugin (Complex tier). Lets the tools page connect a phone without an agent or a terminal:
it turns the hub's device mode on and off on request (adb listener; LAN listener), supplies the
hub's pairing confirm so a LAN phone is confirmed in the tools page, keeps and publishes the device
directory (`editor.devices`: phones adb lists, pairings asking, devices linked) and, for a phone by
wire that a tools page uses as its source, attaches CDP to its WebView and publishes the wired
telemetry (`editor.deviceTelemetry`: GPU clock and busy, CPU and memory per process, JS heap and
inferred GCs) once a second. The full specification is `.planning/specs/11-source.md` § 3.

**Status:** skeleton of build wave 0. The config and the wire types of `connect/protocol` are
final; the editor methods (`connect.scan`, `.wire`, `.network`, `.off`, `.confirm`, `.refuse`,
`.watch`, `.unwatch`), the api, the `hub:device` hook and the per-plugin event `connect:telemetry`
land in build wave 2.

## Config

| Field | Type | Default | Meaning |
|---|---|---|---|
| `adb` | `string` | `"adb"` | the adb command (a name on PATH or a path) |
| `adbTimeoutMs` | `number` | `5000` | one adb call is killed after this |
| `scanEveryMs` | `number` | `2000` | `adb devices -l` period while a scan lease or device mode is on |
| `answerTimeoutMs` | `number` | `20000` | a ready phone with no session after this reads "no debug game answered" |
| `leaseMs` | `number` | `10000` | a scan or watch lease not renewed for this long ends |
| `telemetryEveryMs` | `number` | `1000` | the telemetry tick |
| `meminfoEveryMs` | `number` | `5000` | `dumpsys meminfo` period |
| `heapEveryMs` | `number` | `250` | CDP `Runtime.getHeapUsage` period |
| `gcDropMb` | `number` | `0.5` | a heap drop of at least this is an inferred GC |
| `gcTrace` | `boolean` | `false` | exact GC events through CDP Tracing (heavier) |
| `wire` | `"manual" \| "auto"` | `"manual"` | `"auto"`: the adb listener on at start when adb is on PATH |

## Wire types (`connect/protocol`)

Runtime-free, imported by relative path from any core: `DeviceDirectory`, `WireDevice`, `PairAsk`,
`LinkedEntry`, `ListenInfo`, `DeviceTelemetry`, `Reading<T>`, `ProcessCpu`, `ProcessMemory`,
`GpuLoad`, `HeapSample`, `HeapGc`, `ReadingOffReason`, `TelemetryOffReason`, and the shape guards
`readDirectory` and `readTelemetry` the tools page's link checks every published value with.
`registry/protocol`'s `PublishParams` names `devices` and `deviceTelemetry` with these types.
