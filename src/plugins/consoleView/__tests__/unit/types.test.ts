import { describe, expectTypeOf, it } from "vitest";
import type { ApiOf } from "../../../../config";
import type { RanEvent } from "../../../workspace/types";
import type { consoleViewPlugin } from "../..";
import type { ConsoleApi, ConsoleCtx, LevelCounts, LevelFilter, LogLine } from "../../types";

describe("consoleView types", () => {
  it("LogLine narrows on kind", () => {
    const describeLine = (line: LogLine): string => {
      if (line.kind === "meta") {
        expectTypeOf(line.text).toBeString();
        return line.text;
      }
      expectTypeOf(line.level).toEqualTypeOf<"debug" | "info" | "warn" | "error">();
      return line.message;
    };
    expectTypeOf(describeLine).returns.toBeString();
  });

  it("setFilter accepts a level of the filter and refuses debug", () => {
    expectTypeOf<ConsoleApi["setFilter"]>().toBeCallableWith({ level: "warn" });
    expectTypeOf<ConsoleApi["setFilter"]>().toBeCallableWith({ query: "texture" });
    // @ts-expect-error — debug is a log level, not a filter
    expectTypeOf<ConsoleApi["setFilter"]>().toBeCallableWith({ level: "debug" });
    expectTypeOf<LevelFilter>().toEqualTypeOf<"all" | "info" | "warn" | "error">();
  });

  it("the plugin api is ConsoleApi; counts() returns LevelCounts", () => {
    expectTypeOf<ApiOf<typeof consoleViewPlugin>>().toEqualTypeOf<ConsoleApi>();
    expectTypeOf<ReturnType<ConsoleApi["counts"]>>().toEqualTypeOf<LevelCounts>();
  });

  it("RanEvent narrows on ok", () => {
    const codeOf = (ran: RanEvent): number | undefined => {
      if (ran.ok) {
        expectTypeOf(ran.result.state.frame).toBeNumber();
        return undefined;
      }
      return ran.error.code;
    };
    expectTypeOf(codeOf).returns.toEqualTypeOf<number | undefined>();
  });

  it("emit takes workspace:focus-frame with a numeric frame only", () => {
    expectTypeOf<ConsoleCtx["emit"]>().toBeCallableWith("workspace:focus-frame", { frame: 1778 });
    // @ts-expect-error — the frame is a number
    expectTypeOf<ConsoleCtx["emit"]>().toBeCallableWith("workspace:focus-frame", { frame: "1778" });
  });
});
