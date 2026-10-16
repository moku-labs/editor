/**
 * @file renderView derive — the Connect panel's rows and the honest v1 texts (spec 09 § M7 Connect
 * panel, spec 11 § 0 and delta-source "Reconciliation"): By wire (the phones adb lists by phase, adb
 * missing, the fixed iPhone line), On the network (listen, or the address and "Waiting for a phone to
 * dial …" — no LAN scan, no editor code, no QR), asking to link (a 4-digit code, or confirm in the
 * terminal), linked devices, the split menu and the success alert. Pure.
 */
import type {
  ActiveSource,
  DeviceDirectory,
  LinkedEntry,
  PairAsk,
  WireDevice
} from "../source/contract";

/** The header's note. */
export const CONNECT_NOTE = "The editor links a debug build of your game, no agent needed";

/** By wire, left column. */
export const CABLE_TITLE = "Android by USB";
export const CABLE_HELP =
  "Plug the phone in with USB debugging on. The editor runs `adb reverse` for you.";
export const CABLE_EMPTY = "No phone on USB. Plug one in with USB debugging on.";
export const ADB_MISSING =
  "adb not found: install Android platform-tools to connect by wire. On the network works without it.";

/** By wire, right column: there is no iOS debug build to link (2026-10-16). */
export const IPHONE_LINE =
  "iPhone and iPad: not available yet. There is no iOS debug build to link.";

/** On the network. */
export const LISTEN_NOTE = "The phone dials this computer; nothing is scanned.";
export const NETWORK_HELP =
  "The phone and this computer must share a network. Android needs a debug build from `@moku-labs/native` 0.3.9 or newer (cleartext on; LAN scope to verify on the A26); there is no iOS debug build yet. A game in a phone browser cannot link.";

/** A wrong pairing code. */
export const CODE_MISMATCH = "That code does not match. Try again.";

/** The footer's button title. */
export const STOP_TITLE = "Unlinks every phone; the page returns to the local preview";

/**
 * What a By wire row offers on its right side.
 *
 * @example
 * ```ts
 * const action: RowAction = { kind: "connect" }; // primary sm "Connect"
 * ```
 */
export type RowAction =
  | { readonly kind: "connect" }
  | { readonly kind: "use"; readonly session: string }
  | { readonly kind: "spinner"; readonly text: string }
  | { readonly kind: "tag"; readonly text: string; readonly tone: "ok" | "warn" | "muted" };

/**
 * A By wire row.
 *
 * @example
 * ```ts
 * const row: CableRow = { key: "R5CX30ABCDE", title: "Galaxy A26", sub: "SM-A266B, Android 15, on USB", action: { kind: "connect" }, disabled: false };
 * ```
 */
export type CableRow = {
  readonly key: string;
  readonly title: string;
  readonly sub: string;
  readonly action: RowAction;
  readonly disabled: boolean;
};

/**
 * A By wire row's state in words: "Allow USB debugging on the phone (a prompt is on its screen)" for
 * an unauthorized phone, "Release build: no agent" for no-agent, "Waiting for the game…", "offline".
 *
 * @param device - A phone of directory().wire.
 * @returns The text.
 * @example
 * ```ts
 * cableRowText({ ...phone, phase: "unauthorized" }); // "Allow USB debugging on the phone (a prompt is on its screen)"
 * ```
 */
export function cableRowText(device: WireDevice): string {
  if (device.match === "ambiguous") return "Two games answered; pick from Linked devices";
  switch (device.phase) {
    case "unauthorized": {
      return "Allow USB debugging on the phone (a prompt is on its screen)";
    }
    case "no-agent": {
      return "Release build: no agent";
    }
    case "waiting": {
      return "Waiting for the game…";
    }
    case "offline": {
      return "offline";
    }
    case "linked": {
      return "Connected";
    }
    default: {
      return "Connect";
    }
  }
}

/**
 * The action of a linked phone: "Connected" when it is the source (or has no session), else "Use".
 *
 * @param device - The phone.
 * @param current - The active source.
 * @param linked - The linked devices (for the phone's session).
 * @returns The action.
 */
