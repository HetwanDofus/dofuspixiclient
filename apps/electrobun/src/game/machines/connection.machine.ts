import { assign, setup } from "xstate";

export interface ConnectionContext {
  url: string;
  reconnectInterval: number;
  maxReconnectAttempts: number;
  reconnectAttempts: number;
  lastError: Error | null;
  lastCloseCode: number | null;
  lastCloseReason: string | null;
}

export type ConnectionEvent =
  | { type: "CONNECT" }
  | { type: "SOCKET_OPEN" }
  | { type: "SOCKET_CLOSE"; code: number; reason: string }
  | { type: "SOCKET_ERROR"; error: Error }
  | { type: "DISCONNECT" }
  | { type: "RECONNECT_TIMER" };

export interface ConnectionMachineInput {
  url: string;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

/**
 * Connection lifecycle:
 *
 *   idle ──CONNECT──> connecting ──SOCKET_OPEN──> connected
 *                        │                          │
 *                        │ SOCKET_CLOSE/ERROR       │ SOCKET_CLOSE(!=1000)
 *                        ▼                          ▼
 *                     reconnecting <───────── reconnecting
 *                        │
 *                        │ RECONNECT_TIMER
 *                        ▼
 *                     connecting
 *
 *   SOCKET_CLOSE(code=1000) or DISCONNECT → disconnected (terminal for this cycle)
 *   reconnectAttempts >= max → failed
 *
 * External world:
 *   - Connection class sends events into this actor
 *   - Actor emits side-effect requests via onEntry actions the caller observes
 *   - HUD subscribes via useSelector(actor, (s) => s.matches(...))
 */
export const connectionMachine = setup({
  types: {
    context: {} as ConnectionContext,
    events: {} as ConnectionEvent,
    input: {} as ConnectionMachineInput,
  },
  guards: {
    cleanClose: ({ event }) =>
      event.type === "SOCKET_CLOSE" && event.code === 1000,
    canRetry: ({ context }) =>
      context.reconnectAttempts < context.maxReconnectAttempts,
  },
  actions: {
    incrementAttempts: assign({
      reconnectAttempts: ({ context }) => context.reconnectAttempts + 1,
    }),
    resetAttempts: assign({ reconnectAttempts: 0 }),
    recordClose: assign({
      lastCloseCode: ({ event }) =>
        event.type === "SOCKET_CLOSE" ? event.code : null,
      lastCloseReason: ({ event }) =>
        event.type === "SOCKET_CLOSE" ? event.reason : null,
    }),
    recordError: assign({
      lastError: ({ event }) =>
        event.type === "SOCKET_ERROR" ? event.error : null,
    }),
  },
  delays: {
    reconnectDelay: ({ context }) => context.reconnectInterval,
  },
}).createMachine({
  id: "connection",
  initial: "idle",
  context: ({ input }) => ({
    url: input.url,
    reconnectInterval: input.reconnectInterval ?? 3000,
    maxReconnectAttempts: input.maxReconnectAttempts ?? 5,
    reconnectAttempts: 0,
    lastError: null,
    lastCloseCode: null,
    lastCloseReason: null,
  }),
  states: {
    idle: {
      on: {
        CONNECT: { target: "connecting" },
      },
    },
    connecting: {
      on: {
        SOCKET_OPEN: { target: "connected", actions: "resetAttempts" },
        SOCKET_CLOSE: [
          {
            guard: "cleanClose",
            target: "disconnected",
            actions: "recordClose",
          },
          { target: "evaluateRetry", actions: "recordClose" },
        ],
        SOCKET_ERROR: {
          target: "evaluateRetry",
          actions: "recordError",
        },
        DISCONNECT: { target: "disconnected" },
      },
    },
    connected: {
      on: {
        SOCKET_CLOSE: [
          {
            guard: "cleanClose",
            target: "disconnected",
            actions: "recordClose",
          },
          { target: "evaluateRetry", actions: "recordClose" },
        ],
        SOCKET_ERROR: { actions: "recordError" },
        DISCONNECT: { target: "disconnected" },
      },
    },
    evaluateRetry: {
      always: [
        { guard: "canRetry", target: "reconnecting" },
        { target: "failed" },
      ],
    },
    reconnecting: {
      entry: "incrementAttempts",
      after: {
        reconnectDelay: { target: "connecting" },
      },
      on: {
        DISCONNECT: { target: "disconnected" },
      },
    },
    disconnected: {
      on: {
        CONNECT: { target: "connecting", actions: "resetAttempts" },
      },
    },
    failed: {
      on: {
        CONNECT: { target: "connecting", actions: "resetAttempts" },
      },
    },
  },
});

export type ConnectionMachine = typeof connectionMachine;
