export type LogEntry = {
  level: number;
  time: number;
  msg: string;
  mod?: string;
  [key: string]: unknown;
};

export type Unsubscribe = () => void;

// In-memory ring buffer of recent log entries with a pub/sub subscribe API.
// Pino writes NDJSON to `.write(...)`; we parse it and broadcast each entry.
export class LogSink {
  private readonly buffer: LogEntry[] = [];
  private readonly listeners = new Set<(entry: LogEntry) => void>();

  constructor(private readonly capacity = 200) {}

  readonly write = (chunk: string | Uint8Array): void => {
    const text =
      typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);

    for (const line of text.split("\n")) {
      const trimmed = line.trim();

      if (trimmed.length === 0) {
        continue;
      }

      try {
        this.push(JSON.parse(trimmed) as LogEntry);
      } catch {
        // Non-JSON line — skip silently; pino should always emit JSON.
      }
    }
  };

  subscribe(fn: (entry: LogEntry) => void): Unsubscribe {
    this.listeners.add(fn);

    return () => {
      this.listeners.delete(fn);
    };
  }

  recent(n: number): LogEntry[] {
    return this.buffer.slice(-n);
  }

  private push(entry: LogEntry): void {
    this.buffer.push(entry);

    if (this.buffer.length > this.capacity) {
      this.buffer.shift();
    }

    for (const fn of this.listeners) {
      fn(entry);
    }
  }
}

export const logSink = new LogSink();
