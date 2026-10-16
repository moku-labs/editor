/**
 * @file A fake adb for the collector's wired-telemetry integration test, run by a small shell
 * wrapper as `bun fake-adb.ts <adb args…>`. It answers connect's commands with the A26's fixtures
 * (copied under `fixtures/adb`, the shapes of spec 11 § 3 Testing): one phone by USB, no WebView
 * devtools socket, GPU nodes under `/sys/kernel/gpu`. CPU counters grow with the clock, so two
 * ticks a second apart give a share.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);

/**
 * The text of an adb fixture.
 *
 * @param name - The file under fixtures/adb.
 * @returns Its text.
 */
function fixture(name: string): string {
  return readFileSync(path.join(import.meta.dirname, "adb", name), "utf8");
}

/** Clock ticks (10 ms) since the epoch: the counters of /proc. */
const TICKS = Math.floor(Date.now() / 10);

/**
 * A `/proc/<pid>/stat` line whose utime grows by `share` of a core.
 *
 * @param pid - The pid.
 * @param start - Field 22.
 * @param share - The share of one core it uses.
 * @returns The line.
 */
function stat(pid: number, start: number, share: number): string {
  return `${pid} (p ${pid}) S 1 1 0 0 -1 0 0 0 0 0 ${Math.floor(TICKS * share)} 0 0 0 10 0 8 0 ${start} 0 0`;
}

/** First lines of the files `head -n 1` can read on the fake A26. */
const FILES: Readonly<Record<string, string>> = {
  "/proc/stat": `cpu  ${TICKS * 8} 0 0 0 0 0 0 0 0 0`,
  "/proc/612/stat": stat(612, 900, 0.25),
  "/sys/kernel/gpu/gpu_clock": "221",
  "/sys/kernel/gpu/gpu_busy": "63 %",
  "/sys/kernel/gpu/gpu_min_clock": "221",
  "/sys/kernel/gpu/gpu_max_clock": "949"
};

/**
 * What `head -n <n> <paths…>` prints.
 *
 * @param lines - n.
 * @param paths - The files.
 * @returns The output.
 */
function head(lines: string, paths: readonly string[]): string {
  if (lines === "64") return fixture("proc-stat-64.txt");
  return paths
    .filter(file => FILES[file] !== undefined)
    .map(file => `==> ${file} <==\n${FILES[file] ?? ""}\n`)
    .join("\n");
}

/**
 * What a shell command prints on the phone.
 *
 * @param words - The command's words.
 * @returns The output.
 */
function shell(words: readonly string[]): string {
  const [command = "", ...rest] = words;
  if (command === "getprop") {
    return rest[0] === "ro.product.model" ? "SM-A266B\n" : fixture("getprop-a26.txt");
  }
  if (command === "cat") return fixture("proc-net-unix.txt");
  if (command === "ps") return fixture("ps-a26.txt");
  if (command === "head") return head(rest[1] ?? "1", rest.slice(2));
  if (command === "ls") return fixture("devfreq-ls.txt");
  return "";
}

/**
 * What adb prints for its argv.
 *
 * @param argv - The adb args.
 * @returns The output.
 */
function answer(argv: readonly string[]): string {
  if (argv[0] === "version") return "Android Debug Bridge version 1.0.41\n";
  if (argv[0] === "devices") return fixture("devices-l.txt");
  return argv[2] === "shell" ? shell(argv.slice(3)) : "";
}

process.stdout.write(answer(args));
