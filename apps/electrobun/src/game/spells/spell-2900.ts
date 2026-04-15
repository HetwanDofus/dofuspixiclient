/**
 * Spell 2900 - Fireworks
 *
 * A fireworks spell with a rocket that launches, explodes, and spawns multiple
 * "feux" (firework burst) instances with trailing mini-fire particles.
 *
 * Components:
 * - Main timeline (DefineSprite_31): Rocket + explosion, 97 frames total
 *   - Frame 1: Play sound 'fireworks01', set random scale (80-120%) and rotation (-20..+20)
 *   - Frame 70: Play sound 'explo_fireworks'
 *   - Frame 76: Attach feux instances (count depends on level)
 *   - Frame 97: stop()
 *
 * The main animation is the composite 'minifeux4' (78 frames) used as the rocket trail,
 * and 'feux' (16 frames) used for the explosion bursts.
 *
 * Since the actual spell is a single composite animation rendered from the SWF timeline,
 * we use the pre-rendered composite animations directly:
 * - minifeux4 (78 frames): main firework rocket with trail
 * - feux (16 frames): explosion burst instances
 * - minifeux, minifeux2, minifeux3 (36/36/78 frames): trailing sparks
 *
 * Original AS timing:
 * - Frame 1 (DefineSprite_31): Play 'fireworks01', set scale/rotation
 * - Frame 70 (DefineSprite_31): Play 'explo_fireworks'
 * - Frame 76 (DefineSprite_31): Spawn feux instances (6 + 7*((level-1)%3) instances)
 * - Frame 97 (DefineSprite_31): stop()
 *
 * Since the composited animations are pre-rendered, we use:
 * - minifeux4 as the main rocket animation (78 frames, plays through)
 * - feux instances spawned at frame 75 (0-indexed) of the main timeline
 * - Sounds at frames 0 and 69 (0-indexed) matching manifest sounds
 */

import type { SpellContext, SpellTextureProvider } from "@dofus/spell-runtime";
import {
  BaseSpell,
  calculateAnchor,
  FrameAnimatedSprite,
  type SpellInitContext,
  type SpriteManifest,
} from "@dofus/spell-runtime";

const MINIFEUX4_MANIFEST: SpriteManifest = {
  width: 5.35,
  height: 6.6,
  offsetX: -1.25,
  offsetY: -2.85,
};

const FEUX_MANIFEST: SpriteManifest = {
  width: 48.25,
  height: 53.3,
  offsetX: -18.65,
  offsetY: -26.75,
};

const MINIFEUX_MANIFEST: SpriteManifest = {
  width: 2.45,
  height: 2.05,
  offsetX: 0.2,
  offsetY: -1.2,
};

export class Spell2900 extends BaseSpell {
  readonly spellId = 2900;

  private feuxInstances: FrameAnimatedSprite[] = [];
  private feuxSpawned = false;
  private mainAnim!: FrameAnimatedSprite;
  private level = 1;

