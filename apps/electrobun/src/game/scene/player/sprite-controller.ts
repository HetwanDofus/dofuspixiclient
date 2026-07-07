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
  flipped: boolean,
  prevAnimName: string
) => void;

/**
 * Fire-and-forget pre-warm hook. The first bot to spawn for a given
 * gfxId triggers a background sweep that loads the metadata for every
 * (anim_type, direction, flipped) tuple this class will ever need
 * and primes the strip renderer's atlas cache. By the time the bot
 * actually walks, every required atlas is already baked.
 *
 * Caller (PlayerStripRenderer) is expected to no-op when the atlas
 * is already cached — this hook fires once per class for free.
 */
export type OnPrewarmAtlas = (
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
  /**
   * gfxIds whose pre-warm sweep has already been kicked off. We only
   * pre-warm once per class because the resulting atlases are shared
   * across every bot of the same class via the body atlas cache.
   */
  private prewarmedGfxIds: Set<number> = new Set();

  constructor(
    private readonly spriteLoader: CharacterSpriteLoader,
    private readonly fighterExists: (id: number) => boolean,
    private readonly onApplied?: OnAnimationApplied,
    private readonly onPrewarm?: OnPrewarmAtlas
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
      this.maybeKickoffPrewarm(player);
      return;
    }

    await this.load(player, "static", direction);

    if (!this.fighterExists(player.id)) {
      return;
    }

    player.container.visible = true;
    this.maybeKickoffPrewarm(player);
  }

  /**
   * Background metadata + atlas prewarm for a class. Fires once per
   * gfxId (subsequent bots of the same class skip). Loads the
   * metadata for each (anim_type, direction, flipped) tuple this bot
   * will plausibly need (walk + run + cast + hit + die in every
   * cardinal direction, plus the flipped variants for L/F), then
   * tells the strip renderer to bake the atlas in the background.
   *
   * The strip renderer's pre-warm hook is fire-and-forget: it calls
   * `cache.acquireBodyAtlas` then immediately releases the refcount.
   * Bake fires through the normal queue (so the adaptive budget
   * throttles them during heavy frames). The resulting atlas stays
   * in the cache with refcount=0 — eligible for LRU eviction but
   * available for the first actual hit.
   *
   * Net effect: every cache miss after the prewarm sweep is a
   * cache HIT instead. Bake queue drains to zero after warmup and
   * stays there, instead of churning with mid-walk misses.
   */
  private maybeKickoffPrewarm(player: ActivePlayer): void {
    const gfxId = player.gfxId;
    if (gfxId === 0) return;
    if (!this.onPrewarm) return;
    if (this.prewarmedGfxIds.has(gfxId)) return;
    this.prewarmedGfxIds.add(gfxId);

    // Capture player.look at prewarm-trigger time — look mutations
    // mid-sweep would land bakes against a stale palette, but the
    // body atlas key doesn't include look (recolor happens at
    // composite time via the shader's zone uniforms), so look
    // doesn't actually matter for the cache key. The local copy is
    // just to satisfy `loadAnimationWithFallback`'s signature.
    const look = player.look;

    // Anim types we want pre-warmed in every cardinal direction.
    //
    // CRITICAL: `static` MUST be included. The original comment here
    // said "static is already loaded by boot above" — but boot only
    // loads ONE direction (whichever the bot spawns facing). When a
    // walking bot stops, it transitions to `static_<currentDir>` —
    // which is a cache miss for any direction other than the
    // initial spawn dir → bake → ~50 ms freeze visible at 60 fps as
    // "bot froze mid-anim instead of going to static pose."
    //
    // `walk` + `run` cover the moving-bot transitions; `static`
    // covers the moving-bot-stopping transitions. Combined with the
    // post-Phase-1b scene-cache, each pre-warm bake is ~0.6 ms (warm)
    // or ~5 ms (cold first build) — total pre-warm cost per gfxId
    // is bounded.
    const animTypes = ["static", "walk", "run"];
    // Cardinal directions Dofus 1.29 art ships separate exports
    // for: R, L, F, B. (S is static-only.)
    const directions = [1, 3, 5, 7];

    void this.prewarmSweep(gfxId, look, animTypes, directions);
  }

  private async prewarmSweep(
    gfxId: number,
    look: string,
    animTypes: string[],
    directions: number[]
  ): Promise<void> {
    for (const baseAnim of animTypes) {
      for (const direction of directions) {
        try {
          const result = await this.spriteLoader.loadAnimationWithFallback(
            gfxId,
            baseAnim,
            direction,
            look
          );
          if (!result || !this.onPrewarm) continue;
          const flipped = isDirectionFlipped(direction);
          this.onPrewarm(result.animation, result.animName, flipped);
        } catch {
          // Swallow — prewarm is best-effort.
        }
      }
    }
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
    // the next dispatch; nothing else to do. NOTE: don't gate on
    // `currentAnimData` — under the deferred-commit model it stays
    // null until the strip-renderer COMMITS the first staging, so
    // gating on it would re-trigger apply() spuriously during the
    // staging window.
    if (player.currentAnimName === animName) {
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
    // Path B atomic-commit: while a new anim is still staging in
    // the strip renderer (`animReady=false`), the strip we're
    // ACTUALLY drawing is the previous anim — but `currentAnimData`
    // already points at the new anim, so advancing the frame cursor
    // here makes `swapFrame` cycle the OLD atlas through indices
    // intended for the NEW anim (e.g., walkR → walkL transition
    // cycles walkR frames in place while physics is gated). Freezing
    // the cursor until commit keeps the visible bot frozen on
    // whatever the last committed frame was; physics is gated by
    // `movement.ts`, so the bot stays still both visually and
    // positionally until the new strip lands.
    if (!player.animReady) {
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

    // Snapshot the gfx this load was issued against. A creature-mode
    // body swap (renderer `swapBodyGfx`) can retarget `player.gfxId`
    // while this await is in flight; applying the stale result would
    // re-latch `currentAnimName` for the OLD body and make the queued
    // pendingAnim switch() short-circuit — stranding the player on the
    // pre-swap gfx.
    const gfxAtRequest = player.gfxId;
    const result = await this.spriteLoader.loadAnimationWithFallback(
      gfxAtRequest,
      baseAnim,
      direction,
      player.look
    );

    player.spriteLoading = false;

    if (!this.fighterExists(player.id)) {
      return;
    }

    if (result && player.gfxId === gfxAtRequest) {
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
    if (player.currentAnimName === animName) {
      return;
    }

    const prevAnimName = player.currentAnimName;
    player.currentAnimName = animName;

    if (player.isMounting) {
      // Mounted path: applyMount overwrites currentAnimData to the
      // mount's "_Back" half synchronously, so we must reset the cursor
      // up front here — there's no deferred-commit hook for mounts.
      const prevBase = prevAnimName.replace(/[SRFLB]$/, "");
      const nextBase = animName.replace(/[SRFLB]$/, "");
      const sameCycle = prevBase === nextBase && prevBase !== "";
      if (sameCycle) {
        player.frameIndex =
          player.frameIndex % Math.max(1, animation.frameCount);
      } else {
        player.frameIndex = 0;
        player.frameTimer = 0;
      }
      player.currentAnimData = animation;
    }
    // Unmounted path: defer `currentAnimData` install + cursor reset to
    // the strip-renderer commit (in renderer.ts's onApplied .then). During
    // staging, `currentAnimData` keeps pointing at the OLD anim so
    // `tickFrame` advances the cursor against the OLD anim's fc/fps —
    // keeping the visible OLD strip ALIVE until the new strip lands.
    // Without this, a walk → static transition would freeze the OLD strip
    // on frame 0 because:
    //   tickFrame: anim=static fc=1 → early-exits (no cursor advance)
    //   swapFrame: variant=walk (still committed) → shows walk frame 0
    // until the static strip commits ~50–500 ms later.

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
    // pre-allocated frame array. Passes prevAnimName so the deferred-
    // commit handler in renderer.ts can derive the transition base
    // (sameCycle vs. cross-cycle vs. one-shot) for the cursor reset.
    this.onApplied?.(
      player,
      animation,
      animName,
      isDirectionFlipped(player.direction),
      prevAnimName,
    );
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
