// @vitest-environment happy-dom
// The editor's page loads `preact/compat` (flowView's NodeCard imports it). Compat turns the
// `onChange` of a text or number input into a listener of `input`, and `onBlur` into one of
// `focusout`. The gestures of a Styles field (U8) are pinned here with compat loaded, as in the
// page; ui-element.test.tsx pins them without it.
import "preact/compat";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stopGameView } from "../../lifecycle";
import { notify } from "../../state";
import { ElementTab } from "../../ui/ElementTab";
import { createCtx, type TestCtx } from "../helpers";
import {
  blurField,
  boardCaptureStyled,
  boardScene,
  button,
  click,
  find,
  fire,
  type Mounted,
  mount,
  pressKey,
  sceneOf,
  settle,
  typeInto
} from "../ui";

const COIN = { kind: "ui", path: "boardScreen/hudRow/coinPill" } as const;
const WIDTH_EDIT = [{ path: "width", from: 290, to: 320 }];

let ctx: TestCtx;
let view: Mounted;

/**
 * Selects the coin pill and lets the tab settle.
 */
async function selectCoin(): Promise<void> {
  act(() => {
    ctx.state.selected = COIN;
    notify(ctx.state);
  });
  await settle();
}

beforeEach(async () => {
  ctx = createCtx();
  ctx.state.scene = boardScene();
  view = mount(<ElementTab ctx={ctx} />);
  await selectCoin();
});

afterEach(() => {
  view.unmount();
  stopGameView(ctx);
  document.body.innerHTML = "";
});

/**
 * A control of the Styles section, by its style path.
 *
 * @param path - The style path ("width", "justify").
 * @returns The input or the select.
 */
function control<T extends HTMLInputElement | HTMLSelectElement = HTMLInputElement>(
  path: string
): T {
  return find<T>(view.root, `section[data-part='style'] [aria-label='${path}']`);
}

/**
 * Clicks "Clear" in the edits bar.
 */
function clear(): void {
  click(button(find(view.root, "section[data-part='style'] [data-part='edits']"), "Clear"));
}

describe("Styles fields with preact/compat loaded, as in the page (U8)", () => {
  it("typing records no edit; Enter commits it once", () => {
    for (const typed of ["3", "32", "320"]) typeInto(control("width"), typed);
    typeInto(control("nineSlice"), "ui.hud-pill-gold");
    expect(ctx.state.edits.size).toBe(0);
    expect(control("width").value).toBe("320");

    pressKey(control("width"), "Enter");
    expect(ctx.state.edits.get("coinPill")?.edits).toEqual(WIDTH_EDIT);
    expect(control("width").value).toBe("320");

    // The edit goes; the blur after the Enter has no draft left to bring it back.
    act(() => {
      ctx.state.edits.clear();
      notify(ctx.state);
    });
    blurField(control("width"));
    expect(ctx.state.edits.size).toBe(0);
  });

  it("blur commits what was typed, once", () => {
    typeInto(control("width"), "320");
    blurField(control("width"));
    expect(ctx.state.edits.get("coinPill")?.edits).toEqual(WIDTH_EDIT);
    expect(control("width").value).toBe("320");

    clear();
    blurField(control("width"));
    expect(ctx.state.edits.size).toBe(0);
  });

  it("Esc then blur commits nothing: the field shows the scene value", () => {
    typeInto(control("width"), "999");
    pressKey(control("width"), "Escape");
    expect(control("width").value).toBe("290");
    blurField(control("width"));
    expect(ctx.state.edits.size).toBe(0);
    expect(control("width").value).toBe("290");
  });

  it("an empty number field commits nothing and shows its value again", () => {
    typeInto(control("width"), "");
    expect(control("width").value).toBe("");
    pressKey(control("width"), "Enter");
    expect(ctx.state.edits.size).toBe(0);
    expect(control("width").value).toBe("290");
  });

  it("Clear puts the scene value back in the field", () => {
    typeInto(control("width"), "320");
    pressKey(control("width"), "Enter");
    expect(control("width").value).toBe("320");

    clear();
    expect(ctx.state.edits.size).toBe(0);
    expect(control("width").value).toBe("290");
  });

  it("a select and a checkbox still commit on `change`", async () => {
    const justify = control<HTMLSelectElement>("justify");
    act(() => {
      justify.value = "start";
      justify.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(ctx.state.edits.get("coinPill")?.edits).toEqual([
      { path: "justify", from: "center", to: "start" }
    ]);

    act(() => {
      ctx.state.edits.clear();
      ctx.state.scene = sceneOf(boardCaptureStyled("coinPill", { wrap: true }));
    });
    await selectCoin();
    const wrap = control("wrap");
    wrap.checked = false;
    fire(wrap, new Event("change", { bubbles: true }));
    expect(ctx.state.edits.get("coinPill")?.edits).toEqual([
      { path: "wrap", from: true, to: false }
    ]);
  });
});
