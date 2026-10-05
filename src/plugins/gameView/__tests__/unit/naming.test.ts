/* eslint-disable unicorn/no-null -- null is a JSON value */
import { describe, expect, it } from "vitest";
import {
  capturePath,
  cardFolder,
  cardPath,
  dayFolder,
  deviceLabel,
  folderOf,
  imageExtension,
  nodeOf,
  pickPaths,
  plannedShots,
  positionOf,
  seriesFolder,
  shotName,
  stamp,
  takenPaths
} from "../../capture/naming";

const DAY = ".moku/captures/2026-10-05";

describe("stamp and dayFolder", () => {
  it("stamp prints the local hour and minute as hhmm", () => {
    expect(stamp(new Date(2026, 9, 5, 8, 46, 59))).toBe("0846");
    expect(stamp(new Date(2026, 0, 2, 13, 4))).toBe("1304");
  });

  it("dayFolder is <capturesDir>/<yyyy-mm-dd> of the local date", () => {
    expect(dayFolder(".moku/captures", new Date(2026, 9, 5, 8, 46))).toBe(DAY);
    expect(dayFolder(".moku/captures/shots", new Date(2026, 0, 2, 23, 59))).toBe(
      ".moku/captures/shots/2026-01-02"
    );
  });

  it("dayFolder and stamp read the same local clock", () => {
    const now = new Date(2026, 9, 5, 0, 0);
    expect(`${dayFolder(".moku/captures", now)}/${stamp(now)}`).toBe(`${DAY}/0000`);
  });
});

describe("cardFolder", () => {
  it("is the folder of the pick's full frame, so the card's links find its pictures", () => {
    expect(
      cardFolder(".moku/captures", ".moku/captures/2026-10-04/f12-full.jpg", new Date(2026, 9, 5))
    ).toBe(".moku/captures/2026-10-04");
    expect(cardFolder(".moku/captures", ".moku/captures/f12-full.jpg", new Date(2026, 9, 5))).toBe(
      ".moku/captures"
    );
  });

  it("is the day folder without a full frame", () => {
    expect(cardFolder(".moku/captures", undefined, new Date(2026, 9, 5, 8, 46))).toBe(DAY);
  });
});

describe("capturePath in a day folder", () => {
  it("names the shot <hhmm>-<node> inside the day, without the date", () => {
    expect(capturePath(DAY, "0846", "board", new Set())).toBe(`${DAY}/0846-board.png`);
  });

  it("appends -2, -3 … when the minute and node are taken in that day", () => {
    const taken = new Set([`${DAY}/0846-board.png`, `${DAY}/0846-board-2.png`]);
    expect(capturePath(DAY, "0846", "board", taken)).toBe(`${DAY}/0846-board-3.png`);
  });

  it("does not count a name taken in another day", () => {
    const taken = new Set([".moku/captures/2026-10-04/0846-board.jpg"]);
    expect(capturePath(DAY, "0846", "board", taken, "jpg")).toBe(`${DAY}/0846-board.jpg`);
  });

  it("keeps the name to letters, digits, - and _", () => {
    expect(capturePath(DAY, "0846", "board/merge it", new Set())).toBe(
      `${DAY}/0846-board-merge-it.png`
    );
  });
});

describe("capturePath with the extension of the picture (D-34)", () => {
  it("names a JPEG shot .jpg and keeps the -2 rule per extension", () => {
    expect(capturePath(DAY, "0846", "board", new Set(), "jpg")).toBe(`${DAY}/0846-board.jpg`);
    const taken = new Set([`${DAY}/0846-board.jpg`]);
    expect(capturePath(DAY, "0846", "board", taken, "jpg")).toBe(`${DAY}/0846-board-2.jpg`);
  });
});

describe("imageExtension", () => {
  it("is jpg for a JPEG data URL and the subtype for the others", () => {
    expect(imageExtension("data:image/jpeg;base64,/9j/")).toBe("jpg");
    expect(imageExtension("data:image/png;base64,iVBOR")).toBe("png");
    expect(imageExtension("data:image/webp;base64,UklG")).toBe("webp");
  });

  it("is png for anything that is no image data URL", () => {
    expect(imageExtension("")).toBe("png");
    expect(imageExtension("data:text/plain,hi")).toBe("png");
  });
});

