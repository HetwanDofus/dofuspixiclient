import type { ConsoleLogLevel, ConsoleSize } from "@/components/ui/console";

import { ExternalStore } from "./game-store";

export type { ConsoleLogLevel, ConsoleSize };

export interface ConsoleLog {
  id: number;
  text: string;
  level: ConsoleLogLevel;
}

export interface ConsoleState {
  isOpen: boolean;
  size: ConsoleSize;
  logs: ConsoleLog[];
  prompt: string;
}

const initialState: ConsoleState = {
  isOpen: false,
  size: "medium",
  logs: [],
  prompt: "debug",
};

export const consoleStore = new ExternalStore<ConsoleState>(initialState);

let nextLogId = 1;
function makeLog(text: string, level: ConsoleLogLevel): ConsoleLog {
  return { id: nextLogId++, text, level };
}

const MAX_LOGS = 500;

export function appendConsoleLog(
  text: string,
  level: ConsoleLogLevel = "default"
): void {
  const { logs } = consoleStore.getSnapshot();
  const next = [...logs, makeLog(text, level)];
  consoleStore.setState({
    logs: next.length > MAX_LOGS ? next.slice(-MAX_LOGS) : next,
  });
}

export function clearConsoleLogs(): void {
  consoleStore.setState({ logs: [] });
}

export function openConsole(): void {
  consoleStore.setState({ isOpen: true });
}

export function closeConsole(): void {
  consoleStore.setState({ isOpen: false });
}

export function setConsoleSize(size: ConsoleSize): void {
  consoleStore.setState({ size });
}

const SIZE_ORDER: readonly ConsoleSize[] = ["medium", "minimized", "max"];

export function cycleConsoleSize(): void {
  const { size } = consoleStore.getSnapshot();
  const idx = SIZE_ORDER.indexOf(size);
  const next = SIZE_ORDER[(idx + 1) % SIZE_ORDER.length];
  if (next) {
    consoleStore.setState({ size: next });
  }
}

const HISTORY_LIMIT = 50;
const history: string[] = [];
let historyIdx = 0;

export function pushConsoleHistory(cmd: string): void {
  const trimmed = cmd.trim();
  if (!trimmed) {
    return;
  }
  if (history[history.length - 1] !== trimmed) {
    history.push(trimmed);
    if (history.length > HISTORY_LIMIT) {
      history.shift();
    }
  }
  historyIdx = history.length;
}

export function consoleHistoryUp(): string | undefined {
  if (history.length === 0) {
    return undefined;
  }
  historyIdx = Math.max(0, historyIdx - 1);
  return history[historyIdx];
}

export function consoleHistoryDown(): string {
  if (history.length === 0) {
    return "";
  }
  historyIdx = Math.min(history.length, historyIdx + 1);
  return history[historyIdx] ?? "";
}
