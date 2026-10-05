import { describe, expect, expectTypeOf, it } from "vitest";
import { DEFAULT_MANIFEST_PATHS } from "../../shared/manifest-paths";

// ─────────────────────────────────────────────────────────────────────────────
// manifest-paths.ts: the one default list of where a game's asset manifest may
// live, shared by the gameView and renderView configs.
// ─────────────────────────────────────────────────────────────────────────────

describe("DEFAULT_MANIFEST_PATHS", () => {
  it("lists the root, public/ and web/ manifests in the order they are tried", () => {
    expect(DEFAULT_MANIFEST_PATHS).toEqual([
      "manifest.json",
      "public/manifest.json",
      "web/manifest.json"
    ]);
    expectTypeOf(DEFAULT_MANIFEST_PATHS).toEqualTypeOf<readonly string[]>();
  });

  it("is frozen, so the two configs that share it cannot change it for each other", () => {
    expect(Object.isFrozen(DEFAULT_MANIFEST_PATHS)).toBe(true);
  });
});
