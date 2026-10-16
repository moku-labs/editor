/* eslint-disable unicorn/no-null -- null is "device mode off" on the wire */
/**
 * @file connect plugin — the editor-channel methods connect registers on the hub (spec 11 C1):
 * `connect.scan`, `.wire`, `.network`, `.off`, `.confirm`, `.refuse`, `.watch`, `.unwatch`. Each
 * checks its params with `checkInput` (unknown fields refused, -32602) and answers JSON; a throw is
 * answered as a wire error by the hub. Only tools connections reach them (hub token, loopback Host
 * and Origin; no tools socket on the LAN listener).
 */
import type { DeviceListen, EditorMethods } from "../hub/types";
import type { Json } from "../registry/protocol";
import { checkInput, toWireValue } from "../registry/protocol";
import { currentDirectory } from "./directory";
import { turnNetworkOn, turnOff, turnWireOn } from "./mode";
import { answerPairing, refusePairing } from "./pairing/confirm";
import { unwatchDevice, watchDevice } from "./telemetry/loop";
import type { ConnectCtx } from "./types";
import { renewScan } from "./wire/scan";

/**
 * A listen as JSON.
 *
 * @param listen - Where device mode listens.
 * @returns `{ port, adb, lan }`.
 * @example
 * ```ts
 * listenJson({ port: 47600, adb: "127.0.0.1:47600", lan: null }); // { port: 47600, adb: "127.0.0.1:47600", lan: null }
 * ```
 */
function listenJson(listen: DeviceListen): Json {
  return { port: listen.port, adb: listen.adb, lan: listen.lan };
}

/**
 * The editor methods of connect, for `hub.addEditorMethods`.
 *
 * @param ctx - Domain context of connect.
 * @returns The methods by name.
 */
export function createEditorMethods(ctx: ConnectCtx): EditorMethods {
  return {
    "connect.scan": async params => {
      checkInput({}, params ?? null);
      await renewScan(ctx);
      return toWireValue(currentDirectory(ctx));
    },
    "connect.wire": async params => {
      checkInput({}, params ?? null);
      return { listen: listenJson(await turnWireOn(ctx)) };
    },
    "connect.network": async params => {
      checkInput({}, params ?? null);
      return { listen: listenJson(await turnNetworkOn(ctx)) };
    },
    "connect.off": async params => {
      const { lan } = checkInput({ lan: "boolean?" }, params ?? null);
      const listen = await turnOff(ctx, lan === true);
      return { listen: listen === null ? null : listenJson(listen) };
    },
    "connect.confirm": async params => {
      const { ticket, code } = checkInput({ ticket: "string", code: "string" }, params ?? null);
      return { paired: answerPairing(ctx, ticket, code) };
    },
    "connect.refuse": async params => {
      const { ticket } = checkInput({ ticket: "string" }, params ?? null);
      refusePairing(ctx, ticket);
      return { refused: true };
    },
    "connect.watch": async (params, caller) => {
      const { device } = checkInput({ device: "string" }, params ?? null);
      const answer = watchDevice(ctx, device, caller.conn);
      return answer.reason === undefined
        ? { wired: answer.wired }
        : { wired: answer.wired, reason: answer.reason };
    },
    "connect.unwatch": async (params, caller) => {
      const { device } = checkInput({ device: "string" }, params ?? null);
      unwatchDevice(ctx, device, caller.conn);
      return { ok: true };
    }
  };
}