describe("pickPaths (A19)", () => {
  it("names the crop <name>-f<frame>-crop and the full frame f<frame>-full, with the picture's extension", () => {
    expect(pickPaths(DAY, "settingsBoard", 1841, new Set(), { crop: "jpg", full: "jpg" })).toEqual({
      crop: `${DAY}/settingsBoard-f1841-crop.jpg`,
      full: `${DAY}/f1841-full.jpg`
    });
    expect(pickPaths(DAY, "board.items/3", 7, new Set(), { crop: "jpg", full: "png" })).toEqual({
      crop: `${DAY}/board-items-3-f7-crop.jpg`,
      full: `${DAY}/f7-full.png`
    });
  });

  it("appends -2 before the suffix when a file is taken", () => {
    const taken = new Set([
      `${DAY}/area-f25-crop.jpg`,
      `${DAY}/f25-full.jpg`,
      `${DAY}/f25-2-full.jpg`
    ]);
    expect(pickPaths(DAY, "area", 25, taken, { crop: "jpg", full: "jpg" })).toEqual({
      crop: `${DAY}/area-f25-2-crop.jpg`,
      full: `${DAY}/f25-3-full.jpg`
    });
  });
});

describe("cardPath (round 2b R13)", () => {
  it("is <dir>/<name>-f<frame>.md, -2 when taken, unsafe characters as -", () => {
    expect(cardPath(DAY, "settingsBoard", 25, new Set())).toBe(`${DAY}/settingsBoard-f25.md`);
    expect(cardPath(DAY, "settingsBoard", 25, new Set([`${DAY}/settingsBoard-f25.md`]))).toBe(
      `${DAY}/settingsBoard-f25-2.md`
    );
    expect(cardPath(DAY, "board.items/3", 7, new Set())).toBe(`${DAY}/board-items-3-f7.md`);
  });
});

describe("seriesFolder", () => {
  it("is series-<hhmm>/ inside the day, with a trailing slash, -2 on a collision", () => {
    expect(seriesFolder(DAY, "1015", new Set())).toBe(`${DAY}/series-1015/`);
    expect(seriesFolder(DAY, "1015", new Set([`${DAY}/series-1015`]))).toBe(
      `${DAY}/series-1015-2/`
    );
  });
});

describe("shotName", () => {
  it("zero-pads to max(3, digits of the count), counting from 1", () => {
    expect(shotName(0, 4)).toBe("001.png");
    expect(shotName(19, 20)).toBe("020.png");
    expect(shotName(0, 1250)).toBe("0001.png");
  });
});

describe("positionOf and nodeOf", () => {
  it("reads path, flow and node of a game.position value", () => {
    const position = positionOf({
      path: "board/awaitIntent",
      flow: "board",
      node: "awaitIntent",
      waiting: []
    });
    expect(position).toEqual({ path: "board/awaitIntent", flow: "board", node: "awaitIntent" });
    expect(nodeOf(position)).toBe("board");
  });

  it("falls back to game without a flow", () => {
    expect(positionOf(null)).toEqual({});
    expect(positionOf({ path: 3 })).toEqual({});
    expect(nodeOf({})).toBe("game");
  });
});

describe("small helpers", () => {
  it("folderOf keeps the folder with its slash", () => {
    expect(folderOf(".moku/captures/series-2026-09-24-1015/index.json")).toBe(
      ".moku/captures/series-2026-09-24-1015/"
    );
    expect(folderOf("index.json")).toBe("");
  });

  it("plannedShots is floor(duration / interval)", () => {
    expect(plannedShots(2000, 100)).toBe(20);
    expect(plannedShots(1000, 16)).toBe(62);
    expect(plannedShots(1000, 0)).toBe(0);
  });

  it("deviceLabel and takenPaths", () => {
    expect(deviceLabel("iPhone 15", "portrait")).toBe("iPhone 15 portrait");
    expect(takenPaths([{ path: "a/b.png", kind: "file", size: 1 }])).toEqual(new Set(["a/b.png"]));
  });
});
