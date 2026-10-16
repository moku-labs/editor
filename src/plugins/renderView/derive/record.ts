/**
 * @file renderView derive — the recording's words (spec 09 § M5, spec 05 R2): who started it
 * ("you", "you (on the phone)", "agent (Claude)", "agent", "the editor or an agent", "the
 * game", "on launch"), the path, the marks. Pure. Typed stub of build wave 0 (spec 09 § M17,
 * RV0): the signatures are the contract the other Mission control units build against; build
 * wave 3 (RV3) writes the bodies.
 */
import type { Json } from "../../registry/protocol";
import type { LogMark, RecorderSource, RecordOrigin } from "../source/contract";
import { notBuilt } from "../stub";
import type { MissionView, RecordAnswer } from "../types";

/**
 * Who started the log, in words: an agent with a name reads "agent (Claude)", without one
 * "agent".
 *
 * @param _origin - startedBy of the recorder's status.
 * @returns The words.
 * @throws {Error} Until build wave 3: "renderView derive/whoText is not built yet".
 */
export function whoText(_origin: RecordOrigin | null): string {
  return notBuilt("derive/whoText", 3);
}

/**
 * The recording part of MissionView.
 *
 * @param _recorder - The newest editor.recorder value.
 * @returns The view; undefined without a recorder source.
 * @throws {Error} Until build wave 3: "renderView derive/recordingView is not built yet".
 */
export function recordingView(_recorder: RecorderSource | undefined): MissionView["recording"] {
  return notBuilt("derive/recordingView", 3);
}

/**
 * A Record or Stop answer in words.
 *
 * @param _on - Record (true) or Stop.
 * @param _value - editor.record's answer.
 * @returns The answer.
 * @throws {Error} Until build wave 3: "renderView derive/recordAnswerOf is not built yet".
 */
export function recordAnswerOf(_on: boolean, _value: Json): RecordAnswer {
  return notBuilt("derive/recordAnswerOf", 3);
}

/**
 * A refused Record or Stop in words.
 *
 * @param _error - What the run rejected with.
 * @returns The answer.
 * @throws {Error} Until build wave 3: "renderView derive/recordRefusalOf is not built yet".
 */
export function recordRefusalOf(_error: unknown): RecordAnswer {
  return notBuilt("derive/recordRefusalOf", 3);
}

/**
 * The label of a new mark: the typed text trimmed, or "mark {n + 1}" when empty.
 *
 * @param _label - What the person typed.
 * @param _marks - The log's marks so far.
 * @returns The label.
 * @throws {Error} Until build wave 3: "renderView derive/markLabelOf is not built yet".
 */
export function markLabelOf(_label: string | undefined, _marks: readonly LogMark[]): string {
  return notBuilt("derive/markLabelOf", 3);
}
