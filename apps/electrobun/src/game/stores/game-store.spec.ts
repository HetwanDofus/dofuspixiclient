import { describe, expect, it, mock } from "bun:test";

import { ExternalStore } from "./game-store";

interface Counter {
  value: number;
  label: string;
}

describe("ExternalStore", () => {
  it("getSnapshot returns the current state reference", () => {
    const s = new ExternalStore<Counter>({ value: 0, label: "a" });
    expect(s.getSnapshot()).toEqual({ value: 0, label: "a" });
  });

  it("setState merges partial state and keeps untouched fields", () => {
    const s = new ExternalStore<Counter>({ value: 0, label: "a" });
    s.setState({ value: 5 });
    expect(s.getSnapshot()).toEqual({ value: 5, label: "a" });
  });

  it("setState produces a new object reference (for React)", () => {
    const s = new ExternalStore<Counter>({ value: 0, label: "a" });
    const before = s.getSnapshot();
    s.setState({ value: 1 });
    const after = s.getSnapshot();
    expect(after).not.toBe(before);
  });

  it("replaceState swaps the whole state", () => {
    const s = new ExternalStore<Counter>({ value: 0, label: "a" });
    s.replaceState({ value: 99, label: "b" });
    expect(s.getSnapshot()).toEqual({ value: 99, label: "b" });
  });

  it("notifies subscribers on every setState", () => {
    const s = new ExternalStore<Counter>({ value: 0, label: "a" });
    const listener = mock(() => {});
    s.subscribe(listener);

    s.setState({ value: 1 });
    s.setState({ value: 2 });
    s.setState({ label: "b" });

    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("unsubscribe stops notifications", () => {
    const s = new ExternalStore<Counter>({ value: 0, label: "a" });
    const listener = mock(() => {});
    const unsubscribe = s.subscribe(listener);

    s.setState({ value: 1 });
    unsubscribe();
    s.setState({ value: 2 });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("multiple subscribers all fire", () => {
    const s = new ExternalStore<Counter>({ value: 0, label: "a" });
    const l1 = mock(() => {});
    const l2 = mock(() => {});
    s.subscribe(l1);
    s.subscribe(l2);

    s.setState({ value: 1 });

    expect(l1).toHaveBeenCalledTimes(1);
    expect(l2).toHaveBeenCalledTimes(1);
  });
});
