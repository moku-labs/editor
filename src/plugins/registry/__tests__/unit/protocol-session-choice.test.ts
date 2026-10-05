import { describe, expect, it } from "vitest";
import { pickSession } from "../../protocol";

// ─────────────────────────────────────────────────────────────────────────────
// pickSession: the one session rule of the hub and the MCP bridge. The asked
// id, else the only session, else the one embedded session.
// ─────────────────────────────────────────────────────────────────────────────

/** A plain game page. */
const PAGE = { id: "s-1", embedded: false, game: "merge-game" };

/** The game embedded in the tools page. */
const PANE = { id: "s-2", embedded: true, game: "merge-game" };

/** A second plain game page. */
const OTHER = { id: "s-3", embedded: false, game: "timber" };

describe("pickSession", () => {
  it("returns the asked session, embedded or not", () => {
    expect(pickSession([PAGE, PANE], "s-1")).toBe(PAGE);
    expect(pickSession([PAGE, PANE], "s-2")).toBe(PANE);
  });

  it("returns undefined for an unknown asked id, even with one session open", () => {
    expect(pickSession([PAGE], "s-9")).toBeUndefined();
  });

  it("returns the only session", () => {
    expect(pickSession([PAGE])).toBe(PAGE);
  });

  it("returns the one embedded session among several", () => {
    expect(pickSession([PAGE, PANE, OTHER])).toBe(PANE);
  });

  it("returns undefined for no session, no embedded one or several embedded ones", () => {
    expect(pickSession([])).toBeUndefined();
    expect(pickSession([PAGE, OTHER])).toBeUndefined();
    expect(pickSession([PANE, { ...PAGE, embedded: true }])).toBeUndefined();
  });

  it("keeps the caller's own session type", () => {
    const picked = pickSession([PAGE, PANE]);

    expect(picked?.game).toBe("merge-game");
  });
});
