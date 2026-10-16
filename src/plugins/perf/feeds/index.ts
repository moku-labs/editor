/**
 * @file perf feeds — barrel of the agent side of Mission control (spec 03 Delta 2026-10-16): the
 * capabilities, the pass window and `editor.perf.passes`, the timeline and `editor.perf.events`,
 * the frames feed, range detail, monitoring sections and memory trust. Imported by perf's own files
 * only (reader, stream, records, entries, lifecycle).
 */
export { refreshCaps, seeCap } from "./caps";
export { detailOf } from "./detail";
export { framesWireOf, noteSystemNames } from "./frames";
export { memoryOf, noteHeap } from "./memory";
export { passesWireOf, readPasses } from "./passes";
export {
  monitorStateOf,
  noteSections,
  readSections,
  runSections,
  SECTIONS_INPUT
} from "./sections";
export { eventsWireOf, listenTimeline } from "./timeline";
export { epochOf } from "./wire";
