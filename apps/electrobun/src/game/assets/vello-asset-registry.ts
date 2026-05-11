import { loadSwfBundle } from "@/game/render/vello-loader";

/** Offset added to chevauchor gfxIds to avoid collision with regular sprite IDs. */
export const CHEVAUCHOR_ID_OFFSET = 1_000_000;

/**
 * Loads sprite + chevauchor SWF bundles into the shared `vello-loader` and
 * remembers the loaded bundle names so repeat requests hit the cache.
 *
 * Separated from CharacterSpriteLoader because it's pure I/O + bookkeeping —
 * everything about animation rendering and per-frame texture caching lives
 * elsewhere.
 *
 * Accessory loading was previously done here for the dofasset render path.
 * It moved out of this file because the SWF render path composes accessories
 * by reading per-frame attachment matrices from the player SWF (see
 * `getSwfAccessorySlots`) and rendering each accessory SWF separately, then
 * compositing in Pixi. That logic lives in Phase 4 of the migration.
 */
export class VelloAssetRegistry {
  /** gfxId → SWF bundle name (e.g. 10 → "sprite-10", 1000010 → "chevauchor-10"). */
  private readonly bundleNames = new Map<number, string>();
  private readonly pendingLoads = new Map<number, Promise<boolean>>();

  /** Bundle name for this gfxId, if already loaded (else undefined). */
  getSpriteBundleName(gfxId: number): string | undefined {
    return this.bundleNames.get(gfxId);
  }

  /**
   * Load the gfxId's SWF (regular or chevauchor variant, picked by ID range)
   * into the shared `vello-loader` Vello instance. Deduplicates concurrent
   * calls. Returns true on success.
   */
  async loadSprite(gfxId: number): Promise<boolean> {
    if (this.bundleNames.has(gfxId)) {
      return true;
    }

    const existing = this.pendingLoads.get(gfxId);
    if (existing) {
      return existing;
    }

    const promise = this.doLoadSprite(gfxId);
    this.pendingLoads.set(gfxId, promise);
    try {
      return await promise;
    } finally {
      this.pendingLoads.delete(gfxId);
    }
  }

  private async doLoadSprite(gfxId: number): Promise<boolean> {
    const isChevauchor = gfxId >= CHEVAUCHOR_ID_OFFSET;
    const realId = isChevauchor ? gfxId - CHEVAUCHOR_ID_OFFSET : gfxId;
    const bundleName = isChevauchor
      ? `chevauchor-${realId}`
      : `sprite-${realId}`;
    const url = isChevauchor
      ? `/swf/sprites/chevauchor/${realId}.swf`
      : `/swf/sprites/${realId}.swf`;

    try {
      const ok = await loadSwfBundle(bundleName, url);
      if (!ok) {
        return false;
      }
      this.bundleNames.set(gfxId, bundleName);
      return true;
    } catch {
      return false;
    }
  }

  clear(): void {
    this.bundleNames.clear();
    this.pendingLoads.clear();
  }
}
