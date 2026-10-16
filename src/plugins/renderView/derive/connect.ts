/**
 * @file renderView derive — the Connect panel's rows and the honest v1 texts (spec 09 § M7,
 * spec 11 § 0): By wire (phones adb lists, the iPhone line, adb missing), On the network
 * (listen, the address, waiting for a phone to dial), asking to link, linked. Pure. Typed stub
 * of build wave 0 (spec 09 § M17, RV0): the signatures are the contract the other Mission
 * control units build against; build wave 3 (RV3) writes the bodies.
 */
import type { WireDevice } from "../source/contract";
import { notBuilt } from "../stub";

/**
 * A By wire row's state in words: "Allow USB debugging on the phone" for an unauthorized phone,
 * "Release build: no agent" for no-agent, and so on.
 *
 * @param _device - A phone of directory().wire.
 * @returns The text.
 * @throws {Error} Until build wave 3: "renderView derive/wireRowText is not built yet".
 */
export function wireRowText(_device: WireDevice): string {
  return notBuilt("derive/wireRowText", 3);
}
