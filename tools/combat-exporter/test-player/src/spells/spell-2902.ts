/**
 * Spell 2902 - Fireworks
 *
 * A fireworks spell with a main rocket animation that explodes into
 * multiple "feux" (firework) instances, each spawning minifeux particles.
 *
 * Components:
 * - Main timeline (DefineSprite_31): Rocket + explosion at target position
 *   - Plays sound 'fireworks01' at frame 1
 *   - Plays sound 'explo_fireworks' at frame 70
 *   - Stops at frame 97
 * - At frame 76: Attaches multiple 'feux' instances (count based on level)
 *   - Each 'feux' (DefineSprite_23_feux) contains firework burst particles
 *   - Goes to level+1 frame (selects behavior based on spell level)
 * - Feux instances spawn minifeux2, minifeux3, minifeux4 sub-particles
 *
 * The main animation (DefineSprite_31) is represented by the composite
 * animations in the manifest. We use the pre-rendered composite frames
 * directly rather than trying to replicate the full particle hierarchy.
 *
 * Original AS timing:
 * - Frame 1 (DefineSprite_31): Play sound 'fireworks01', set scale/rotation
 * - Frame 70 (DefineSprite_31): Play sound 'explo_fireworks' → signal hit
 * - Frame 76 (DefineSprite_31): Attach feux instances
 * - Frame 97 (DefineSprite_31): stop()
 * - Frame 319 (main timeline): removeMovieClip + stop → complete
 *
 * Since we have pre-rendered composite animations for minifeux4, minifeux3,
 * minifeux2, minifeux, and feux, we use FrameAnimatedSprite instances
 * for those. The main sprite uses 'feux' frames at target position with
 * multiple instances based on level.
 *
 * Implementation approach:
 * - Use 'feux' composite animation frames for the main explosion at target
 * - Use 'minifeux4' for the rocket trail (long 78-frame animation)
 * - Use 'minifeux3' for burst sparks (78-frame)
 * - Signal hit at frame 69 (AS frame 70, 0-indexed)
 * - Complete when the longest animation finishes
 */

import { Container } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

// Manifests from manifest.json
const MINIFEUX4_MANIFEST: SpriteManifest = {
  width: 5.35,
  height: 6.6,
  offsetX: -1.25,
  offsetY: -2.85,
};

const MINIFEUX3_MANIFEST: SpriteManifest = {
  width: 2.45,
  height: 2.05,
  offsetX: 0.2,
  offsetY: -1.2,
};

const MINIFEUX2_MANIFEST: SpriteManifest = {
  width: 2.45,
  height: 2.05,
  offsetX: 0.2,
  offsetY: -1.2,
};

const MINIFEUX_MANIFEST: SpriteManifest = {
  width: 2.45,
  height: 2.05,
  offsetX: 0.2,
  offsetY: -1.2,
};

const FEUX_MANIFEST: SpriteManifest = {
  width: 48.25,
  height: 53.3,
  offsetX: -18.65,
  offsetY: -26.75,
};

export class Spell2902 extends BaseSpell {
  readonly spellId = 2902;

  private level = 1;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    this.level = Math.max(1, Math.min(6, context?.level ?? 1));

    // AS: taille = 80 + random(40); _xscale = taille; _yscale = taille; _rotation = -20 + random(40);
    const taille = (80 + Math.floor(Math.random() * 40)) / 100;
    const mainRotation = ((-20 + Math.floor(Math.random() * 40)) * Math.PI) / 180;

    // Main container at target position (where the firework explodes)
    const mainContainer = new Container();
    mainContainer.position.set(init.targetX, init.targetY);
    mainContainer.scale.set(taille * init.scale);
    mainContainer.rotation = mainRotation;
    this.container.addChild(mainContainer);

    // === Main rocket: minifeux4 animation (78 frames) ===
    // This is the large rocket/trail element
    const minifeux4Textures = textures.getFrames('minifeux4');
    const minifeux4Anchor = calculateAnchor(MINIFEUX4_MANIFEST);

    const minifeux4Anim = this.anims.add(new FrameAnimatedSprite({
      textures: minifeux4Textures,
      anchorX: minifeux4Anchor.x,
      anchorY: minifeux4Anchor.y,
      scale: init.scale,
    }));
    // Random start frame for minifeux4 (AS: _alpha = random(150))
    const mf4Alpha = Math.floor(Math.random() * 150) / 255;
    minifeux4Anim.sprite.alpha = Math.min(1, mf4Alpha);
    // Random rotation (AS: _rotation = random(360))
    minifeux4Anim.sprite.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
    minifeux4Anim.sprite.position.set(0, 0);
    mainContainer.addChild(minifeux4Anim.sprite);

    // Sound at frame 0 (AS frame 1): 'fireworks01'
    minifeux4Anim.onFrame(0, () => this.callbacks.playSound('fireworks01'));

    // === Minifeux3 (78-frame burst sparks) ===
    const minifeux3Textures = textures.getFrames('minifeux3');
    const minifeux3Anchor = calculateAnchor(MINIFEUX3_MANIFEST);

