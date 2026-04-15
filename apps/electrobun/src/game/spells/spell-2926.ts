/**
 * Spell 2926 - Bat/Fireworks
 *
 * A composite animation with a "shoot" animation containing embedded particle effects.
 * The shoot animation plays at the target position with:
 * - A bat-wings sound at frame 1 (index 0)
 * - A fireworks explosion sound at frame 58 (index 57)
 * - Hit signal at frame 58 (explosion)
 * - Animation ends at frame 289 (index 288) via removeMovieClip
 *
 * Components:
 * - shoot (sprite): 291-frame composite animation at target position
 *
 * Original AS timing:
 * - Frame 1 (DefineSprite_24): SOMA.playSound("bat_ailes")
 * - Frame 58 (DefineSprite_24): SOMA.playSound("explo_fireworks") -> hit signal
 * - Frame 85 (DefineSprite_24): stop()
 * - Frame 289 (DefineSprite_3_shoot): removeMovieClip / stop
 */

import type { SpellContext, SpellTextureProvider } from "@dofus/spell-runtime";
import {
  BaseSpell,
  calculateAnchor,
  FrameAnimatedSprite,
  type SpellInitContext,
  type SpriteManifest,
} from "@dofus/spell-runtime";

const SHOOT_MANIFEST: SpriteManifest = {
  width: 92.9,
  height: 92.9,
  offsetX: -43.5,
  offsetY: -74.2,
};

export class Spell2926 extends BaseSpell {
  readonly spellId = 2926;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    const shootTextures = textures.getFrames("shoot");
    const anchor = calculateAnchor(SHOOT_MANIFEST);

    const shootAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: shootTextures,
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: init.scale,
      })
    );

    shootAnim.sprite.position.set(init.targetX, init.targetY);

    // Frame 1 (0-indexed: 0): play bat_ailes sound
    shootAnim.onFrame(0, () => this.callbacks.playSound("bat_ailes"));

    // Frame 58 (0-indexed: 57): play explo_fireworks sound + signal hit
    shootAnim.onFrame(57, () => {
      this.callbacks.playSound("explo_fireworks");
      this.signalHit();
    });

    // Frame 289 (0-indexed: 288): animation ends (removeMovieClip / stop)
    shootAnim.stopAt(288);

    shootAnim.addTo(this.container);
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
