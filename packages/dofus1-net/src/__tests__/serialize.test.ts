import { describe, expect, test } from "bun:test";
import {
  joinComma,
  joinPipe,
  joinSemi,
} from "../protocol/serialize";

describe("join helpers", () => {
  test("joinPipe handles mixed types", () => {
    expect(joinPipe(["a", 1, true])).toBe("a|1|1");
    expect(joinPipe(["a", 1, false])).toBe("a|1|0");
  });
  test("joinSemi", () => {
    expect(joinSemi([1, 2, 3])).toBe("1;2;3");
  });
  test("joinComma with empty", () => {
    expect(joinComma([])).toBe("");
  });
  test("boolean serialization mirrors 1.29 '0'/'1' convention", () => {
    expect(joinPipe([true])).toBe("1");
    expect(joinPipe([false])).toBe("0");
  });
});
