/**
 * Throttle for Vello `renderAnimationStrip` calls.
 *
 * When many players load simultaneously (map load / stress test), unbounded
 * concurrent strip renders cause frame drops. This module gates starts to at
 * most `STRIPS_PER_FRAME` per rAF tick; overflow waits in a queue drained on
 * the next frame.
 *
 * Exposed as a singleton so every CharacterSpriteLoader instance shares the
 * budget (matches the GPU's single render queue).
 */

const STRIPS_PER_FRAME = 10;

const queue: (() => void)[] = [];
let active = 0;

function drain(): void {
  const batch = queue.splice(0, STRIPS_PER_FRAME);

  if (batch.length === 0) {
    return;
  }

  active = batch.length;

  for (const resolve of batch) {
    resolve();
  }

  requestAnimationFrame(() => {
    active = 0;
    drain();
  });
}

/** Await a slot before starting a strip render. */
export function acquireStripSlot(): Promise<void> {
  if (active < STRIPS_PER_FRAME) {
    active++;

    if (active === 1) {
      requestAnimationFrame(() => {
        active = 0;
        drain();
      });
    }

    return Promise.resolve();
  }

  return new Promise((resolve) => {
    queue.push(resolve);
  });
}