    // Spawn multiple minifeux3 instances
    // AS: i < 6 + 7 * ((level-1) % 3) feux instances, each may spawn minifeux3
    const numFeux = 5 + 7 * ((this.level - 1) % 3); // i < 6+7*x means x+5 instances (i=1..5+7*x)
    for (let i = 0; i < numFeux; i++) {
      const mf3Anim = this.anims.add(new FrameAnimatedSprite({
        textures: minifeux3Textures,
        anchorX: minifeux3Anchor.x,
        anchorY: minifeux3Anchor.y,
        scale: init.scale,
      }));

      // Random start frame to stagger (AS: random start from feux level gotoAndStop)
      const startFrame3 = Math.floor(Math.random() * 30);
      mf3Anim.gotoFrame(startFrame3);

      // Random position offset around target
      const offsetX3 = -20 + Math.random() * 40;
      const offsetY3 = -20 + Math.random() * 40;
      mf3Anim.sprite.position.set(offsetX3, offsetY3);

      // AS: _alpha = random(150)
      mf3Anim.sprite.alpha = Math.min(1, Math.floor(Math.random() * 150) / 255);

      // AS: _rotation = random(360)
      mf3Anim.sprite.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;

      mainContainer.addChild(mf3Anim.sprite);
    }

    // === Minifeux2 (36-frame) instances ===
    const minifeux2Textures = textures.getFrames('minifeux2');
    const minifeux2Anchor = calculateAnchor(MINIFEUX2_MANIFEST);

    const numMf2 = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < numMf2; i++) {
      const mf2Anim = this.anims.add(new FrameAnimatedSprite({
        textures: minifeux2Textures,
        anchorX: minifeux2Anchor.x,
        anchorY: minifeux2Anchor.y,
        scale: init.scale,
      }));

      const startFrame2 = Math.floor(Math.random() * 20);
      mf2Anim.gotoFrame(startFrame2);

      const offsetX2 = -30 + Math.random() * 60;
      const offsetY2 = -30 + Math.random() * 60;
      mf2Anim.sprite.position.set(offsetX2, offsetY2);

      // AS: _rotation = random(360)
      mf2Anim.sprite.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;

      // AS: _alpha = random(150)
      mf2Anim.sprite.alpha = Math.min(1, Math.floor(Math.random() * 150) / 255);

      mainContainer.addChild(mf2Anim.sprite);
    }

    // === Minifeux (36-frame) instances ===
    const minifeuxTextures = textures.getFrames('minifeux');
    const minifeuxAnchor = calculateAnchor(MINIFEUX_MANIFEST);

    const numMf = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < numMf; i++) {
      const mfAnim = this.anims.add(new FrameAnimatedSprite({
        textures: minifeuxTextures,
        anchorX: minifeuxAnchor.x,
        anchorY: minifeuxAnchor.y,
        scale: init.scale,
      }));

      const startFrameMf = Math.floor(Math.random() * 20);
      mfAnim.gotoFrame(startFrameMf);

      const offsetXMf = -25 + Math.random() * 50;
      const offsetYMf = -25 + Math.random() * 50;
      mfAnim.sprite.position.set(offsetXMf, offsetYMf);

      // AS: _rotation = random(360)
      mfAnim.sprite.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;

      mainContainer.addChild(mfAnim.sprite);
    }

    // === Feux (16-frame) explosion burst instances ===
    // AS: sz = 60 + 20 * ((level-1) % 3); i < 6 + 7 * ((level-1) % 3)
    const sz = (60 + 20 * ((this.level - 1) % 3)) / 100;
    const feuxTextures = textures.getFrames('feux');
    const feuxAnchor = calculateAnchor(FEUX_MANIFEST);
    const numFeuxi = 5 + 7 * ((this.level - 1) % 3); // while(i < 6+7*x) starting i=1 → 5+7*x iterations

    for (let i = 0; i < numFeuxi; i++) {
      const feuxAnim = this.anims.add(new FrameAnimatedSprite({
        textures: feuxTextures,
        anchorX: feuxAnchor.x,
        anchorY: feuxAnchor.y,
        scale: sz * init.scale,
      }));

      // Random position spread for feux burst
      const feuxOffX = -40 + Math.random() * 80;
      const feuxOffY = -40 + Math.random() * 80;
      feuxAnim.sprite.position.set(feuxOffX, feuxOffY);

      // AS frame_1 DoAction: gotoAndStop(_parent._parent._parent.level + 1)
      // level+1 is 1-indexed AS frame → 0-indexed = level
      const feuxStartFrame = Math.min(this.level, feuxTextures.length - 1);
      feuxAnim.gotoFrame(feuxStartFrame);

      // Random rotation
      feuxAnim.sprite.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;

      // Alpha variation
      feuxAnim.sprite.alpha = (60 + Math.floor(Math.random() * 40)) / 100;

      mainContainer.addChild(feuxAnim.sprite);
    }

    // Signal hit at AS frame 70 (0-indexed: 69) via the main minifeux4 animation
    // Also play 'explo_fireworks' sound at that point
    minifeux4Anim.onFrame(69, () => {
      this.callbacks.playSound('explo_fireworks');
      this.signalHit();
    });

    // Stop at AS frame 97 (0-indexed: 96)
    minifeux4Anim.stopAt(77); // minifeux4 only has 78 frames (0-77), use max
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
