import type { VelloRenderer } from "vello-wasm";

import type { AccessoryInfo } from "@/game/assets/look-parser";

const SPRITES_BASE_PATH = "/assets/spritesheets/sprites";
const CHEVAUCHORS_BASE_PATH = "/assets/spritesheets/chevauchors";

/** Offset added to chevauchor gfxIds to avoid collision with regular sprite IDs. */
export const CHEVAUCHOR_ID_OFFSET = 1_000_000;

/**
 * Loads sprite/chevauchor/accessory `.dofasset` binaries into a Vello renderer
 * and remembers the Vello asset IDs so repeat requests hit the cache.
 *
 * Separated from CharacterSpriteLoader because it's pure I/O + bookkeeping —
 * everything about animation strips, textures, and caching lives elsewhere.
 */
export class VelloAssetRegistry {
  private vello: VelloRenderer | null = null;
  // Start well above tile asset IDs to avoid collisions.
  private nextId = 100000;

  private readonly spriteIds = new Map<number, number>();
  private readonly pendingSpriteLoads = new Map<number, Promise<boolean>>();

  /** "type:gfxId" → vello asset ID (or -1 for a failed load, so we don't retry). */
  private readonly accessoryIds = new Map<string, number>();
  private readonly pendingAccessoryLoads = new Map<
    string,
    Promise<number | null>
  >();

  setVelloRenderer(vello: VelloRenderer): void {
    this.vello = vello;
  }

  /** Vello asset ID for this sprite, if already loaded (else undefined). */
  getSpriteAssetId(gfxId: number): number | undefined {
    return this.spriteIds.get(gfxId);
  }

  /**
   * Load the sprite's .dofasset (regular or chevauchor variant, picked by ID
   * range) into Vello. Deduplicates concurrent calls.
   */
  async loadSprite(gfxId: number): Promise<boolean> {
    if (this.spriteIds.has(gfxId)) {
      return true;
    }

    const existing = this.pendingSpriteLoads.get(gfxId);

    if (existing) {
      return existing;
    }

    const promise = this.doLoadSprite(gfxId);
    this.pendingSpriteLoads.set(gfxId, promise);

    try {
      return await promise;
    } finally {
      this.pendingSpriteLoads.delete(gfxId);
    }
  }

  private async doLoadSprite(gfxId: number): Promise<boolean> {
    const isChevauchor = gfxId >= CHEVAUCHOR_ID_OFFSET;
    const realId = isChevauchor ? gfxId - CHEVAUCHOR_ID_OFFSET : gfxId;
    const basePath = isChevauchor ? CHEVAUCHORS_BASE_PATH : SPRITES_BASE_PATH;

    try {
      const res = await fetch(`${basePath}/${realId}.dofasset`);

      if (!res.ok) {
        return false;
      }

      const data = new Uint8Array(await res.arrayBuffer());
      const id = this.nextId++;
      this.vello?.loadAsset(id, data);
      this.spriteIds.set(gfxId, id);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Batch-load every accessory for a parsed look and return a flat
   * `[asset_id, slot_id, asset_id, slot_id, ...]` array in the shape
   * `vello.renderFrame` expects. Accessories that fail to load are skipped.
   */
  async loadAccessoriesForLook(
    accessories: AccessoryInfo[]
  ): Promise<number[] | undefined> {
    const accInfo: number[] = [];

    await Promise.all(
      accessories.map(async (acc, index) => {
        if (acc.gfxId === 0) {
          return;
        }

        const assetId = await this.loadAccessory(acc.type, acc.gfxId);

        if (assetId != null) {
          accInfo.push(assetId, index);
        }
      })
    );

    return accInfo.length > 0 ? accInfo : undefined;
  }

  /**
   * Accessories are compiled from /accessories/{type}_{gfxId}/ and stored as
   * acc_{type}_{gfxId}.dofasset. Negative cache on failure so broken slots
   * don't trigger a fetch every frame.
   */
  private async loadAccessory(
    type: number,
    gfxId: number
  ): Promise<number | null> {
    if (!this.vello || gfxId === 0) {
      return null;
    }

    const key = `${type}:${gfxId}`;
    const cached = this.accessoryIds.get(key);

    if (cached !== undefined) {
      return cached === -1 ? null : cached;
    }

    const pending = this.pendingAccessoryLoads.get(key);

    if (pending) {
      return pending;
    }

    const promise = this.doLoadAccessory(type, gfxId, key);
    this.pendingAccessoryLoads.set(key, promise);

    try {
      return await promise;
    } finally {
      this.pendingAccessoryLoads.delete(key);
    }
  }

  private async doLoadAccessory(
    type: number,
    gfxId: number,
    cacheKey: string
  ): Promise<number | null> {
    try {
      const res = await fetch(
        `${SPRITES_BASE_PATH}/acc_${type}_${gfxId}.dofasset`
      );

      if (!res.ok) {
        this.accessoryIds.set(cacheKey, -1);
        return null;
      }

      const data = new Uint8Array(await res.arrayBuffer());
      const id = this.nextId++;
      const ok = this.vello?.loadAsset(id, data);

      if (!ok) {
        this.accessoryIds.set(cacheKey, -1);
        return null;
      }

      this.accessoryIds.set(cacheKey, id);
      return id;
    } catch {
      this.accessoryIds.set(cacheKey, -1);
      return null;
    }
  }

  clear(): void {
    this.spriteIds.clear();
    this.accessoryIds.clear();
    this.pendingSpriteLoads.clear();
    this.pendingAccessoryLoads.clear();
  }
}
