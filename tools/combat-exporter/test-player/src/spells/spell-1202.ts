import { BaseSpell } from './base-spell';
import { FrameAnimatedSprite } from '../../../../spell-utils';
import { SpellInit, SpellState } from '../../../../spell-interface';

export class Spell1202 extends BaseSpell {
  private shoot?: FrameAnimatedSprite;
  private flame?: FrameAnimatedSprite;
  private rotatingElements: Array<{
    sprite: FrameAnimatedSprite;
    vr: number;
  }> = [];
  private frameCount = 0;
  private flameStarted = false;

  async init(params: SpellInit): Promise<void> {
    await super.init(params);

    // Load all required assets
    await this.loadAssets('1202', [
      'DefineSprite_39_shoot',
      'DefineSprite_44_flam',
      'DefineSprite_46',
      'DefineSprite_47'
    ]);

    // Create main shoot animation
    this.shoot = new FrameAnimatedSprite(
      this.assets['DefineSprite_39_shoot'],
      60,
      false
    );
    this.shoot.pivot.set(0.5);
    this.shoot.position.set(params.targetX, params.targetY);
    this.shoot.scale.set(params.scale * 0.5);
    this.container.addChild(this.shoot);
    this.anims.add(this.shoot);

    // Create rotating elements (debris/particles)
    const rotatingAssets = ['DefineSprite_46', 'DefineSprite_47'];
    for (const assetKey of rotatingAssets) {
      if (this.assets[assetKey]) {
        const sprite = new FrameAnimatedSprite(
          this.assets[assetKey],
          60,
          false
        );
        sprite.pivot.set(0.5);
        sprite.position.set(params.targetX, params.targetY);
        sprite.scale.set(params.scale * 0.5);
        
        // Initial rotation velocity: vr = 15 + random(70)
        const vr = 15 + Math.floor(Math.random() * 70);
        
        this.container.addChild(sprite);
        this.anims.add(sprite);
        this.rotatingElements.push({ sprite, vr });
      }
    }

    // Create flame animation (will be shown later)
    this.flame = new FrameAnimatedSprite(
      this.assets['DefineSprite_44_flam'],
      60,
      false
    );
    this.flame.pivot.set(0.5);
    // Flame offset from manifest: X=-83.1, Y=-1068.3
    this.flame.position.set(
      params.targetX - 83.1 * params.scale * 0.5,
      params.targetY - 1068.3 * params.scale * 0.5
    );
    this.flame.scale.set(params.scale * 0.5);
    this.flame.visible = false;
    this.container.addChild(this.flame);
    this.anims.add(this.flame);
  }

  update(deltaTime: number, state: SpellState): void {
    if (this.isDone) {
      return;
    }

    this.anims.update(deltaTime);
    this.frameCount++;

    // Frame 1: Play sound and reset rotation
    if (this.frameCount === 1 && this.callbacks.playSound) {
      this.callbacks.playSound('panda_molotov');
      if (this.shoot) {
        this.shoot.rotation = 0;
      }
    }

    // Update rotating elements physics
    for (const element of this.rotatingElements) {
      // Apply rotation: _rotation = _rotation + vr
      element.sprite.rotation += element.vr * (Math.PI / 180);
      // Decay velocity: vr *= 0.98
      element.vr *= 0.98;
    }

    // Frame 70: Remove shoot animation and start flame
    if (this.frameCount === 70) {
      if (this.shoot) {
        this.shoot.visible = false;
      }
      for (const element of this.rotatingElements) {
        element.sprite.visible = false;
      }
      
      if (this.flame && !this.flameStarted) {
        this.flame.visible = true;
        this.flame.gotoAndPlay(0);
        this.flameStarted = true;
        this.signalHit();
      }
    }

    // Check if flame animation is complete
    if (this.flameStarted && this.flame && this.flame.currentFrame >= 21) {
      this.complete();
    }
  }
}