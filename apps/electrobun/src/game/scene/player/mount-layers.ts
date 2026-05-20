import type { MountDisplay } from "@/game/scene/sprite-types";

import type {
  CharacterAnimation,
  CharacterSpriteLoader,
} from "@/game/assets/character-sprite";

/**
 * Mount layer offset to avoid collision with regular sprite IDs in the
 * character sprite loader. Chevauchor (rider) assets live at gfxId +
 * CHEVAUCHOR_ID_OFFSET.
 */
const CHEVAUCHOR_ID_OFFSET = 1_000_000;

/**
 * Sub-offset adjustments inside the canonical Object2 cell depth band
 * for the three mount layers. The base char placement sits at
 * `cellId * 100 + 30` (FIRST_SPRITE_DEPTH_ON_CELL); mount layers ride
 * adjacent depth slots so the painter's-algo sort places them in the
 * canonical back → rider → front order without any z-fighting.
 *
 * Slot reservation (each is +/-1 of the base 30):
 *   28 = mount _Back  (saddle, tail behind rider)
 *   29 = chevauchor   (rider sprite)
 *   30 = (player main, but mount overrides — see below)
 *   31 = mount _Front (mount head/neck in front of rider)
 *
 * When mounted, the player's main char placement is hidden (the mount
 * back layer takes its visual role). The renderer still upserts the
 * main placement at depth 30 in case the bundle is missing the _Back
 * variant — invisible to the user when the mount layers render, but
 * a guaranteed fallback when they don't.
 */
export const MOUNT_DEPTH_BACK = -2;
export const MOUNT_DEPTH_RIDER = -1;
export const MOUNT_DEPTH_FRONT = 1;

const ANIM_PREFIX_RE = /^(static|walk|run|anim\d+|hit|die|bonus|appear)/;

/**
 * Manages the three mount-related animation states for a single
 * mounted player. Per the canonical Dofus 1.29 mount system, a
 * mounted character renders as four layered movieclips:
 *   - Player body's `_Back` half  (replaces the main sprite)
 *   - Chevauchor rider sprite
 *   - Player body's `_Front` half (mount head/neck)
 *   - Mount feet decoration when present
 *
 * In the unified World layer this is three `CharWorldPlacement`
 * upserts at three sub-depths within the same cell. JS keeps the
 * three animation cursors frame-synchronized on every tick.
 *
 * The class itself is now stateless across renders — it owns the
 * resolved CharacterAnimation refs for the back / rider / front
 * sub-clips. The PlayerRenderer's `syncPlacement` walker reads them
 * each tick and emits the three additional placements.
 */
export class PlayerMountLayers {
  /** Resolved metadata for the player body's `_Back` half. */
  backAnim: CharacterAnimation | null = null;
  /** Resolved metadata for the player body's `_Front` half. */
  mountFrontAnim: CharacterAnimation | null = null;
  /** Resolved metadata for the chevauchor / rider sprite. */
  chevauchorAnim: CharacterAnimation | null = null;

  constructor(
    private readonly spriteLoader: CharacterSpriteLoader,
    /**
     * Predicate the loader's late `.then` callbacks consult to decide
     * if the originally requested anim still matches the player's
     * current state — guards against direction flips landing while a
     * mount-layer load is in flight.
     */
    private readonly stillValid: (forAnimName: string) => boolean
  ) {}

  /**
   * Begin loading every mount sub-clip for the given base animation.
   * Each sub-clip resolves asynchronously via `loadAnimation`; the
   * placement upsert that consumes their metadata happens on the
   * next post-tick walk through `syncPlacement`. `onBackAnimLoaded`
   * informs the caller when the body's `_Back` half resolves, so the
   * caller can continue treating the player's main `currentAnimData`
   * as the back half (preserving frame-sync semantics across the
   * mount/unmount transition).
   */
  apply(
    gfxId: number,
    look: string,
    animName: string,
    mount: MountDisplay | undefined,
    onBackAnimLoaded: (anim: CharacterAnimation) => void
  ): void {
    this.applyBack(gfxId, look, animName, onBackAnimLoaded);
    this.applyFront(gfxId, look, animName);

    if (mount) {
      this.applyChevauchor(mount, animName);
    }
  }

  /** Drop every cached mount layer ref. Called when un-mounting. */
  clear(): void {
    this.backAnim = null;
    this.mountFrontAnim = null;
    this.chevauchorAnim = null;
  }

  private applyBack(
    gfxId: number,
    look: string,
    animName: string,
    onBackAnimLoaded: (anim: CharacterAnimation) => void
  ): void {
    const backAnimName = `${animName}_Back`;
    const cached = this.spriteLoader.getAnimationSync(
      gfxId,
      backAnimName,
      look
    );

    if (cached) {
      this.backAnim = cached;
      onBackAnimLoaded(cached);
      return;
    }

    void this.spriteLoader
      .loadAnimation(gfxId, backAnimName, look)
      .then((anim) => {
        if (!this.stillValid(animName) || !anim) {
          return;
        }

        this.backAnim = anim;
        onBackAnimLoaded(anim);
      });
  }

  private applyFront(gfxId: number, look: string, animName: string): void {
    const frontAnimName = `${animName}_Front`;
    const cached = this.spriteLoader.getAnimationSync(
      gfxId,
      frontAnimName,
      look
    );

    if (cached) {
      this.mountFrontAnim = cached;
      return;
    }

    this.mountFrontAnim = null;
    void this.spriteLoader
      .loadAnimation(gfxId, frontAnimName, look)
      .then((anim) => {
        if (!this.stillValid(animName)) {
          return;
        }

        this.mountFrontAnim = anim ?? null;
      });
  }

  private applyChevauchor(mount: MountDisplay, animName: string): void {
    const chevGfxId = CHEVAUCHOR_ID_OFFSET + mount.gfxId;
    const suffix = animName.replace(ANIM_PREFIX_RE, "");
    const chevAnimName = `static${suffix}`;

    const cached = this.spriteLoader.getAnimationSync(
      chevGfxId,
      chevAnimName,
      undefined
    );

    if (cached) {
      this.chevauchorAnim = cached;
      return;
    }

    this.chevauchorAnim = null;
    void this.spriteLoader
      .loadAnimation(chevGfxId, chevAnimName, undefined)
      .then((anim) => {
        if (!this.stillValid(animName)) {
          return;
        }

        this.chevauchorAnim = anim ?? null;
      });
  }
}
