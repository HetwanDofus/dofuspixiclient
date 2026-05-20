import { describe, expect, test } from "bun:test";
import { encodeFrame, FrameReader, FRAME_TERMINATOR } from "../transport/framing";

describe("FrameReader", () => {
  test("emits a single complete frame", () => {
    const r = new FrameReader();
    expect(r.push(`HC abc${FRAME_TERMINATOR}`)).toEqual(["HC abc"]);
  });

  test("emits multiple frames from one chunk", () => {
    const r = new FrameReader();
    const chunk = `HC abc${FRAME_TERMINATOR}HT xyz${FRAME_TERMINATOR}`;
    expect(r.push(chunk)).toEqual(["HC abc", "HT xyz"]);
  });

  test("buffers a partial trailer across chunks", () => {
    const r = new FrameReader();
    expect(r.push("HC a")).toEqual([]);
    expect(r.push(`bc${FRAME_TERMINATOR}HT x`)).toEqual(["HC abc"]);
    expect(r.push(`yz${FRAME_TERMINATOR}`)).toEqual(["HT xyz"]);
  });

  test("ignores empty frames (back-to-back terminators)", () => {
    const r = new FrameReader();
    expect(r.push(`${FRAME_TERMINATOR}HC x${FRAME_TERMINATOR}${FRAME_TERMINATOR}`)).toEqual(["HC x"]);
  });

  test("reset clears partial buffer", () => {
    const r = new FrameReader();
    r.push("partial");
    r.reset();
    expect(r.push(`HC x${FRAME_TERMINATOR}`)).toEqual(["HC x"]);
  });
});

describe("encodeFrame", () => {
  test("appends canonical outbound terminator (\\n\\x00)", () => {
    expect(encodeFrame("HC x")).toBe(`HC x\n${FRAME_TERMINATOR}`);
  });
});
