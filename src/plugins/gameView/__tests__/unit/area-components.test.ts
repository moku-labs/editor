import { describe, expect, it } from "vitest";
import {
  componentAt,
  DEFINITION_LINES,
  definitionLine,
  definitionRange
} from "../../reference/area-components";

// ─────────────────────────────────────────────────────────────────────────────
// Component sources of the fuller area card (captures-by-day U5), pure: the
// component a key line belongs to (`<RoundButton id="homeSettings" …>`), the
// line that defines a component, and the lines of that definition.
// ─────────────────────────────────────────────────────────────────────────────

const KIT = [
  'import { defineStyle } from "@moku-labs/game";',
  "",
  "export type RoundButtonProps = { id: string };",
  "",
  "export function RoundButton(props: RoundButtonProps) {",
  "  return (",
  "    <button key={props.id} style={styles.disc}>",
  "      {props.badge === undefined ? undefined : <text content={String(props.badge)} />}",
  "    </button>",
  "  );",
  "}",
  "",
  "export const HudPill = (props: HudPillProps) => <row key={props.id} />;",
  "const LogoSign: Component<{ id: string }> = props => {",
  "  return <column key={props.id} />;",
  "};"
].join("\n");

describe("componentAt", () => {
  it("names the component whose tag holds the key", () => {
    const lines = ['          <RoundButton id="homeSettings" intent="openSettings" />'];
    expect(componentAt(lines, 1, lines[0]?.indexOf("id=") ?? 0)).toBe("RoundButton");
  });

  it("finds a tag opened on a line above the key", () => {
    const lines = ["            <RoundButton", '              id="gift"', "            />"];
    expect(componentAt(lines, 2, 14)).toBe("RoundButton");
  });

  it("takes the nearest tag before the key on its line", () => {
    const lines = ['<row><HudPill id="homeCoins" /></row>'];
    expect(componentAt(lines, 1, 14)).toBe("HudPill");
  });

  it("is undefined for an intrinsic element or a member tag", () => {
    expect(componentAt(['<column key="giftCorner" style={giftCorner}>'], 1, 8)).toBeUndefined();
    expect(componentAt(['<Kit.Button id="ok" />'], 1, 12)).toBeUndefined();
  });
});

describe("definitionLine", () => {
  it("finds a function or a const that defines the component", () => {
    expect(definitionLine(KIT, "RoundButton")).toBe(5);
    expect(definitionLine(KIT, "HudPill")).toBe(13);
    expect(definitionLine(KIT, "LogoSign")).toBe(14);
  });

  it("does not take a longer name or a use", () => {
    expect(definitionLine(KIT, "Round")).toBeUndefined();
    expect(definitionLine("<RoundButton id='a' />", "RoundButton")).toBeUndefined();
  });
});

describe("definitionRange", () => {
  it("goes from the definition line to the brace that closes it", () => {
    expect(definitionRange(KIT.split("\n"), 5)).toEqual({ start: 5, end: 11 });
    expect(definitionRange(KIT.split("\n"), 14)).toEqual({ start: 14, end: 16 });
  });

  it("is one line for an arrow without braces, at most 60 lines for one that never closes", () => {
    expect(definitionRange(KIT.split("\n"), 13)).toEqual({ start: 13, end: 13 });
    const open = ["function Big() {", ...Array.from({ length: 80 }, () => "  a;")];
    expect(definitionRange(open, 1)).toEqual({ start: 1, end: DEFINITION_LINES });
  });
});
