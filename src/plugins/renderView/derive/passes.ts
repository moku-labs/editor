/**
 * @file renderView derive — the Shaders & passes panel (spec 09 § M9): chains, problems and
 * compiles in words; a tile GPU shows shares, never ms per pass. Pure. Typed stub of build wave
 * 0 (spec 09 § M17, RV0): the signatures are the contract the other Mission control units build
 * against; build wave 3 (RV3) writes the bodies.
 */
import type { PassRowWire } from "../source/contract";
import { notBuilt } from "../stub";

/**
 * A pass's GPU cell: its share ("≈ 52 %") on a tile GPU, its ms elsewhere, "—" when not
 * measured.
 *
 * @param _pass - A pass of the heaviest frame.
 * @param _tiler - The GPU is a tile GPU.
 * @returns The text.
 * @throws {Error} Until build wave 3: "renderView derive/passCellText is not built yet".
 */
export function passCellText(_pass: PassRowWire, _tiler: boolean): string {
  return notBuilt("derive/passCellText", 3);
}
