import { describe, expect, it } from "vitest";
import type { CommandDescriptor, Manifest } from "../../protocol";
import { commandsHash } from "../../protocol";

// ─────────────────────────────────────────────────────────────────────────────
// commandsHash (D-37): the hub stamps it on SessionInfo, the MCP bridge
// rebuilds its door tools only when it moves. Ids, effects and inputs count;
// titles, sources and the order of the commands do not.
// ─────────────────────────────────────────────────────────────────────────────

/** The game.tap door of the spec example. */
const TAP: CommandDescriptor = {
  id: "game.tap",
  title: "Tap",
  input: { target: "string" },
  effect: "route"
};

/** A cheat door with two fields, one of them optional. */
const FILL: CommandDescriptor = {
  id: "game.fill",
  title: "Fill the board",
  input: { kind: "string", count: "number?" },
  effect: "cheat"
};

/** A door without input. */
const RESTORE: CommandDescriptor = {
  id: "game.restore",
  title: "Restore",
  input: {},
  effect: "raw"
};

/**
 * A manifest of a game page with the given commands.
 *
 * @param commands - The command doors.
 * @returns The manifest.
 */
function manifestOf(commands: readonly CommandDescriptor[]): Manifest {
  return {
    game: "merge-game 0.0.0",
    page: "http://127.0.0.1:3000/",
    embedded: true,
    sources: [{ id: "game.state", title: "State", input: {}, changes: "commit" }],
    commands
  };
}

describe("commandsHash", () => {
  it("is 8 lowercase hex chars", () => {
    expect(commandsHash(manifestOf([TAP]))).toMatch(/^[\da-f]{8}$/);
  });

  it("is the FNV-1a offset basis for no commands", () => {
    expect(commandsHash(manifestOf([]))).toBe("811c9dc5");
  });

  it("is the FNV-1a 32-bit hash of the canonical line of one command", () => {
    expect(commandsHash(manifestOf([TAP]))).toBe("4f528e73");
  });

  it("is the same for the same commands in another order", () => {
    const one = commandsHash(manifestOf([TAP, FILL, RESTORE]));

    expect(commandsHash(manifestOf([RESTORE, TAP, FILL]))).toBe(one);
    expect(commandsHash(manifestOf([FILL, RESTORE, TAP]))).toBe(one);
  });

  it("is the same when the input keys come in another order", () => {
    const reordered: CommandDescriptor = { ...FILL, input: { count: "number?", kind: "string" } };

    expect(commandsHash(manifestOf([reordered]))).toBe(commandsHash(manifestOf([FILL])));
  });

  it("changes with another effect", () => {
    const cheat: CommandDescriptor = { ...TAP, effect: "cheat" };

    expect(commandsHash(manifestOf([cheat]))).not.toBe(commandsHash(manifestOf([TAP])));
  });

  it("changes with another input kind", () => {
    const numeric: CommandDescriptor = { ...TAP, input: { target: "number" } };

    expect(commandsHash(manifestOf([numeric]))).not.toBe(commandsHash(manifestOf([TAP])));
  });

  it("changes when a field becomes optional", () => {
    const optional: CommandDescriptor = { ...TAP, input: { target: "string?" } };

    expect(commandsHash(manifestOf([optional]))).not.toBe(commandsHash(manifestOf([TAP])));
  });

  it("changes with another id or an added command", () => {
    const renamed: CommandDescriptor = { ...TAP, id: "game.press" };
    const tap = commandsHash(manifestOf([TAP]));

    expect(commandsHash(manifestOf([renamed]))).not.toBe(tap);
    expect(commandsHash(manifestOf([TAP, FILL]))).not.toBe(tap);
  });

  it("ignores titles", () => {
    const retitled: CommandDescriptor = { ...TAP, title: "Press a button" };

    expect(commandsHash(manifestOf([retitled]))).toBe(commandsHash(manifestOf([TAP])));
  });

  it("ignores sources, game, page and embedded", () => {
    const other: Manifest = {
      game: "timber 1.2.0",
      page: "http://127.0.0.1:4000/",
      embedded: false,
      sources: [],
      commands: [TAP]
    };

    expect(commandsHash(other)).toBe(commandsHash(manifestOf([TAP])));
  });
});