function linkedAction(
  device: WireDevice,
  current: ActiveSource | undefined,
  linked: readonly LinkedEntry[]
): RowAction {
  const session = linked.find(entry => entry.id === device.device)?.session;
  const inUse = current?.kind === "device" && current.device.id === device.device;
  if (inUse || session === null || session === undefined) {
    return { kind: "tag", text: "Connected", tone: "ok" };
  }
  return { kind: "use", session };
}

/**
 * The action of a By wire row by phase.
 *
 * @param device - The phone.
 * @param current - The active source.
 * @param linked - The linked devices.
 * @returns The action.
 */
function cableAction(
  device: WireDevice,
  current: ActiveSource | undefined,
  linked: readonly LinkedEntry[]
): RowAction {
  const text = cableRowText(device);
  if (device.match === "ambiguous") return { kind: "tag", text, tone: "warn" };
  if (device.phase === "ready") return { kind: "connect" };
  if (device.phase === "waiting") return { kind: "spinner", text };
  if (device.phase === "linked") return linkedAction(device, current, linked);
  return { kind: "tag", text, tone: device.phase === "offline" ? "muted" : "warn" };
}

/**
 * A By wire row: the phone's name, "{model}, {os}, on USB" (wireless adb: "over Wi-Fi debugging"),
 * its action by phase; a release build (no agent) is disabled.
 *
 * @param device - A phone of directory().wire.
 * @param current - The active source.
 * @param linked - directory().linked.
 * @returns The row.
 * @example
 * ```ts
 * cableRow(phone, current, directory.linked).sub; // "SM-A266B, Android 15, on USB"
 * ```
 */
export function cableRow(
  device: WireDevice,
  current: ActiveSource | undefined,
  linked: readonly LinkedEntry[]
): CableRow {
  const how = device.transport === "wifi" ? "over Wi-Fi debugging" : "on USB";
  const facts = [device.model, device.os].filter((fact): fact is string => fact !== null);
  return {
    key: device.serial,
    title: device.name ?? device.model ?? device.serial,
    sub: [...facts, how].join(", "),
    action: cableAction(device, current, linked),
    disabled: device.phase === "no-agent"
  };
}

/**
 * The On the network tab: listen (device mode off for the LAN) or the address the phone dials and
 * what to do on the phone.
 *
 * @example
 * ```ts
 * const view: NetworkView = { kind: "listen", note: "The phone dials this computer; nothing is scanned." };
 * ```
 */
export type NetworkView =
  | { readonly kind: "listen"; readonly note: string }
  | {
      readonly kind: "listening";
      readonly address: string;
      readonly waiting: string;
      readonly instructions: string;
    };

/**
 * The On the network tab: "Listen on the network" while the LAN listener is off, else the address,
 * "Waiting for a phone to dial {lan}" and the instructions. Nothing is scanned.
 *
 * @param directory - activeSource.directory().
 * @returns The view.
 * @example
 * ```ts
 * networkView(directory).kind; // "listen" while mode.listen.lan is null
 * ```
 */
export function networkView(directory: DeviceDirectory | undefined): NetworkView {
  const lan = directory?.mode.listen?.lan;
  if (lan === null || lan === undefined) return { kind: "listen", note: LISTEN_NOTE };
  return {
    kind: "listening",
    address: lan,
    waiting: `Waiting for a phone to dial ${lan}`,
    instructions: `On the phone: open the overlay's Link tab and enter ${lan}, or build with \`moku-game build --debug --editor ${lan}\`.`
  };
}

/**
 * An "Asking to link" row: the phone and its address, and either the 4-digit code input or, while
 * `moku-editor perf` owns the pairing, "Confirm in the terminal that runs moku-editor perf".
 *
 * @example
 * ```ts
 * const row: AskingRow = { ticket: "p-3a1f", title: "SM-A266B at 192.168.1.23", sub: "type the code on its screen", input: true };
 * ```
 */
export type AskingRow = {
  readonly ticket: string;
  readonly title: string;
  readonly sub: string;
  readonly input: boolean;
};

/**
 * An "Asking to link" row.
 *
 * @param ask - A pairing of directory().asking.
 * @param confirmIn - directory().confirmIn.
 * @returns The row.
 * @example
 * ```ts
 * askingRow(ask, "terminal").input; // false: "Confirm in the terminal that runs moku-editor perf"
 * ```
 */
