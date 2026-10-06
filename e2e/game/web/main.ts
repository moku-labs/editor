/**
 * @file The tiny e2e game page: the nine screen plugins and the game's one feature, a WebGL canvas
 * in `#game` and the manifest at `/manifest.json`, which the bin serves from the game root. The
 * page publishes the app as `globalThis.game`, the handle the editor agent and the specs use.
 */
import "./dev";
import { createApp, screen } from "@moku-labs/game";
import { tinyFeature } from "../features/tiny";
import { mainFlow } from "../flow";
import { startingPlayer, startingSession } from "../state";

const app = createApp({
  plugins: [...screen, tinyFeature],
  pluginConfigs: {
    renderer: { mount: "#game", preference: "webgl" },
    assets: { manifest: "/manifest.json" },
    text: { fonts: { body: "tiny.font-body", digits: "tiny.font-body" } },
    model: { initialPlayer: startingPlayer, initialSession: startingSession, seed: 7 },
    flow: { mainFlow, safeNode: "home" }
  },
  onStart: ctx => {
    ctx.flow.run().catch((error: unknown) => {
      ctx.log.error(
        "tiny-game: the graph stopped",
        undefined,
        error instanceof Error ? error : new Error(String(error))
      );
    });
  }
});

Reflect.set(globalThis, "game", app);

await app.start();
