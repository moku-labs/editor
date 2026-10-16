/**
 * @file renderView derive — what a graph shows instead of data (spec 09 § M9 States, § M19): not
 * started, waiting, no monitor, an older agent, a section off — in that priority — and their words.
 * Pure.
 */

/**
 * What is known of the source when a graph picks its overlay: a local preview or device is running,
 * its first second arrived (and frames), its agent has a frame monitor (`editor.perf.second`), its
 * agent has the Mission control feeds (`editor.perf.frames`), the graph's section is on.
 *
 * @example
 * ```ts
 * const input: OverlayInput = { started: true, second: false, monitored: true, feeds: true, sectionOn: true }; // "waiting"
 * ```
 */
export type OverlayInput = {
  readonly started: boolean;
  readonly second: boolean;
  readonly monitored: boolean;
  readonly feeds: boolean;
  readonly sectionOn: boolean;
};

/**
 * What a graph shows instead of data.
 *
 * @example
 * ```ts
 * const overlay: MissionOverlay = "waiting"; // "Waiting for the first frames from Galaxy A26"
 * ```
 */
export type MissionOverlay =
  | "not-started"
  | "waiting"
  | "no-monitor"
  | "older-agent"
  | "section-off"
  | undefined;

/**
 * The overlay, by priority: nothing running; waiting for the first frames (a monitored source
 * without a second yet); no frame monitor; an agent before the Mission control feeds; the graph's
 * section off.
 *
 * @param input - What is known of the source.
 * @returns The overlay; undefined when the graph shows data.
 * @example
 * ```ts
 * overlayOf({ started: false, second: false, monitored: true, feeds: true, sectionOn: false }); // "not-started", not "section-off"
 * ```
 */
export function overlayOf(input: OverlayInput): MissionOverlay {
  if (!input.started) return "not-started";
  if (input.monitored && !input.second) return "waiting";
  if (!input.monitored) return "no-monitor";
  if (!input.feeds) return "older-agent";
  return input.sectionOn ? undefined : "section-off";
}

/**
 * The words of the timeline's overlay (spec 09 § M9 States).
 *
 * @param overlay - The overlay.
 * @param context - The source's name, its link words and latency, and the probe text of a game
 *   without a monitor.
 * @param context.name - The source's name.
 * @param context.link - "The link is up (9 ms by wire)." words: the latency and transport.
 * @param context.offText - perf's probe text of a game without a monitor.
 * @returns The title and the body; undefined without an overlay.
 * @example
 * ```ts
 * overlayText("waiting", { name: "Galaxy A26", link: "9 ms by wire", offText: "" })?.title; // "Waiting for the first frames from Galaxy A26"
 * ```
 */
export function overlayText(
  overlay: MissionOverlay,
  context: { readonly name: string; readonly link: string; readonly offText: string }
): { readonly title: string; readonly body: string } | undefined {
  switch (overlay) {
    case "not-started": {
      return {
        title: "Nothing is running yet",
        body: "Start the local preview, or connect a device to watch its frames here."
      };
    }
    case "waiting": {
      return {
        title: `Waiting for the first frames from ${context.name}`,
        body: `The link is up (${context.link}). Frames arrive once the game draws its first scene.`
      };
    }
    case "no-monitor": {
      return { title: "This game has no frame monitor", body: context.offText };
    }
    case "older-agent": {
      return {
        title: "This game's editor agent is older",
        body: "Update @moku-labs/editor in the game to see its frames here."
      };
    }
    case "section-off": {
      return {
        title: "Frames are off",
        body: "Turn Frames on in Monitoring to see the frame graph."
      };
    }
    default: {
      return undefined;
    }
  }
}

/** The words of a card's off panel per Monitoring row (spec 09 § M9 States, Section off). */
const OFF_TITLES = {
  frames: "Frames is off",
  render: "Render stats is off",
  passes: "Shaders & passes is off",
  memory: "Memory & GC is off",
  gpu: "GPU timing is off",
  systems: "Systems timing is off",
  nodes: "Nodes is off"
} as const;

/**
 * The title of a card's off panel ("{Section} is off" + "Turn on").
 *
 * @param section - The card's Monitoring row.
 * @returns The title.
 * @example
 * ```ts
 * cardOffText("memory"); // "Memory & GC is off"
 * ```
 */
export function cardOffText(section: keyof typeof OFF_TITLES): string {
  return OFF_TITLES[section];
}
