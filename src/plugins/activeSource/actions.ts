/**
 * @file activeSource plugin — the Connect panel's actions through connect's editor methods (spec
 * 11 § 3 C1, § 4 API): device mode on by wire or on the network, the pairing answer, device mode
 * off, connecting one phone adb lists, and Reconnect from the notice.
 */
import type { DeviceDirectory, ListenInfo } from "../connect/protocol";
import { linkPlugin } from "../link";
import type { Json, SessionInfo } from "../registry/protocol";
import { ERROR_PREFIX } from "../registry/protocol";
import { nameOf } from "./names";
import { holdNotice } from "./notice";
import { loseSource, switchToDevice } from "./switch";
import type { ActiveSourceCtx } from "./types";

/**
 * How long connectDevice waits for the phone's debug game: connect's default answerTimeoutMs.
 */
export const ANSWER_TIMEOUT_MS = 20_000;

/**
 * The object members of a JSON value, or undefined for another value.
 *
 * @param value - A JSON value.
 * @returns Its members.
 * @example
 * ```ts
 * membersOf({ paired: true })?.paired; // true
 * membersOf([1]); // undefined
 * ```
 */
function membersOf(value: Json | undefined): { readonly [key: string]: Json } | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined;
}

/**
 * The listen of a `connect.wire` / `connect.network` answer: `{ listen: { port, adb, lan } }`.
 *
 * @param answer - The answer.
 * @returns The listen, or undefined for another shape.
 * @example
 * ```ts
 * readListen({ listen: { port: 47600, adb: "127.0.0.1:47600", lan: null } }); // { port: 47600, adb: "127.0.0.1:47600", lan: null }
 * readListen({ listen: "47600" }); // undefined
 * ```
 */
export function readListen(answer: Json): ListenInfo | undefined {
  const listen = membersOf(membersOf(answer)?.listen);
  if (listen === undefined) return undefined;
  const { port, adb, lan } = listen;
  const lanOk = lan === null || typeof lan === "string";
  return typeof port === "number" && typeof adb === "string" && lanOk
    ? { port, adb, lan }
    : undefined;
}

/**
 * The error of an answer of another shape: the tools page and the server are from different
 * builds.
 *
 * @param method - The editor method.
 * @param missing - What the answer lacks.
 * @returns The error.
 */
function badAnswer(method: string, missing: string): Error {
  return new Error(
    `${ERROR_PREFIX}${method} answered without ${missing}.\n  Restart moku-editor: the tools page and the server are from different builds.`
  );
}

/**
 * Turns device mode on (`connect.wire` or `connect.network`) and answers its listen.
 *
 * @param ctx - Domain context of activeSource.
 * @param method - The editor method.
 * @returns The listen addresses.
 * @throws {Error} connect's wire error; the two-line error of an answer without a listen.
 */
export async function listenOn(
  ctx: ActiveSourceCtx,
  method: "connect.wire" | "connect.network"
): Promise<ListenInfo> {
  const listen = readListen(await ctx.require(linkPlugin).callEditor(method));
  if (listen === undefined) throw badAnswer(method, "a listen");
  return listen;
}

/**
 * Answers a waiting pairing with the code the person typed.
 *
 * @param ctx - Domain context of activeSource.
 * @param ticket - PairAsk.ticket.
 * @param code - What the person typed.
 * @returns Whether the phone paired.
 * @throws {Error} connect's wire error (-32602 `no_ticket`); the two-line error of another answer.
 */
export async function confirmPairing(
  ctx: ActiveSourceCtx,
  ticket: string,
  code: string
): Promise<boolean> {
  const answer = await ctx.require(linkPlugin).callEditor("connect.confirm", { ticket, code });
  const paired = membersOf(answer)?.paired;
  if (typeof paired !== "boolean") throw badAnswer("connect.confirm", "paired");
  return paired;
}

/**
 * Refuses a waiting pairing.
 *
 * @param ctx - Domain context of activeSource.
 * @param ticket - PairAsk.ticket.
 * @returns When connect refused it.
 */
export async function refusePairing(ctx: ActiveSourceCtx, ticket: string): Promise<void> {
  await ctx.require(linkPlugin).callEditor("connect.refuse", { ticket });
}

/**
 * Turns device mode off (`connect.off`), or only its LAN listener. A loss while it runs reads
 * "stopped"; when the active device is one it cuts, the page returns to the local preview at once
 * (reason stopped), whatever reaches the page first: the answer or the session list.
 *
 * @param ctx - Domain context of activeSource.
 * @param options - `{ lan: true }` for the LAN listener only.
 * @returns When connect answered.
 * @throws {Error} connect's wire error (-32007 `not_owner`).
 */
export async function stopDevices(
  ctx: ActiveSourceCtx,
  options: { readonly lan?: boolean } | undefined
): Promise<void> {
  const { state } = ctx;
  const lan = options?.lan === true;
  const { current } = state;
  const cuts = current.kind === "device" && (!lan || current.device.link === "lan");

  state.stopping = true;
  try {
    await ctx.require(linkPlugin).callEditor("connect.off", lan ? { lan: true } : {});
  } finally {
    state.stopping = false;
  }
  if (cuts && state.current === current && state.target === undefined) loseSource(ctx, "stopped");
}

