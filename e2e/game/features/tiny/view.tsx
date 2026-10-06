/**
 * @file The two screens of the tiny e2e game, drawn from shapes and the shipped body font only.
 * Home: a full-bleed background, the logo text and the Play button. Level: a background, a panel
 * with the title and the score, and the Tap and Back buttons. Every element is keyed, so the
 * editor can locate, pick and reference it.
 */
import { defineStyle, projection } from "../../kit";
import type { Player } from "../../state";

/** Night blue: the background of both screens. */
const night = 0x1b_26_3b;

/** Slate: the panel of the level. */
const slate = 0x2e_3d_57;

/** Green: the primary button. */
const green = 0x2f_9e_5b;

/** Berry: the way back. */
const berry = 0x9e_2f_4a;

/** The root of a screen: the whole device, children centred. */
const screenStyle = defineStyle({
  width: "100%",
  height: "100%",
  direction: "column",
  justify: "center",
  align: "center"
});

/** A full-bleed background behind everything else. */
const fullBleed = defineStyle({
  position: "absolute",
  left: 0,
  top: 0,
  width: "100%",
  height: "100%",
  fill: night,
  reason: "the background covers the whole screen, the safe area included"
});

/** The centre column of a screen. */
const centre = defineStyle({ direction: "column", align: "center", gap: 48 });

/** The level panel: the title over the score. */
const card = defineStyle({
  direction: "column",
  align: "center",
  gap: 24,
  padding: 64,
  width: 720,
  fill: slate,
  radius: 32
});

/** The row of the level buttons. */
const buttonRow = defineStyle({ direction: "row", gap: 32 });

/** A button: a rounded plate around its label. */
const button = defineStyle({
  width: 320,
  height: 128,
  justify: "center",
  align: "center",
  fill: green,
  radius: 24,
  is: { pressed: { alpha: 0.8 } }
});

/** The Back button: the button in berry. */
const backButton = defineStyle({ ...button, fill: berry });

/** Home as the view reads it: the player's name. */
type HomeView = { name: string };

/** The level as the view reads it: the score. */
type LevelView = { score: number };

/** The Home screen: one item, so the projection needs no key. */
export const homeScreen = projection({
  name: "home.screen",
  layer: "ui",
  from: (player: Player): HomeView => ({ name: player.name }),
  view: item => (
    <screen key="homeScreen" style={screenStyle}>
      <panel key="homeBackground" style={fullBleed} />
      <column key="homeCentre" style={centre}>
        <text key="homeLogo" style="tiny.title" content={`${item.name} Game`} />
        <button key="play" intent="play" style={button}>
          <text key="playLabel" style="tiny.button" content="Play" />
        </button>
      </column>
    </screen>
  )
});

/** The level screen: the score panel and its two buttons. */
export const levelScreen = projection({
  name: "level.screen",
  layer: "ui",
  from: (player: Player): LevelView => ({ score: player.score }),
  view: item => (
    <screen key="levelScreen" style={screenStyle}>
      <panel key="levelBackground" style={fullBleed} />
      <column key="levelCentre" style={centre}>
        <panel key="levelPanel" style={card}>
          <text key="levelTitle" style="tiny.title" content="Level" />
          <text key="levelScore" style="tiny.score" content={`Score ${item.score}`} />
        </panel>
        <row key="levelButtons" style={buttonRow}>
          <button key="tap" intent="tap" style={button}>
            <text key="tapLabel" style="tiny.button" content="Tap" />
          </button>
          <button key="back" intent="back" style={backButton}>
            <text key="backLabel" style="tiny.button" content="Back" />
          </button>
        </row>
      </column>
    </screen>
  )
});
