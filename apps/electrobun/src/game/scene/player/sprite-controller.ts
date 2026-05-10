import type { ActivePlayer } from "@/game/scene/player/types";
import {
  type CharacterAnimation,
  type CharacterSpriteLoader,
  getDirectionSuffix,
  isDirectionFlipped,
} from "@/game/assets/character-sprite";
import {
  getAnimationBaseFromType,
  isOneShotAnimation,
  updateFrameAnimation,
} from "@/game/scene/player/animation";
import { PlayerMountLayers } from "@/game/scene/player/mount-layers";

/**
 * Hook fired immediately after `apply()` lands a fresh animation
 * (cache hit OR successful async load). Lets the strip renderer
 * trigger a Vello strip dispatch + texture swap in lockstep with the
 * animation-state install. Receives the resolved direction suffix and
 * flipped flag so the strip render can encode the canonical
 * accessory direction without re-deriving it.
 */
export type OnAnimationApplied = (
  player: ActivePlayer,
  animation: CharacterAnimation,
  animName: string,
  flipped: boolean
) => void;

/**
 * Owns animation-state transitions for every player. Stateless across
 * calls — operates on whichever ActivePlayer the caller passes in,
 * which lets PlayerRenderer stay a pure coordinator.
 *
 * Under the unified World layer there are no per-player Pixi sprites
 * to mutate. `apply` / `switch` / `tickFrame` write into the player's
 * animation state fields (`currentAnimData`, `currentAnimName`,
 * `frameIndex`, `frameTimer`); the per-tick `syncPlacement` walker on
 * `PlayerRenderer.onPostTick` reads that state and upserts a
 * `CharWorldPlacement` into the world layer.
 */
export class PlayerSpriteController {
  constructor(
    private readonly spriteLoader: CharacterSpriteLoader,
    private readonly fighterExists: (id: number) => boolean,
    private readonly onApplied?: OnAnimationApplied
  ) {}

  /**
   * Initial bootstrap: try the sync metadata cache, otherwise async-
   * load the static animation for the supplied direction. Resolves
   * once the metadata is in place — the actual placement upsert lands
   * on the next `syncPlacement` walk.
   */
  async boot(player: ActivePlayer, direction: number): Promise<void> {
    if (player.gfxId === 0) {
      player.container.visible = true;
      return;
    }

    const animName = `static${getDirectionSuffix(direction)}`;
    const cached = this.spriteLoader.getAnimationSync(
      player.gfxId,
      animName,
      player.look
    );

    void this.spriteLoader.loadApplyEnd(player.gfxId);

    if (cached) {
      this.apply(player, cached, animName);
      player.container.visible = true;
      return;
    }

    await this.load(player, "static", direction);

    if (!this.fighterExists(player.id)) {
      return;
    }

    player.container.visible = true;
  }

  /** Used for the parent of a linked-children family during mount-up. */
  async loadForParent(
    player: ActivePlayer,
    baseAnim: string,
    direction: number
  ): Promise<void> {
    await this.load(player, baseAnim, direction);

    if (this.fighterExists(player.id)) {
      player.container.visible = true;
    }
  }

  /**
   * Switch animations (e.g., idle → walk). When the requested anim is
   * cached, applies it inline; otherwise falls through to an async
   * load while the previous animation continues.
   */
  switch(player: ActivePlayer, baseAnim: string, direction: number): void {
    const animName = `${baseAnim}${getDirectionSuffix(direction)}`;

    // Same anim name (incl. flipped variant) — direction may have
    // changed but the underlying export hasn't. The post-tick walker
    // will pick up the new direction (placement.dirSuffix / bFix) on
    // the next dispatch; nothing else to do.
    if (player.currentAnimName === animName && player.currentAnimData) {
      return;
    }

    const cached = this.spriteLoader.getAnimationSync(
      player.gfxId,
      animName,
      player.look
    );

    if (cached) {
      this.apply(player, cached, animName);
    } else {
      void this.load(player, baseAnim, direction);
    }
  }

