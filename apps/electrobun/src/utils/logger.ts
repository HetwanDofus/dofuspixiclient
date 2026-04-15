type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let minLevel: LogLevel = "debug";

export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[minLevel];
}

export function createLogger(tag: string) {
  return {
    debug(msg: string, ...args: unknown[]): void {
      if (shouldLog("debug")) {
        console.debug(`[${tag}]`, msg, ...args);
      }
    },
    info(msg: string, ...args: unknown[]): void {
      if (shouldLog("info")) {
        console.log(`[${tag}]`, msg, ...args);
      }
    },
    warn(msg: string, ...args: unknown[]): void {
      if (shouldLog("warn")) {
        console.warn(`[${tag}]`, msg, ...args);
      }
    },
    error(msg: string, ...args: unknown[]): void {
      if (shouldLog("error")) {
        console.error(`[${tag}]`, msg, ...args);
      }
    },
  };
}
