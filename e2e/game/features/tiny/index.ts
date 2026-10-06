/**
 * @file The one feature of the tiny e2e game: its bundle (the body font), its two scenes, its two
 * screens and its text styles.
 */
import { defineBundles, defineFeature, defineScene, defineTextStyles } from "../../kit";
import { homeScreen, levelScreen } from "./view";

/** White: the words on the night background. */
const white = 0xff_ff_ff;

/** Gold: the score. */
const gold = 0xff_d5_4f;

/** The text styles of the screens; sizes are reference units at the 1080 short side. */
const textStyles = defineTextStyles({
  "tiny.title": { font: "tiny.font-body", size: 96, fill: white, align: "center" },
  "tiny.button": { font: "tiny.font-body", size: 56, fill: white, align: "center" },
  "tiny.score": { font: "tiny.font-body", size: 64, fill: gold, align: "center", digits: true }
});

/** The scene of the `home` node. */
const homeScene = defineScene("home", {
  bundle: "tiny",
  layers: {},
  projections: [homeScreen]
});

/** The scene of the `level` node. */
const levelScene = defineScene("level", {
  bundle: "tiny",
  layers: {},
  projections: [levelScreen]
});

export const tinyFeature = defineFeature("tiny", {
  scenes: [homeScene, levelScene],
  projections: [homeScreen, levelScreen],
  assets: defineBundles({ tiny: { tier: "boot" } }),
  textStyles
});