  /** Advance the player's animation frame by `deltaS` seconds. */
  tickFrame(player: ActivePlayer, deltaS: number): void {
    if (!player.currentAnimData) {
      return;
    }

    const anim = player.currentAnimData;
    const realFrameCount = anim.frameCount;
    const frameState = {
      frameIndex: player.frameIndex,
      frameTimer: player.frameTimer,
    };

    // Loop semantics:
    //   - If the current anim name matches what `player.animation`
    //     expects, the high-level state is the source of truth (cast/
    //     attack/hit/die one-shot, idle/walk/run loop).
    //   - Otherwise we're in the brief async window between a switch()
    //     request and apply() — `currentAnimData` still points at the
    //     previous animation. Force loop=false so a one-shot pose
    //     (cast/attack) doesn't replay from frame 0 while we wait for
    //     the new metadata to land.
    const expectedBase = getAnimationBaseFromType(player.animation);
    const currentBase = player.currentAnimName.replace(/[SRFLB]$/, "");
    const animMatches = currentBase === expectedBase;
    const loop = animMatches && !isOneShotAnimation(player.animation);
    updateFrameAnimation(frameState, deltaS, realFrameCount, anim.fps, loop);

    player.frameIndex = frameState.frameIndex;
    player.frameTimer = frameState.frameTimer;
  }

  /**
   * Re-sync metadata after a global state change (zoom — kept for API
   * compatibility but is a near-no-op now that animation metadata is
   * zoom-independent under the unified renderer).
   */
  reloadAll(_players: Iterable<ActivePlayer>): void {
    // Metadata is zoom-independent; nothing to do.
  }

  /**
   * Load the animation (or its direction fallback) and apply it.
   * Handles the queued-request pattern so only the most recent
   * animation wins under spam.
   */
  private async load(
    player: ActivePlayer,
    baseAnim: string,
    direction: number
  ): Promise<void> {
    if (player.spriteLoading) {
      player.pendingAnim = { baseAnim, direction };
      return;
    }

    player.spriteLoading = true;
    player.pendingAnim = null;

    const result = await this.spriteLoader.loadAnimationWithFallback(
      player.gfxId,
      baseAnim,
      direction,
      player.look
    );

    player.spriteLoading = false;

    if (!this.fighterExists(player.id)) {
      return;
    }

    if (result) {
      this.apply(player, result.animation, result.animName);
    }

    if (player.pendingAnim) {
      const { baseAnim: nextAnim, direction: nextDir } = player.pendingAnim;
      player.pendingAnim = null;
      this.switch(player, nextAnim, nextDir);
    }
  }

  /**
   * Apply a loaded animation's metadata to the player. Replaces the
   * placeholder graphic on first apply and resets the frame cursor
   * unless we're continuing the same walk/run cycle (preserves phase
   * across direction flips so chars don't "hop" mid-cell).
   */
  private apply(
    player: ActivePlayer,
    animation: CharacterAnimation,
    animName: string
  ): void {
    if (player.currentAnimName === animName && player.currentAnimData) {
      return;
    }

    const prevBase = player.currentAnimName.replace(/[SRFLB]$/, "");
    const nextBase = animName.replace(/[SRFLB]$/, "");
    const sameCycle = prevBase === nextBase && prevBase !== "";
    const nextFrameCount = animation.frameCount;

    player.currentAnimData = animation;
    player.currentAnimName = animName;
    if (sameCycle) {
      player.frameIndex = player.frameIndex % Math.max(1, nextFrameCount);
    } else {
      player.frameIndex = 0;
      player.frameTimer = 0;
    }

    if (player.placeholderGraphics) {
      player.container.removeChild(player.placeholderGraphics);
      player.placeholderGraphics.destroy();
      player.placeholderGraphics = null;
    }

    player.spriteReady = true;

    if (player.isMounting) {
      this.applyMount(player, animName);
    }

    // Notify the strip renderer so it can dispatch a fresh Vello strip
    // for this anim and swap the player's Pixi sprite to the new
    // pre-allocated frame array. Must fire after `currentAnimData` is
    // set so frame-cursor sharing stays in lockstep.
    this.onApplied?.(player, animation, animName, isDirectionFlipped(player.direction));
  }

  private applyMount(player: ActivePlayer, animName: string): void {
    if (!player.mountLayers) {
      player.mountLayers = new PlayerMountLayers(
        this.spriteLoader,
        (forAnim) =>
          this.fighterExists(player.id) && player.currentAnimName === forAnim
      );
    }

    player.mountLayers.apply(
      player.gfxId,
      player.look,
      animName,
      player.mount,
      (backAnim) => {
        // The body's `_Back` half is now what plays on the main player
        // placement when mounted — frame-syncing rides on the same
        // cursor as before, just with a different metadata ref.
        player.currentAnimData = backAnim;
      }
    );
  }
}
