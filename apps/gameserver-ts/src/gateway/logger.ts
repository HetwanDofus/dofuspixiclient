import { createWriteStream } from "node:fs";

import pino from "pino";

import { logSink } from "./log-sink.ts";

const isDev = process.env.NODE_ENV !== "production";
const interactive = process.stdin.isTTY && !process.env.GATEWAY_LOG_STDOUT;

export const GATEWAY_LOG_PATH = interactive
  ? (process.env.GATEWAY_LOG_FILE ?? "/tmp/dofus-gateway.log")
  : null;

// Streams:
//  - in-memory sink: always on; Ink UI reads from here.
//  - stdout (dev, non-TTY): pretty. Prod non-TTY: raw JSON.
//  - file (TTY only): raw JSON; `cat $file | pino-pretty` for human reads.
const streams: pino.StreamEntry[] = [{ stream: { write: logSink.write } }];

if (GATEWAY_LOG_PATH) {
  streams.push({
    stream: createWriteStream(GATEWAY_LOG_PATH, { flags: "a" }),
  });
} else if (isDev) {
  streams.push({
    stream: pino.transport({
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "HH:MM:ss.l",
        ignore: "pid,hostname",
      },
    }),
  });
} else {
  streams.push({ stream: process.stdout });
}

export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? (isDev ? "debug" : "info"),
    base: { component: "gateway" },
  },
  pino.multistream(streams)
);
