import { describe, expect, test } from "bun:test";
import {
  parseBool01,
  parseInt10,
  parseInt16,
  parseList,
  parseOptString,
  parseStruct,
  parseTagged,
  splitPipe,
  splitSemi,
} from "../protocol/parse";

describe("splitters", () => {
  test("splitPipe handles empty input as []", () => {
    expect(splitPipe("")).toEqual([]);
  });
  test("splitPipe keeps empty middle segments", () => {
    expect(splitPipe("a||b")).toEqual(["a", "", "b"]);
  });
  test("splitSemi keeps empty middle segments", () => {
    expect(splitSemi("1;;3")).toEqual(["1", "", "3"]);
  });
});

describe("parseInt10 / parseInt16", () => {
  test("parses positive base-10", () => {
    expect(parseInt10("42")).toBe(42);
  });
  test("parses negative base-10", () => {
    expect(parseInt10("-7")).toBe(-7);
  });
  test("undefined / empty falls back", () => {
    expect(parseInt10(undefined, 99)).toBe(99);
    expect(parseInt10("", 99)).toBe(99);
  });
  test("NaN falls back", () => {
    expect(parseInt10("abc", 1)).toBe(1);
  });
  test("hex parses correctly", () => {
    expect(parseInt16("ff")).toBe(255);
    expect(parseInt16("A0")).toBe(160);
  });
});

describe("parseBool01", () => {
  test("'0' → false", () => {
    expect(parseBool01("0")).toBe(false);
  });
  test("'1' → true", () => {
    expect(parseBool01("1")).toBe(true);
  });
  test("anything non-zero → true (mirrors AS2 `!= '0'`)", () => {
    expect(parseBool01("yes")).toBe(true);
    expect(parseBool01("2")).toBe(true);
  });
  test("'' and undefined → false", () => {
    expect(parseBool01("")).toBe(false);
    expect(parseBool01(undefined)).toBe(false);
  });
});

describe("parseOptString", () => {
  test("empty string → undefined", () => {
    expect(parseOptString("")).toBeUndefined();
  });
  test("non-empty passes through", () => {
    expect(parseOptString("x")).toBe("x");
  });
});

describe("parseList", () => {
  test("empty → []", () => {
    expect(parseList("", ",", (s) => s)).toEqual([]);
  });
  test("maps each chunk", () => {
    expect(parseList("1,2,3", ",", (s) => Number(s) * 2)).toEqual([2, 4, 6]);
  });
  test("passes index to mapper", () => {
    expect(parseList("a,b,c", ",", (_s, i) => i)).toEqual([0, 1, 2]);
  });
});

describe("parseTagged", () => {
  test("splits first char from body", () => {
    expect(parseTagged("tHello")).toEqual({ tag: "t", body: "Hello" });
  });
  test("single char input → empty body", () => {
    expect(parseTagged("x")).toEqual({ tag: "x", body: "" });
  });
});

describe("parseStruct", () => {
  test("named-field assignment", () => {
    interface Row {
      a: string;
      b: string;
      c: string;
    }
    const out = parseStruct<Row>("1;2;3", ";", ["a", "b", "c"]);
    expect(out).toEqual({ a: "1", b: "2", c: "3" });
  });
  test("null skips a field", () => {
    interface Row {
      a: string;
      c: string;
    }
    const out = parseStruct<Row>("1;ignored;3", ";", ["a", null, "c"]);
    expect(out).toEqual({ a: "1", c: "3" });
  });
  test("missing trailing fields are absent (not empty string)", () => {
    interface Row {
      a: string;
      b: string;
      c: string;
    }
    const out = parseStruct<Row>("1;2", ";", ["a", "b", "c"]);
    expect(out).toEqual({ a: "1", b: "2" });
  });
});
