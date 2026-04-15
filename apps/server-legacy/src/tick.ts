const TICK_RATE = 20; // 20Hz
const TICK_INTERVAL = 1000 / TICK_RATE;

type TickHandler = (deltaMs: number) => void;

const tickHandlers: TickHandler[] = [];
let tickInterval: ReturnType<typeof setInterval> | null = null;
let lastTickTime = 0;

export function registerTickHandler(handler: TickHandler): () => void {
  tickHandlers.push(handler);
  return () => {
    const idx = tickHandlers.indexOf(handler);
    if (idx >= 0) tickHandlers.splice(idx, 1);
  };
}

export function startTickLoop(): void {
  if (tickInterval) return;

  lastTickTime = Date.now();
  tickInterval = setInterval(() => {
    const now = Date.now();
    const deltaMs = now - lastTickTime;
    lastTickTime = now;

    for (const handler of tickHandlers) {
      handler(deltaMs);
    }
  }, TICK_INTERVAL);

  console.log(`[Tick] Game loop started at ${TICK_RATE}Hz`);
}

export function stopTickLoop(): void {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
    console.log("[Tick] Game loop stopped");
  }
}
