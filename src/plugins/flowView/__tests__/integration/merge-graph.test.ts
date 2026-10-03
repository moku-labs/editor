import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadMergeGame } from "../../../../../tests/fixtures/merge-game";

// The fixture merge-graph.json is flow.describe() of the merge-game fixture (generated once, kept
// in the repository so CI runs the layout tests without the game). This file keeps it honest.

describe("merge-graph fixture", () => {
  it("equals flow.describe() of the merge-game fixture", async () => {
    const { createGame } = await loadMergeGame();
    const { app } = createGame();
    const game = app as unknown as { start(): Promise<void>; flow: { describe(): unknown } };
    await game.start();
    const fixture: unknown = JSON.parse(
      readFileSync(
        `${process.cwd()}/src/plugins/flowView/__tests__/fixtures/merge-graph.json`,
        "utf8"
      )
    );
    expect(structuredClone(game.flow.describe())).toEqual(fixture);
  });
});
