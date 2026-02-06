# Generate TypeScript Spell Implementation

## CRITICAL REQUIREMENT
The implementation must behave **EXACTLY** as the original ActionScript describes. No approximations, no "improvements", no deviations. Copy formulas exactly, use the same frame timings, replicate the same randomization patterns.

## Task
Generate a TypeScript spell animation implementation for spell ID: **{SPELL_ID}**

## Input Data Location
- **Manifest**: `tools/combat-exporter/output/spell-anims/{SPELL_ID}/manifest.json`
- **ActionScript files**: `tools/combat-exporter/output/spell-anims/{SPELL_ID}/scripts/`
- **Output file**: `tools/combat-exporter/test-player/src/spells/spell-{SPELL_ID}.ts`

## Reference Examples
Study these existing implementations for patterns:
- `tools/combat-exporter/test-player/src/spells/base-spell.ts` - Base class with AnimationManager
- `tools/combat-exporter/test-player/src/spells/spell-909.ts` - Beam spell with particles
- `tools/combat-exporter/test-player/src/spells/spell-1005.ts` - Radial effect with randomized instances

## Required Imports
```typescript
import { Texture } from 'pixi.js';  // Or Container if needed
import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  ASParticleSystem,  // If spell uses attachMovie for particles
  calculateAnchor,
  decomposeFlashTransform,  // If spell has transform matrices
  type SpriteManifest,
  type FlashTransform,  // If needed
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';
```

## Implementation Steps

1. **Read the CLAUDE.md guide** at `tools/combat-exporter/test-player/src/spells/CLAUDE.md`

2. **Read the manifest.json** to understand:
   - Animation sprites (name, frameCount, width, height, offsetX, offsetY)
   - Library symbols (for attachMovie calls)
   - Sounds data

3. **Read ALL ActionScript files** in the scripts directory - **THIS IS THE SOURCE OF TRUTH**:
   - Frame timing (when sounds play, when hit occurs, when animation stops)
   - Particle spawning logic (count based on level, physics) - **copy formulas EXACTLY**
   - Transform/positioning logic
   - Randomization patterns - **replicate exact ranges**

4. **Create the TypeScript class** following this structure:
   ```typescript
   /**
    * Spell {SPELL_ID} - {SPELL_NAME}
    *
    * {DESCRIPTION OF WHAT THE SPELL DOES}
    *
    * Components:
    * - {List sprite components and their roles}
    *
    * Original AS timing:
    * - Frame X: {What happens}
    */

   import { Texture } from 'pixi.js';
   import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
   import { ... } from '../../../spell-utils';
   import { BaseSpell, type SpellInitContext } from './base-spell';

   // Sprite manifests (from extraction)
   const SPRITE_MANIFEST: SpriteManifest = {
     width: ...,
     height: ...,
     offsetX: ...,
     offsetY: ...,
   };

   export class Spell{SPELL_ID} extends BaseSpell {
     readonly spellId = {SPELL_ID};

     private myAnim!: FrameAnimatedSprite;

     protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
       // Use this.anims.add() to register animations
       // Use init.scale, init.angleRad, init.casterY, init.targetX, init.targetY
       // Use this.callbacks for sound/events
       // Use this.signalHit() for hit signal (auto-guarded)
     }

     update(deltaTime: number): void {
       if (this.done) {
         return;
       }

       this.anims.update(deltaTime);

       // Check completion
       if (this.anims.allComplete()) {
         this.complete();
       }
     }

     // Only override destroy() if you have extra resources (particles, etc.)
     destroy(): void {
       this.particles.destroy();
       super.destroy();
     }
   }
   ```

## Key Patterns to Follow

### Frame Indexing
- ActionScript frames are 1-indexed, TypeScript uses 0-indexed
- AS `gotoAndPlay(7)` becomes frame index 6 in TypeScript
- AS `stop()` at frame 43 means `stopAt(42)` in TypeScript
- Use frame numbers inline, not as constants

### BaseSpell Features
- `init` parameter provides: `scale`, `angleRad`, `casterY`, `targetX`, `targetY`
- `this.anims.add()` - Register animations for batch update/destroy
- `this.anims.update(deltaTime)` - Update all animations at once
- `this.anims.allComplete()` / `this.anims.allStopped()` - Check completion
- `this.signalHit()` - Auto-guarded hit signal (only fires once)
- `this.complete()` - Auto-guarded completion (only fires once)
- `super.destroy()` - Handles animations and container cleanup

### Positioning
- `init.scale` - Pre-calculated 1/EXTRACTION_SCALE
- `init.casterY` - SPELL_CONSTANTS.Y_OFFSET
- `init.targetX` / `init.targetY` - Target position relative to caster
- `init.angleRad` - Angle in radians

### Particle Systems (for attachMovie patterns)
```typescript
// AS: attachMovie("cercle", "cercle" + i, i)
const particleTexture = textures.getFrames('lib_cercle')[0] ?? Texture.EMPTY;
this.particles = new ASParticleSystem(particleTexture);

// Spawn with AS physics converted:
this.particles.spawnMany(count, () => ({
  x: ..., y: ...,
  vx: ..., vy: ...,
  // etc.
}));
```

### Sound Triggers
```typescript
.onFrame(1, () => this.callbacks.playSound('sound_id'))
```

### Hit Signal
```typescript
.onFrame(12, () => this.signalHit())
```

### Completion
```typescript
// In update()
if (this.anims.allComplete() && !this.particles.hasAliveParticles()) {
  this.complete();
}
```

## Code Style Requirements
- No inline ifs (use block form with braces)
- Proper spacing between logical sections
- No frame number constants (use inline numbers with comments)
- No reset() method needed

## Validation Checklist
- [ ] Extends BaseSpell
- [ ] Uses this.anims.add() for all FrameAnimatedSprite instances
- [ ] Uses this.signalHit() instead of direct callbacks.onHit()
- [ ] Uses this.complete() instead of setting done manually
- [ ] All sprite manifests match the extracted data
- [ ] Frame numbers are correctly converted from 1-indexed to 0-indexed
- [ ] Sound triggers are at the correct frames
- [ ] Hit signal is called at the appropriate time
- [ ] Completion is signaled when all animations finish
- [ ] Particle physics match the original AS logic exactly
- [ ] Positioning uses init.targetX/targetY correctly
- [ ] No inline ifs
