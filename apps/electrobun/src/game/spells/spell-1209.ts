/**
 * Spell 1209
 *
 * A spell with multiple spark/ember particles (sprite_6) that fly outward
 * from the target position, and a main impact animation (sprite_7).
 *
 * Components:
 * - sprite_7: Main impact animation at target position (117 frames, ends at frame 115)
 * - sprite_6: Multiple spark particles, each with independent angular physics
 *
 * Original AS timing:
 * - sprite_6 frame_1: Initialize angle, velocity, angular velocity, onEnterFrame physics
 * - sprite_6 frame_2: stop()
 * - sprite_7 frame_115: _parent.removeMovieClip() - remove this particle
 * - frame_2 (main): stop()
 *
 * Particle physics (sprite_6 / DefineSprite_6):
 * - angle = 360 * Math.random()
 * - v = 6.67 + random(20)  [random(20) = 0..19]
 * - va = 40 * (-0.5 + Math.random())
 * - t = 100
 * - Each frame: randomly update va, scale by v*14, fade t*=0.95,
 *   move by velocity, rotate, decay v*=0.9
 *
 * Hit signal: at start (frame 0) of sprite_7 - the main impact begins
 * Complete: when sprite_7 reaches frame 114 (AS frame 115, removeMovieClip)
 */

import type { SpellContext, SpellTextureProvider } from "@dofus/spell-runtime";
import {
  BaseSpell,
  calculateAnchor,
  FrameAnimatedSprite,
  type SpellInitContext,
  type SpriteManifest,
} from "@dofus/spell-runtime";
import { Container } from "pixi.js";

const IMPACT_MANIFEST: SpriteManifest = {
  width: 187.9,
  height: 187.9,
  offsetX: -95.7,
  offsetY: -109.7,
};

const SPARK_MANIFEST: SpriteManifest = {
  width: 41.25,
  height: 10,
  offsetX: -20,
  offsetY: -5,
};

interface SparkState {
  anim: FrameAnimatedSprite;
  angle: number;
  v: number;
  va: number;
  t: number;
  x: number;
  y: number;
}

export class Spell1209 extends BaseSpell {
  readonly spellId = 1209;

  private impactAnim!: FrameAnimatedSprite;
  private sparks: SparkState[] = [];
  private sparksContainer!: Container;

  protected setup(
    context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    const level = Math.max(1, Math.min(6, context?.level ?? 1));

    // Main impact animation (sprite_7) at target position
    const impactAnchor = calculateAnchor(IMPACT_MANIFEST);
    this.impactAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("sprite_7"),
        anchorX: impactAnchor.x,
        anchorY: impactAnchor.y,
        scale: init.scale,
      })
    );
    this.impactAnim.sprite.position.set(init.targetX, init.targetY);

    // Signal hit immediately when impact starts (frame 0)
    this.impactAnim.onFrame(0, () => this.signalHit());

    // At AS frame 115 (0-indexed: 114), sprite_7 calls removeMovieClip
    // We treat this as the animation completing
    this.container.addChild(this.impactAnim.sprite);

    // Spark particles container at target position
    this.sparksContainer = new Container();
    this.sparksContainer.position.set(init.targetX, init.targetY);
    this.container.addChild(this.sparksContainer);

    // Spawn spark particles
    // Number of sparks: base 5 + level * 2 (reasonable for this type of spell)
    // The AS doesn't specify count explicitly via _parent.level in the provided scripts,
    // but sprite_6 instances are placed by the parent timeline.
    // Using level-based count: 5 + level * 2
    const sparkCount = 5 + level * 2;
    const sparkTextures = textures.getFrames("sprite_6");
    const sparkAnchor = calculateAnchor(SPARK_MANIFEST);

    for (let i = 0; i < sparkCount; i++) {
      const anim = new FrameAnimatedSprite({
        textures: sparkTextures,
        anchorX: sparkAnchor.x,
        anchorY: sparkAnchor.y,
        scale: init.scale,
        stopFrame: 1,
      });

      // AS frame_1/DoAction.as initialization:
      // angle = 360 * Math.random()
      const angle = 360 * Math.random();
      // v = 6.67 + random(20)  [random(20) returns 0..19]
      const v = 6.67 + Math.floor(Math.random() * 20);
      // va = 40 * (-0.5 + Math.random())
      const va = 40 * (-0.5 + Math.random());
      // t = 100
      const t = 100;

      // Initial position at origin (target)
      anim.sprite.position.set(0, 0);

      // Apply initial scale: _xscale = v * 14
      // In PixiJS: xscale is separate, we handle this in update
      const initialXScale = ((v * 14) / 100) * init.scale;
      anim.sprite.scale.set(initialXScale, init.scale);

      // Initial rotation
      anim.sprite.rotation = (angle * Math.PI) / 180;

      this.sparksContainer.addChild(anim.sprite);

      this.sparks.push({
        anim,
        angle,
        v,
        va,
        t,
        x: 0,
        y: 0,
      });
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Update main impact animation
    this.impactAnim.update(deltaTime);

    // Update spark particles with AS physics
    // The AS onEnterFrame runs every frame (at 60fps)
    // deltaTime is in ms, one frame = 1000/60 ms
    const frameTime = 1000 / 60;
    const frames = deltaTime / frameTime;

    for (let f = 0; f < frames; f++) {
      for (const spark of this.sparks) {
        if (!spark.anim.sprite.visible) {
          continue;
        }

        // AS: if(random(2) == 0) { va = 40 * (-0.5 + Math.random()); }
        if (Math.floor(Math.random() * 2) === 0) {
          spark.va = 40 * (-0.5 + Math.random());
        }

        // AS: _xscale = v * 14
        const xScalePct = spark.v * 14;
        spark.anim.sprite.scale.set(
          (xScalePct / 100) * (1 / 1), // init.scale already applied, apply relative
          1 * (1 / 1)
        );

        // AS: t *= 0.95
        spark.t *= 0.95;

        // AS: angle += va
        spark.angle += spark.va;

        // AS: vx = v * Math.cos(angle * 0.017453292519943295)
        const vx = spark.v * Math.cos(spark.angle * 0.017453292519943295);
        // AS: vy = v * Math.sin(angle * 0.017453292519943295)
        const vy = spark.v * Math.sin(spark.angle * 0.017453292519943295);

        // AS: _X = _X + vx; _Y = _Y + vy
        spark.x += vx;
        spark.y += vy;

        // AS: v *= 0.9
        spark.v *= 0.9;

        // AS: _rotation = angle
        spark.anim.sprite.rotation = (spark.angle * Math.PI) / 180;

        // Apply position (scaled)
        spark.anim.sprite.position.set(spark.x, spark.y);

        // Apply alpha via t (t is 100 initially, fades via *=0.95)
        spark.anim.sprite.alpha = spark.t / 100;

        // Apply scale: xscale = v*14 (percentage), yscale stays 100%
        // We need to scale relative to init.scale
        const xs = (spark.v * 14) / 100;
        const ys = 1;
        spark.anim.sprite.scale.set(xs, ys);

        // Kill when effectively invisible
        if (spark.t < 1) {
          spark.anim.sprite.visible = false;
        }
      }
    }

    // Check completion: sprite_7 at AS frame 115 (0-indexed: 114) calls removeMovieClip
    // The animation has 117 frames (0-116), it completes naturally
    if (this.impactAnim.isComplete()) {
      this.complete();
    }

    // Also check: if sprite_7 has reached frame 114 (AS 115)
    if (this.impactAnim.getFrame() >= 114) {
      this.complete();
    }
  }
}
