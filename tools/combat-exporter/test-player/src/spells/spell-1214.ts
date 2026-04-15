/**
 * Spell 1214 - Pandinet (Pandawa)
 *
 * A spell featuring a staticR animation placed at the target cell
 * with offset positioning based on angle direction.
 *
 * Components:
 * - staticR: Main animation at target position (with dx/dy offset based on angle)
 *
 * Original AS timing:
 * - Frame 1 (DefineSprite_192_staticR): Set scale (80-100%), possibly flip X
 * - Frame 4 (DefineSprite_192_staticR): Play sound 'impact_lourd'
 * - Frame 58 (DefineSprite_192_staticR): Fade out or stop (random(50) != 1 -> stop)
 * - Frame 13 (main timeline): this.end() -> signal hit
 *
 * Placement (frame_4/PlaceObject2_192_staticR_1):
 *   _X = _parent.cellTo.x
 *   _Y = _parent.cellTo.y
 *
 * Placement (frame_10/PlaceObject2_192_staticR_139, d=27):
 *   dx = (abs(angle) > 90) ? -d : d
 *   dy = (angle < 0) ? -d/2 : d/2
 *   _X = cellTo.x + dx, _Y = cellTo.y + dy
 *
 * Placement (frame_19/PlaceObject2_192_staticR_277, d=53):
 *   dx = (abs(angle) > 90) ? -d : d
 *   dy = (angle < 0) ? -d/2 : d/2
 *   _X = cellTo.x + dx, _Y = cellTo.y + dy
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const STATIC_R_MANIFEST: SpriteManifest = {
  width: 56.3,
  height: 138,
  offsetX: -28.2,
  offsetY: -123.8,
};

export class Spell1214 extends BaseSpell {
  readonly spellId = 1214;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const staticRTextures = textures.getFrames('staticR');
    const anchor = calculateAnchor(STATIC_R_MANIFEST);
    const angle = context?.angle ?? 0;

    // Frame 4 instance: _X = cellTo.x, _Y = cellTo.y (placed at frame 4, 0-indexed = 3)
    // This is the primary instance placed at frame 4
    const anim1 = this.anims.add(new FrameAnimatedSprite({
      textures: staticRTextures,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
    }));

    // AS frame_192_staticR/frame_1: ta = 80 + random(20); _xscale = ta; _yscale = ta
    // if(random(2) == 1) { _xscale = -_xscale; }
    const ta1 = 80 + Math.floor(Math.random() * 20);
    const flipX1 = Math.floor(Math.random() * 2) === 1;
    const scaleVal1 = (ta1 / 100) * init.scale;
    anim1.sprite.scale.set(flipX1 ? -scaleVal1 : scaleVal1, scaleVal1);

    // Positioned at cellTo relative to container (which is at cellFrom)
    anim1.sprite.position.set(init.targetX, init.targetY);

    // Frame 4 (0-indexed: 3): play sound 'impact_lourd'
    anim1.onFrame(3, () => this.callbacks.playSound('impact_lourd'));

    // Frame 13 (0-indexed: 12) of main timeline: this.end() -> signalHit
    // Map to frame 12 of the staticR animation
    anim1.onFrame(12, () => this.signalHit());

    // Frame 58 (0-indexed: 57): random(50) != 1 -> stop; else continue fading
    // Most of the time (49/50) it stops at frame 58
    anim1.onFrame(57, () => {
      if (Math.floor(Math.random() * 50) !== 1) {
        anim1.stopAt(57);
      }
    });

    this.container.addChild(anim1.sprite);

    // Frame 10 instance (d=27): placed at frame 10, 0-indexed = 9
    // dx/dy based on angle
    const d2 = 27;
    let dx2: number;
    let dy2: number;
    if (angle < 0) {
      dy2 = (-d2) / 2;
    } else {
      dy2 = d2 / 2;
    }
    if (Math.abs(angle) > 90) {
      dx2 = -d2;
    } else {
      dx2 = d2;
    }

    const anim2 = this.anims.add(new FrameAnimatedSprite({
      textures: staticRTextures,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
    }));

    const ta2 = 80 + Math.floor(Math.random() * 20);
    const flipX2 = Math.floor(Math.random() * 2) === 1;
    const scaleVal2 = (ta2 / 100) * init.scale;
    anim2.sprite.scale.set(flipX2 ? -scaleVal2 : scaleVal2, scaleVal2);

    anim2.sprite.position.set(init.targetX + dx2, init.targetY + dy2);
    anim2.onFrame(3, () => this.callbacks.playSound('impact_lourd'));
    anim2.onFrame(57, () => {
      if (Math.floor(Math.random() * 50) !== 1) {
        anim2.stopAt(57);
      }
    });

    this.container.addChild(anim2.sprite);

    // Frame 19 instance (d=53): placed at frame 19, 0-indexed = 18
    const d3 = 53;
    let dx3: number;
    let dy3: number;
    if (angle < 0) {
      dy3 = (-d3) / 2;
    } else {
      dy3 = d3 / 2;
    }
    if (Math.abs(angle) > 90) {
      dx3 = -d3;
    } else {
      dx3 = d3;
    }

    const anim3 = this.anims.add(new FrameAnimatedSprite({
      textures: staticRTextures,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
    }));

    const ta3 = 80 + Math.floor(Math.random() * 20);
    const flipX3 = Math.floor(Math.random() * 2) === 1;
    const scaleVal3 = (ta3 / 100) * init.scale;
    anim3.sprite.scale.set(flipX3 ? -scaleVal3 : scaleVal3, scaleVal3);

    anim3.sprite.position.set(init.targetX + dx3, init.targetY + dy3);
    anim3.onFrame(3, () => this.callbacks.playSound('impact_lourd'));
    anim3.onFrame(57, () => {
      if (Math.floor(Math.random() * 50) !== 1) {
        anim3.stopAt(57);
      }
    });

    this.container.addChild(anim3.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    if (this.anims.allStopped()) {
      this.complete();
    }
  }
}