  protected setup(
    context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    this.level = Math.max(1, Math.min(6, context?.level ?? 1));

    // Main firework rocket animation (minifeux4, 78 frames)
    // This is the pre-rendered composite of the main timeline
    const minifeux4Anchor = calculateAnchor(MINIFEUX4_MANIFEST);
    this.mainAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("minifeux4"),
        anchorX: minifeux4Anchor.x,
        anchorY: minifeux4Anchor.y,
        scale: init.scale,
      })
    );
    this.mainAnim.sprite.position.set(init.targetX, init.targetY);

    // Frame 0 (AS frame 1): Play fireworks sound
    this.mainAnim.onFrame(0, () => {
      this.callbacks.playSound("fireworks01");
    });

    // Frame 69 (AS frame 70): Play explosion sound
    this.mainAnim.onFrame(69, () => {
      this.callbacks.playSound("explo_fireworks");
      this.signalHit();
    });

    // Frame 75 (AS frame 76): Spawn feux instances
    this.mainAnim.onFrame(75, () => {
      this.spawnFeuxInstances(textures, init);
    });

    this.container.addChild(this.mainAnim.sprite);
  }

  private spawnFeuxInstances(
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    if (this.feuxSpawned) {
      return;
    }
    this.feuxSpawned = true;

    // AS: sz = 60 + 20 * ((level - 1) % 3)
    const sz = 60 + 20 * ((this.level - 1) % 3);
    const szScale = sz / 100;

    // AS: i = 1; while(i < 6 + 7 * ((level-1) % 3)) { attachMovie("feux", ...) }
    // Count = 5 + 7*((level-1)%3) instances (loop goes while i < limit, starting at 1)
    const feuxCount = 5 + 7 * ((this.level - 1) % 3);

    const feuxAnchor = calculateAnchor(FEUX_MANIFEST);

    // Also spawn some minifeux/minifeux2/minifeux3 trailing sparks to simulate
    // the dynamic attachMovie behavior of the feux children
    const minifeuxAnchor = calculateAnchor(MINIFEUX_MANIFEST);

    for (let i = 0; i < feuxCount; i++) {
      // Each feux instance gets a random rotation (from DefineSprite_31 DoAction_2: _rotation = -20 + random(40))
      // and the container has sz scale
      // Individual feux use gotoAndStop(level + 1) on frame 1

      const feux = this.anims.add(
        new FrameAnimatedSprite({
          textures: textures.getFrames("feux"),
          anchorX: feuxAnchor.x,
          anchorY: feuxAnchor.y,
          scale: init.scale * szScale,
        })
      );

      // Random position spread for each burst
      const offsetX = -50 + Math.floor(Math.random() * 100);
      const offsetY = -50 + Math.floor(Math.random() * 100);
      feux.sprite.position.set(
        this.mainAnim.sprite.x + offsetX * init.scale,
        this.mainAnim.sprite.y + offsetY * init.scale
      );

      // Random rotation like the main container: -20 + random(40)
      feux.sprite.rotation =
        ((-20 + Math.floor(Math.random() * 40)) * Math.PI) / 180;

      this.container.addChild(feux.sprite);
      this.feuxInstances.push(feux);
    }

    // Spawn some minifeux3 trailing sparks (simulating the particle trail behavior)
    // AS: DefineSprite_6_minifeux3 - random rotation, alpha, v=2+3*random, fades over 78 frames
    const minifeux3Count = 6 + Math.floor(Math.random() * 6);
    for (let i = 0; i < minifeux3Count; i++) {
      const spark = this.anims.add(
        new FrameAnimatedSprite({
          textures: textures.getFrames("minifeux3"),
          anchorX: minifeuxAnchor.x,
          anchorY: minifeuxAnchor.y,
          scale: init.scale,
        })
      );

      // AS: _rotation = random(360)
      spark.sprite.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
      // AS: _alpha = random(150) -> convert to 0-1
      spark.sprite.alpha = Math.floor(Math.random() * 150) / 100;

      const offsetX = -30 + Math.floor(Math.random() * 60);
      const offsetY = -30 + Math.floor(Math.random() * 60);
      spark.sprite.position.set(
        this.mainAnim.sprite.x + offsetX * init.scale,
        this.mainAnim.sprite.y + offsetY * init.scale
      );

      this.container.addChild(spark.sprite);
      this.feuxInstances.push(spark);
    }

    // Spawn some minifeux trailing sparks
    // AS: DefineSprite_8_minifeux - random rotation, alpha=150, v=random, fades over 36 frames
    const minifeuxCount = 4 + Math.floor(Math.random() * 4);
    for (let i = 0; i < minifeuxCount; i++) {
      const spark = this.anims.add(
        new FrameAnimatedSprite({
          textures: textures.getFrames("minifeux"),
          anchorX: minifeuxAnchor.x,
          anchorY: minifeuxAnchor.y,
          scale: init.scale,
        })
      );

      // AS: _rotation = random(360)
      spark.sprite.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
      // AS: _alpha = 150 initially
      spark.sprite.alpha = 1.0;

      const offsetX = -20 + Math.floor(Math.random() * 40);
      const offsetY = -20 + Math.floor(Math.random() * 40);
      spark.sprite.position.set(
        this.mainAnim.sprite.x + offsetX * init.scale,
        this.mainAnim.sprite.y + offsetY * init.scale
      );

      this.container.addChild(spark.sprite);
      this.feuxInstances.push(spark);
    }

    // Spawn some minifeux2 trailing sparks
    // AS: DefineSprite_7_minifeux2 - random rotation, alpha=random(150), v=random, fades over 36 frames
    const minifeux2Count = 4 + Math.floor(Math.random() * 4);
    for (let i = 0; i < minifeux2Count; i++) {
      const spark = this.anims.add(
        new FrameAnimatedSprite({
          textures: textures.getFrames("minifeux2"),
          anchorX: minifeuxAnchor.x,
          anchorY: minifeuxAnchor.y,
          scale: init.scale,
        })
      );

      // AS: _rotation = random(360)
      spark.sprite.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
      // AS: _alpha = random(150)
      spark.sprite.alpha = Math.floor(Math.random() * 150) / 100;

      const offsetX = -20 + Math.floor(Math.random() * 40);
      const offsetY = -20 + Math.floor(Math.random() * 40);
      spark.sprite.position.set(
        this.mainAnim.sprite.x + offsetX * init.scale,
        this.mainAnim.sprite.y + offsetY * init.scale
      );

      this.container.addChild(spark.sprite);
      this.feuxInstances.push(spark);
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    if (this.anims.allComplete()) {
      this.complete();
    }
  }
}