/**
 * The open session of the phone with a serial, once connect matched it to a linked device.
 *
 * @param directory - connect's directory.
 * @param serial - The phone's serial.
 * @returns The session id, or undefined while none.
 * @example
 * ```ts
 * sessionOfSerial(undefined, "R5CX30ABCDE"); // undefined
 * ```
 */
export function sessionOfSerial(
  directory: DeviceDirectory | undefined,
  serial: string
): string | undefined {
  const phone = directory?.wire.find(item => item.serial === serial);
  if (phone?.phase !== "linked" || phone.device === null) return undefined;
  return directory?.linked.find(entry => entry.id === phone.device)?.session ?? undefined;
}

/**
 * Waits until the phone's debug game linked: connect lists its session and link has it.
 *
 * @param ctx - Domain context of activeSource.
 * @param serial - The phone's serial.
 * @param model - Its model, for the error.
 * @returns The session id.
 * @throws {Error} The two-line "No debug game answered" after ANSWER_TIMEOUT_MS; a stop error when
 *   the plugin stops meanwhile.
 */
function waitForSession(ctx: ActiveSourceCtx, serial: string, model: string): Promise<string> {
  const { state } = ctx;
  const link = ctx.require(linkPlugin);
  const ready = (): string | undefined => {
    const id = sessionOfSerial(link.published("devices"), serial);
    const open = (list: readonly SessionInfo[]): boolean => list.some(item => item.id === id);
    return id !== undefined && open(link.sessions()) ? id : undefined;
  };
  const now = ready();
  if (now !== undefined) return Promise.resolve(now);

  return new Promise((resolve, reject) => {
    const ends: (() => void)[] = [];
    const finish = (): void => {
      for (const end of ends) end();
    };
    const check = (): void => {
      const id = ready();
      if (id === undefined) return;
      finish();
      resolve(id);
    };
    const cancel = (): void => {
      finish();
      reject(
        new Error(
          `${ERROR_PREFIX}activeSource stopped while ${model} was connecting.\n  The tools page is closing.`
        )
      );
    };
    const timer = setTimeout(() => {
      finish();
      reject(
        new Error(
          `${ERROR_PREFIX}No debug game answered on ${model}.\n  Start the debug build on the phone; a release build has no agent.`
        )
      );
    }, ANSWER_TIMEOUT_MS);
    ends.push(
      link.onPublished("devices", check),
      link.onSessions(check),
      () => clearTimeout(timer),
      () => state.waits.delete(cancel)
    );
    state.waits.add(cancel);
  });
}

/**
 * Connects one phone adb lists: device mode on for wires when off, a wait for its debug game, then
 * the switch (reason connected).
 *
 * @param ctx - Domain context of activeSource.
 * @param serial - WireDevice.serial.
 * @returns When the phone is the source.
 * @throws {Error} An unknown serial; an unauthorized phone; connect's wire errors; no debug game
 *   after ANSWER_TIMEOUT_MS (all two-line).
 */
export async function connectDevice(ctx: ActiveSourceCtx, serial: string): Promise<void> {
  const directory = ctx.require(linkPlugin).published("devices");
  const phone = directory?.wire.find(item => item.serial === serial);
  if (directory === undefined || phone === undefined) {
    throw new Error(
      `${ERROR_PREFIX}activeSource.connectDevice: no phone "${serial}" in the device directory.\n  Pass a serial from directory().wire.`
    );
  }
  if (phone.state === "unauthorized") {
    throw new Error(
      `${ERROR_PREFIX}Allow USB debugging on the phone.\n  Accept the prompt on its screen, then connect again.`
    );
  }
  if (!directory.mode.on) await listenOn(ctx, "connect.wire");

  const session = await waitForSession(ctx, serial, phone.model ?? serial);
  await switchToDevice(ctx, session, "connected");
}

/**
 * Reconnect from the notice: the lost device's newest session becomes the source when it is back;
 * else the rejoin rule waits for it without a time limit and the notice says so.
 *
 * @param ctx - Domain context of activeSource.
 * @returns Whether the device was back and is the source now.
 */
export async function reconnect(ctx: ActiveSourceCtx): Promise<boolean> {
  const { state } = ctx;
  const { lost } = state;
  if (lost === undefined) return false;

  const link = ctx.require(linkPlugin);
  const back = link
    .sessions()
    .filter(session => session.device?.id === lost.device)
    .toSorted((a, b) => b.connectedAt - a.connectedAt)[0];
  if (back !== undefined) {
    await switchToDevice(ctx, back.id, "rejoined");
    return true;
  }

  state.lost = { ...lost, waiting: true };
  const name = nameOf({ id: lost.device, model: lost.model }, link.published("devices"));
  holdNotice(state, `Waiting for ${name}…`);
  return false;
}
