import type { MountDisplay } from "@dofus/proto";
import { Sprite } from "pixi.js";

import type { ActivePlayer } from "@/game/scene/player/types";
import {
  type CharacterAnimation,
  type CharacterSpriteLoader,
  getDirectionSuffix,
  isDirectionFlipped,
} from "@/game/assets/character-sprite";
import { updateFrameAnimation } from "@/game/scene/player/animation";
import { PlayerMountLayers } from "@/game/scene/player/mount-layers";

/** Max concurrent players before we skip the background preload pass. */
const PRELOAD_BUDGET = 30;
const DIRECTION_SUFFIXES = ["S", "R", "F", "L", "B"] as const;
const CHEVAUCHOR_ID_OFFSET = 1_000_000;

/**
 * Owns sprite loading + animation application for every player.
 * Stateless across calls — it operates on whichever ActivePlayer the caller
 * passes in, which lets PlayerRenderer stay a pure coordinator.
 */
export class PlayerSpriteController {
  constructor(
    private readonly spriteLoader: CharacterSpriteLoader,
    private readonly fighterExists: (id: number) => boolean,
    private readonly playerCount: () => number
  ) {}

  /**
   * Apply the initial sprite. Tries the sync cache first to avoid flicker on
   * map change; falls back to an async load. Resolves once the initial render
   * is visible AND common animations are preloaded (so MAP_ACTORS can await).
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

    const preloadDone = this.preloadCommon(
      player.gfxId,
      player.look,
      player.mount
    );

    if (cached) {
      this.apply(player, cached, animName);
      player.container.visible = true;
      await preloadDone;
      return;
    }

    await this.load(player, "static", direction);

    if (!this.fighterExists(player.id)) {
      return;
    }

    player.container.visible = true;
    await preloadDone;
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
   * Switch animations (e.g., idle → walk). If the target is already cached,
   * it's applied immediately; otherwise the old animation keeps showing until
   * the async load completes.
   */
  switch(player: ActivePlayer, baseAnim: string, direction: number): void {
    const animName = `${baseAnim}${getDirectionSuffix(direction)}`;

    // Same anim name but direction may have flipped (e.g., SE unflipped vs SW flipped).
    if (player.currentAnimName === animName && player.sprite) {
      this.updateFlip(player);
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
    if (!player.sprite || !player.currentAnimData) {
      return;
    }

    const anim = player.currentAnimData;
    // Atlas mode: textures.length=1 but real frame count lives in frameCount.
    const realFrameCount = anim.frameCount ?? anim.textures.length;
    const frameState = {
      frameIndex: player.frameIndex,
      frameTimer: player.frameTimer,
    };

    updateFrameAnimation(frameState, deltaS, realFrameCount, anim.fps);

    player.frameIndex = frameState.frameIndex;
    player.frameTimer = frameState.frameTimer;

    if (anim.resolveFrame) {
      const tex = anim.resolveFrame(player.frameIndex);

      if (tex) {
        player.sprite.texture = tex;
      }
    } else {
      player.sprite.texture =
        anim.textures[player.frameIndex % anim.textures.length];
    }

    player.mountLayers?.syncFrame(player.frameIndex);
  }

  /** Flip sprite + mount layers in place without re-applying the animation. */
  updateFlip(player: ActivePlayer): void {
    if (!player.sprite || !player.currentAnimData) {
      return;
    }

    const flipped = isDirectionFlipped(player.direction);
    player.sprite.scale.x = flipped ? -1 : 1;
    player.sprite.x = flipped
      ? -player.currentAnimData.offsetX
      : player.currentAnimData.offsetX;

    player.mountLayers?.updateFlip(flipped);
  }

  /** Reload every player's current animation at the new resolution. */
  reloadAll(players: Iterable<ActivePlayer>): void {
    for (const player of players) {
      if (player.gfxId <= 0 || !player.currentAnimName) {
        continue;
      }

      const animName = player.currentAnimName;
      // Force cache miss so apply() accepts the new data.
      player.currentAnimName = "";
      void this.spriteLoader
        .loadAnimation(player.gfxId, animName, player.look)
        .then((anim) => {
          if (anim && this.fighterExists(player.id)) {
            this.apply(player, anim, animName);
          }
        });
    }
  }

  /**
   * Load the animation (or its direction fallback) and apply it. Handles the
   * queued-request pattern so only the most recent animation wins under spam.
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

    // Drain queued request, if any.
    if (player.pendingAnim) {
      const { baseAnim: nextAnim, direction: nextDir } = player.pendingAnim;
      player.pendingAnim = null;
      this.switch(player, nextAnim, nextDir);
    }
  }

  /** Apply a loaded animation to the player, replacing placeholder or prior sprite. */
  private apply(
    player: ActivePlayer,
    animation: CharacterAnimation,
    animName: string
  ): void {
    if (player.currentAnimName === animName && player.sprite) {
      return;
    }

    player.currentAnimData = animation;
    player.currentAnimName = animName;
    player.frameIndex = 0;
    player.frameTimer = 0;

    if (player.placeholderGraphics) {
      player.container.removeChild(player.placeholderGraphics);
      player.placeholderGraphics.destroy();
      player.placeholderGraphics = null;
    }

    const flipped = isDirectionFlipped(player.direction);

    if (!player.sprite) {
      const sprite = new Sprite(animation.textures[0]);
      sprite.anchor.set(0, 0);
      sprite.scale.x = flipped ? -1 : 1;
      sprite.x = flipped ? -animation.offsetX : animation.offsetX;
      sprite.y = animation.offsetY;
      sprite.zIndex = 0;
      player.container.addChild(sprite);
      player.sprite = sprite;
    } else {
      player.sprite.texture = animation.textures[0];
      player.sprite.scale.x = flipped ? -1 : 1;
      player.sprite.x = flipped ? -animation.offsetX : animation.offsetX;
      player.sprite.y = animation.offsetY;
    }

    if (player.isMounting) {
      this.applyMount(player, animName, flipped);
    }
  }

  private applyMount(
    player: ActivePlayer,
    animName: string,
    flipped: boolean
  ): void {
    if (!player.sprite) {
      return;
    }

    if (!player.mountLayers) {
      player.mountLayers = new PlayerMountLayers(
        player.container,
        this.spriteLoader,
        (forAnim) =>
          this.fighterExists(player.id) && player.currentAnimName === forAnim,
        () => player.direction
      );
    }

    player.mountLayers.apply(
      player.sprite,
      player.gfxId,
      player.look,
      animName,
      flipped,
      player.mount,
      (backAnim) => {
        player.currentAnimData = backAnim;
      }
    );
  }

  /**
   * Preload static/walk/run × all direction suffixes (plus mount variants) so
   * subsequent direction/animation switches are instant. Skipped when too many
   * players are live — we'd load the same strips from their initial requests.
   */
  private async preloadCommon(
    gfxId: number,
    look: string,
    mount: MountDisplay | undefined
  ): Promise<void> {
    if (this.playerCount() > PRELOAD_BUDGET) {
      return;
    }

    for (const s of DIRECTION_SUFFIXES) {
      await this.spriteLoader.loadAnimation(gfxId, `static${s}`, look);
      await this.spriteLoader.loadAnimation(gfxId, `walk${s}`, look);
      await this.spriteLoader.loadAnimation(gfxId, `run${s}`, look);

      if (mount) {
        await this.spriteLoader.loadAnimation(gfxId, `static${s}_Front`, look);
        await this.spriteLoader.loadAnimation(gfxId, `static${s}_Back`, look);
        await this.spriteLoader.loadAnimation(gfxId, `walk${s}_Front`, look);
        await this.spriteLoader.loadAnimation(gfxId, `walk${s}_Back`, look);

        const chevGfxId = CHEVAUCHOR_ID_OFFSET + mount.gfxId;
        await this.spriteLoader.loadAnimation(chevGfxId, `static${s}`);
        await this.spriteLoader.loadAnimation(chevGfxId, `walk${s}`);
      }
    }
  }
}
