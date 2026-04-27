import pino from "pino";

export const logger = pino({
  name: "asset-pipeline",
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
      ignore: "pid,hostname",
      translateTime: "HH:MM:ss",
    },
  },
});
