/**
 * Wire sprite ids are strings; the renderer keys its actors by number. This is
 * the one place that conversion happens, so the chat bubble lands on the same
 * actor the map handler created.
 */
export function numericId(spriteId: string): number {
  const n = Number(spriteId);
  if (Number.isFinite(n)) {
    return n;
  }
  // Non-numeric sprite IDs — monster groups use "${mapId}_${groupIndex}"
  // (enter-game.handler.ts). Hash to a stable NEGATIVE int so:
  //   - distinct groups don't collide on 0,
  //   - the legacy "< 0 = non-player" heuristic in picking.ts routes
  //     the click to the cell pick-through branch (walk then auto-
  //     trigger PvM), not the player context menu.
  let h = 0;
  for (let i = 0; i < spriteId.length; i++) {
    h = (h * 31 + spriteId.charCodeAt(i)) | 0;
  }
  // Ensure a negative, non-zero value.
  return -(Math.abs(h) || 1);
}
