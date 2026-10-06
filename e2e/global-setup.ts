/**
 * @file Builds once before the workers start: the package (tsdown and the tools page bundle) and
 * the prepared tiny game in dist-e2e/game (e2e/prepare-game.ts). Every worker then copies that
 * game and starts its own bin (e2e/editor-server.ts). Old server logs are removed, so the
 * teardown scans only this run's.
 */
import { execSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { DIST } from "./editor-server";

/**
 * Builds the package and the game copy, and clears the server logs of an earlier run.
 */
export default function globalSetup(): void {
  mkdirSync(DIST, { recursive: true });
  for (const name of readdirSync(DIST)) {
    if (/^server(-\d+)?\.log$/.test(name)) rmSync(path.join(DIST, name), { force: true });
  }
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- Bun is the project's runtime (CLAUDE.md); a dev machine has it on PATH.
  execSync("bun run build && bun e2e/prepare-game.ts", { stdio: "inherit" });
}
