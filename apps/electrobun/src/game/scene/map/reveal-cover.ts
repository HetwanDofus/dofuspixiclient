import { type Application, Sprite, Texture, Ticker } from "pixi.js";

/**
 * Full-screen opaque black cover for the canonical map-load reveal
 * gate (unified-atlas Step 4, QA-2 "actors pop in after the map").
 *
 * Canonical 1.29 keeps the scene hidden from map-data arrival until
 * BOTH the terrain and the GI-triggered initial sprite roster are
 * attached, then reveals everything together. wc3 implements the same
 * contract by freezing the world compose while a load is in flight
 * and swapping atomically once tiles + actors are ready
 * (dofuswebclient3/rust/client render_tiles/reveal.rs
 * `gate_map_reveal`). wc2 uses a cover instead of a held frame
 * because our own player is a fresh GM roster row on every map — its
 * id collides between the outgoing and incoming rosters, so holding
 * the old actor sprites while baking the new ones is not possible
 * without id-space surgery. Tiles underneath still ride Step 2's
 * own no-flash generation swap; the cover simply hides the window in
 * which actors would otherwise trickle in.
 *
 * Mechanism: ONE plain black-tinted `Texture.WHITE` sprite parented
 * to the top of the stage — the exact pattern of the game-area crop
 * covers (battlefield-scene.ts `layoutGameAreaCrop`). Explicitly NO
 * Pixi filters / masks / RenderTexture snapshots: those churn the
 * TexturePool and leak under the patched wgpu fork
 * (feedback_pixi_blurfilter_leak / feedback_pixi_filter_singleton).
 * Reveal is a short alpha fade driven by the shared ticker.
 */
const REVEAL_FADE_MS = 150;

export class MapRevealCover {
  private readonly app: Application;
  private sprite: Sprite | null = null;
  /** Finishes an in-flight reveal fade immediately (detaches cover). */
  private finishFade: (() => void) | null = null;

  constructor(app: Application) {
    this.app = app;
  }

  /**
   * Snap the cover over the whole screen and move it to the top of
   * the stage. Idempotent; cancels an in-flight reveal fade (a new
   * map load re-covers instantly).
   */
  cover(): void {
    this.finishFade?.();
    if (!this.sprite) {
      const s = new Sprite(Texture.WHITE);
      s.label = "map-reveal-cover";
      s.tint = 0x000000;
      s.eventMode = "none";
      this.sprite = s;
    }
    const s = this.sprite;
    s.alpha = 1;
    s.visible = true;
    s.position.set(0, 0);
    s.width = Math.max(1, this.app.screen.width);
    s.height = Math.max(1, this.app.screen.height);
    // addChild re-parents an already-attached sprite to the TOP of the
    // stage, above the crop covers and any later-added overlays.
    this.app.stage.addChild(s);
  }

  /** True while the cover is up (fade not started). */
  isCovering(): boolean {
    return !!this.sprite && this.sprite.visible && !this.finishFade;
  }

  /**
   * Fade the cover out (~150 ms) and detach it. No-op when the cover
   * is already down or already fading — safe to call from both the
   * gate-satisfied path and the timeout path without a double-reveal
   * flash.
   */
  reveal(): void {
    const s = this.sprite;
    if (!s || !s.visible || this.finishFade) {
      return;
    }
    const ticker = Ticker.shared;
    let elapsed = 0;
    const done = (): void => {
      ticker.remove(tick);
      this.finishFade = null;
      s.visible = false;
      s.alpha = 1;
      s.parent?.removeChild(s);
    };
    const tick = (): void => {
      elapsed += ticker.deltaMS;
      const t = Math.min(elapsed / REVEAL_FADE_MS, 1);
      s.alpha = 1 - t;
      if (t >= 1) {
        done();
      }
    };
    this.finishFade = done;
    ticker.add(tick);
  }

  destroy(): void {
    this.finishFade?.();
    this.sprite?.destroy();
    this.sprite = null;
  }
}
