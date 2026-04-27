/**
 * Spell 1201 — (Unknown name, likely a fire/explosion impact spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1201/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has a single composite animation
 * (sprite_39) that plays at the target cell. There are no projectile symbols
 * (no `move`/`shoot`/`duplicate`), no caster-anchored content, and no
 * `_parent.cellFrom`/`_parent.cellTo` dual-anchor logic. The sprite_39
 * timeline is the entire spell — it positions itself at the target via the
 * TargetCell harness anchor.
 *
 * Library symbols (from manifest — note: manifest has no `librarySymbols[]`
 * entries; only `animations[]` with sprite_39):
 *   None registered via attachMovie in the top-level harness sense. However,
 *   the sprite_39 timeline itself references two inner DefineSprite symbols
 *   that it attachMovie's: DefineSprite_21 and DefineSprite_20. These are
 *   inner children within sprite_39's authored timeline, NOT in the
 *   manifest's librarySymbols[]. Since the manifest has no librarySymbols[]
 *   entries, we model sprite_39 as the single top-level symbol and inline
 *   the DefineSprite_21 / DefineSprite_20 behavior as named symbols
 *   registered in the registry (with `frames: []` since they have no
 *   independent texture assets in the manifest).
 *
 * Canonical symbol layout:
 *   - sprite_39 (117 frames, composite): main animation at target.
 *       frame_1:  _rotation = _parent.angle + 90  (orient toward caster).
 *       frame_4:  SOMA.playSound("explosion") — but this is in manifest
 *                 `sounds[0]` at frame 3 (0-based = 3), and also in the
 *                 DefineSprite_39/frame_4/DoAction.as (1-based = 4 → 0-based = 3).
 *       frame_115: _parent.removeMovieClip() → complete.
 *   - DefineSprite_21 (smoke puff particle, inner):
 *       frame_1 DoAction: seeds _X, vy, va, va2, _alpha=0, _rotation.
 *       onEnterFrame: alpha fade-in with va2 decay, Y drift upward with friction.
 *   - DefineSprite_20 (swinging debris particle, inner):
 *       frame_1 DoAction: seeds i, amp, vr; onEnterFrame oscillates Y.
 *
 * NOTE: The manifest has no librarySymbols[] entries (only animations[]).
 * sprite_39 is the bare animation key (no `lib_` prefix). DefineSprite_21
 * and DefineSprite_20 have no texture assets in the manifest (they are
 * sub-symbol containers within the composite sprite_39 render). We register
 * them with `frames: []` so attach() can create SpellClip nodes that run
 * their frame scripts and clip events.
 *
 * Main timeline: frame_2/DoAction.as → stop(). This means the outer SWF
 * stops at frame 2. We model this by attaching sprite_39 in onSpellStart
 * and letting it drive the spell to completion.
 *
 * signalHit: fired at sprite_39 frame_4 (the explosion sound frame — canonical
 * impact moment), i.e. frameScripts index 3.
 * complete: fired at sprite_39 frame_115 (0-based index 114).
 */

import type {
  SpellCallbacks,
  SpellContext,
  SpellTextureProvider,
  SymbolDefinition,
} from "@dofus/spell-runtime";
import {
  RuntimeSpell,
  SpellDisplayType,
  calculateAnchor,
} from "@dofus/spell-runtime";

const SPRITE_39_BOUNDS = {
  width: 202,
  height: 233.3,
  offsetX: -98.75,
  offsetY: -157.75,
};

export class Spell1201 extends RuntimeSpell {
  readonly spellId = 1201;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite39Sym!: SymbolDefinition;
  private defineSprite21Sym!: SymbolDefinition;
  private defineSprite20Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite39Anchor = calculateAnchor(SPRITE_39_BOUNDS);

