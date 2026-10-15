/**
 * @file renderView device strip — the recorder's `RecorderStatus` (spec 05), the value of its
 * `editor.recorder` source, re-exported as a type from the recorder's runtime-free wire module
 * (`recorder/protocol`): no recorder code enters the tools bundle.
 */
export type { RecorderStatus } from "../../../recorder/protocol";
