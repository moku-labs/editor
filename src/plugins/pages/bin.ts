#!/usr/bin/env bun
/**
 * @file The moku-editor bin: serves a game page with the editor mounted. Bun only.
 */
import { main } from "./cli";

process.exitCode = await main(Bun.argv.slice(2));
