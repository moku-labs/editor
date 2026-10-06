// The text styles and the styles of the tiny project. Read by the project index only.
import { defineStyle, defineTextStyles } from "../../kit";

export const uiStyles = defineTextStyles({
  "ui.title": { font: "ui.font-body", size: 48, fill: 0xffffff }
});

export const boardStyle = defineStyle({ width: 600, height: 400, direction: "column" });

export function cardStyle(slot: number) {
  return defineStyle({ width: 200, height: 260, margin: { left: slot * 10 } });
}