export function askingRow(ask: PairAsk, confirmIn: DeviceDirectory["confirmIn"]): AskingRow {
  const terminal = confirmIn === "terminal";
  return {
    ticket: ask.ticket,
    title: `${ask.model ?? "A phone"} at ${ask.address}`,
    sub: terminal
      ? "Confirm in the terminal that runs moku-editor perf"
      : "type the code on its screen",
    input: !terminal
  };
}

/**
 * A Linked devices row.
 *
 * @example
 * ```ts
 * const row: LinkedRow = { id: "d-7f3a", title: "SM-A266B", how: "by wire", online: true, latency: "9 ms", action: { kind: "in-use" } };
 * ```
 */
export type LinkedRow = {
  readonly id: string;
  readonly title: string;
  readonly how: string;
  readonly online: boolean;
  /** "{latency} ms"; "away" when the device has no session. */
  readonly latency: string;
  readonly action:
    | { readonly kind: "in-use" }
    | { readonly kind: "use"; readonly session: string }
    | undefined;
};

/**
 * A Linked devices row: "In use" for the current source, "Use" with its session, nothing while away.
 *
 * @param entry - A device of directory().linked.
 * @param current - The active source.
 * @returns The row.
 * @example
 * ```ts
 * linkedRow(entry, current).action; // { kind: "in-use" }
 * ```
 */
export function linkedRow(entry: LinkedEntry, current: ActiveSource | undefined): LinkedRow {
  const inUse = current?.kind === "device" && current.device.id === entry.id;
  let action: LinkedRow["action"];
  if (inUse) action = { kind: "in-use" };
  else if (entry.session !== null) action = { kind: "use", session: entry.session };
  let latency = "away";
  if (entry.session !== null) {
    latency = entry.latencyMs === null ? "—" : `${Math.round(entry.latencyMs)} ms`;
  }
  return {
    id: entry.id,
    title: entry.model ?? entry.id,
    how: entry.link === "lan" ? "on the network" : "by wire",
    online: entry.online,
    latency,
    action
  };
}

/**
 * The tab the panel opens on: By wire when adb lists a phone, else On the network.
 *
 * @param directory - activeSource.directory().
 * @returns The tab.
 * @example
 * ```ts
 * defaultTab(undefined); // "network"
 * ```
 */
export function defaultTab(directory: DeviceDirectory | undefined): "wire" | "network" {
  return (directory?.wire.length ?? 0) > 0 ? "wire" : "network";
}

/**
 * One item of the Connect split button's menu.
 *
 * @example
 * ```ts
 * const item: MenuItem = { id: "wire", label: "By wire", sub: "USB: Android with USB debugging" };
 * ```
 */
export type MenuItem = {
  readonly id: "wire" | "network" | "linked";
  readonly label: string;
  readonly sub: string;
};

/**
 * The split button's menu: By wire, On the network and, when phones are linked, Linked devices.
 *
 * @param directory - activeSource.directory().
 * @returns The items.
 * @example
 * ```ts
 * splitMenu(directory).map(item => item.label); // ["By wire", "On the network", "Linked devices"]
 * ```
 */
export function splitMenu(directory: DeviceDirectory | undefined): MenuItem[] {
  const items: MenuItem[] = [
    { id: "wire", label: "By wire", sub: "USB: Android with USB debugging" },
    { id: "network", label: "On the network", sub: "Same Wi-Fi: the phone dials this computer" }
  ];
  if ((directory?.linked.length ?? 0) > 0) {
    items.push({ id: "linked", label: "Linked devices", sub: "Phones already linked in this run" });
  }
  return items;
}

/**
 * The alert of a switch to a device while the panel is open, and its toast.
 *
 * @param name - The device's name.
 * @returns The alert's strong and rest words and the toast.
 * @example
 * ```ts
 * connectedAlert("Galaxy A26").toast; // "Galaxy A26 connected. The local preview is paused."
 * ```
 */
export function connectedAlert(name: string): {
  readonly strong: string;
  readonly rest: string;
  readonly toast: string;
} {
  return {
    strong: `Connected to ${name}.`,
    rest: `The local preview is paused. Every card now shows ${name}.`,
    toast: `${name} connected. The local preview is paused.`
  };
}