    // ---- DefineSprite_21 — smoke puff particle -------------------
    // AS: scripts/DefineSprite_21/frame_1/DoAction.as
    // Seeded in frame_1 DoAction; onEnterFrame drives alpha + Y motion.
    this.defineSprite21Sym = {
      name: "ds21",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip, ctx) => {
        // AS DefineSprite_21/frame_1/DoAction.as:
        //   _X = 20 * (-0.5 + Math.random());
        //   vy = 1 + 1.67 * Math.random();
        //   va = 1 + random(1.67);
        //   _alpha = 0;
        //   va2 = 20;
        //   _rotation = - _parent._parent.angle + 90;
        clip.x = 20 * (-0.5 + Math.random());
        clip.vars.vy = 1 + 1.67 * Math.random();
        clip.vars.va = 1 + Math.floor(Math.random() * 1.67);
        clip.alpha = 0;
        clip.vars.va2 = 20;
        // _parent._parent is sprite_39's parent = root; root.vars.angle is in degrees (canonical)
        const root = clip.parent?.parent;
        const angleDeg = (root?.vars.angle as number) ?? 0;
        clip.rotation = ((-angleDeg + 90) * Math.PI) / 180;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_21/frame_1/DoAction.as onEnterFrame:
        //   _alpha = _alpha - va;
        //   _alpha = _alpha + va2;
        //   vy *= 0.97;
        //   va2 *= 0.8;
        //   _Y = _Y - vy;
        let alphaPct = clip.alpha * 100;
        const va = clip.vars.va as number;
        let va2 = clip.vars.va2 as number;
        let vy = clip.vars.vy as number;

        alphaPct = alphaPct - va;
        alphaPct = alphaPct + va2;
        // Clamp alpha to [0,100] range before storing as 0-1
        if (alphaPct < 0) {
          alphaPct = 0;
        }
        if (alphaPct > 100) {
          alphaPct = 100;
        }
        clip.alpha = alphaPct / 100;

        vy *= 0.97;
        va2 *= 0.8;
        clip.y = clip.y - vy;

        clip.vars.vy = vy;
        clip.vars.va2 = va2;
      },
    };

    // ---- DefineSprite_20 — swinging debris particle --------------
    // AS: scripts/DefineSprite_20/frame_1/DoAction.as
    // Seeded in frame_1 DoAction; onEnterFrame oscillates Y with decaying vr.
    this.defineSprite20Sym = {
      name: "ds20",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_20/frame_1/DoAction.as:
        //   i = -10 * Math.random();
        //   amp = 15 + 5 * Math.random();
        //   vr = 0.067;
        clip.vars.i = -10 * Math.random();
        clip.vars.amp = 15 + 5 * Math.random();
        clip.vars.vr = 0.067;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_20/frame_1/DoAction.as onEnterFrame:
        //   vr *= 0.95;
        //   _Y = amp * Math.sin(i += vr);
        //   this.swapDepths(Math.round(1000 * Math.cos(i)));
        let vr = clip.vars.vr as number;
        let i = clip.vars.i as number;
        const amp = clip.vars.amp as number;

        vr *= 0.95;
        i += vr;
        clip.y = amp * Math.sin(i);
        // swapDepths is a depth-sort call — not directly supported in the
        // SpellClip API; omit as it only affects render order, not behavior.

        clip.vars.vr = vr;
        clip.vars.i = i;
      },
    };

    // ---- sprite_39 — main 117-frame composite at target ----------
    // AS: scripts/DefineSprite_39/frame_1/DoAction.as
    //       _rotation = _parent.angle + 90;
    // AS: scripts/DefineSprite_39/frame_4/DoAction.as
    //       SOMA.playSound("explosion");
    // AS: scripts/DefineSprite_39/frame_115/DoAction.as
    //       _parent.removeMovieClip();
    //
    // NOTE: Since manifest has no librarySymbols[], use bare key "sprite_39"
    // (not "lib_sprite_39") for textures.getFrames.
    this.sprite39Sym = {
      name: "sprite_39",
      totalFrames: 117,
      frames: textures.getFrames("sprite_39"),
      anchorX: sprite39Anchor.x,
      anchorY: sprite39Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_39/frame_1/DoAction.as:
            //   _rotation = _parent.angle + 90;
            const root = clip.parent;
            const angleDeg = (root?.vars.angle as number) ?? 0;
            clip.rotation = ((angleDeg + 90) * Math.PI) / 180;
          },
        ],
        [
          3,
          (_clip) => {
            // AS DefineSprite_39/frame_4/DoAction.as:
            //   SOMA.playSound("explosion");
            // Sound is also listed in manifest sounds[0] at frame 3.
            // We fire signalHit here — the explosion frame is the canonical impact moment.
            this.runtime.signalHit();
            // Sound is played via onSpellStart (manifest sounds entry);
            // the per-frame sound call here is delegated to the stored callback.
            if (this.soundCallback) {
              this.soundCallback("explosion");
            }
          },
        ],
        [
          114,
          (clip) => {
            // AS DefineSprite_39/frame_115/DoAction.as:
            //   _parent.removeMovieClip();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.defineSprite21Sym);
    this.registry.register(this.defineSprite20Sym);
    this.registry.register(this.sprite39Sym);
  }

  private soundCallback?: (id: string) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Store callback for use inside frame scripts (frame_4 plays "explosion").
    this.soundCallback = callbacks.playSound;

    // Main timeline frame_2/DoAction.as: stop();
    // The outer SWF stops at frame 2 — meaning it placed sprite_39 on frame_1
    // and stopped. We attach sprite_39 here so it starts ticking from the
    // next runtime frame.
    this.root.attach(this.sprite39Sym, "sprite_39", 1, context);
  }
}
