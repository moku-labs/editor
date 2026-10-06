/**
 * @file The main flow of the tiny e2e game: home → level on Play, level → score → level on a tap,
 * level → home on Back.
 */
import { defineFlow } from "./kit";
import { home, level, score } from "./nodes";

export const mainFlow = defineFlow("main", {
  nodes: { home, level, score },
  start: "home",
  edges: {
    home: { play: "level" },
    level: { tap: "score", back: "home" },
    score: { done: "level" }
  }
});
