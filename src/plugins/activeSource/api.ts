/**
 * @file activeSource plugin — the typed api stub of build wave 0 (spec 11 § 10, unit S0): every
 * member of ActiveSourceApi exists with its final signature and throws the two-line "not built"
 * error, so the tools plugins that depend on activeSource type-check against the real api. Build
 * wave 2 (unit S2b) replaces this file.
 */
import type { ActiveSourceApi } from "./types";

/**
 * Throws the "not built" error of a member.
 *
 * @param member - The api member that was called.
 * @throws {Error} `[moku-editor] activeSource.<member> is not built yet.\n  It lands in build wave 2.`
 */
function notBuilt(member: keyof ActiveSourceApi): never {
  throw new Error(
    `[moku-editor] activeSource.${member} is not built yet.\n  It lands in build wave 2.`
  );
}

/**
 * Creates the stub api: each member throws "not built".
 *
 * @returns The stub api.
 */
export function createActiveSourceApi(): ActiveSourceApi {
  return {
    current: () => notBuilt("current"),
    preview: () => notBuilt("preview"),
    useDevice: () => notBuilt("useDevice"),
    useLocal: () => notBuilt("useLocal"),
    onChange: () => notBuilt("onChange"),
    directory: () => notBuilt("directory"),
    scan: () => notBuilt("scan"),
    connectWire: () => notBuilt("connectWire"),
    connectNetwork: () => notBuilt("connectNetwork"),
    confirmPairing: () => notBuilt("confirmPairing"),
    refusePairing: () => notBuilt("refusePairing"),
    stopDevices: () => notBuilt("stopDevices"),
    telemetry: () => notBuilt("telemetry"),
    onTelemetry: () => notBuilt("onTelemetry"),
    markers: () => notBuilt("markers"),
    notice: () => notBuilt("notice"),
    dismissNotice: () => notBuilt("dismissNotice"),
    reconnect: () => notBuilt("reconnect"),
    connectDevice: () => notBuilt("connectDevice"),
    label: () => notBuilt("label"),
    health: () => notBuilt("health"),
    clockOffsetMs: () => notBuilt("clockOffsetMs"),
    openConnect: () => notBuilt("openConnect")
  };
}
