/**
 * Spell 2916 — (Unknown name, self-buff / caster-anchored effect).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2916/scripts/scripts/
 *
 * displayType=10 (CasterCell). The spell has no projectile, no target-side
 * timeline, and no cellTo references — all content is anchored at the caster.
 * The manifest has a single `animations: ["anim1"]` entry (no librarySymbols),
 * confirming this is a self-buff / aura pattern. The main timeline `frame_13/
 * DoAction.as` contains only `stop()`, which is the canonical caster-aura
 * "hold on frame 13 then stay" pattern.
 *
 * The spell tree is a multi-level nesting of wobble-oscillators:
 *
 *   DefineSprite_8 (outer, 390 frames, anim1):
 *     owns the top-level clip-events:
 *       onLoad: t=0, vent, vy (drift + rise)
 *       onEnterFrame: fade after t>330; drift right (vent); rise (-vy)
 *     frame_388: _parent.removeMovieClip(); stop(); → complete()
 *     contains DefineSprite_7 (child, sinusoidal X sway):
 *       onLoad: i=0, vamp = 0.1*random
 *       onEnterFrame: _X = 10*sin(i += vamp)
 *       contains DefineSprite_6 (grandchild, rotation sway using parent.vamp):
 *         onLoad: a=1.5
 *         onEnterFrame: _rotation = 10*sin(a += _parent.vamp)
 *         contains DefineSprite_4 (great-grandchild, wider rotation using _parent._parent.vamp):
 *           onLoad: a=2
 *           onEnterFrame: _rotation = 15*sin(a += _parent._parent.vamp)
 *           contains DefineSprite_3 (great-great-grandchild, widest rotation using _parent._parent._parent.vamp):
 *             onLoad: a=5
 *             onEnterFrame: _rotation = 20*sin(a += _parent._parent._parent.vamp)
 *
 * Since all these DefineSprites are baked into the single `anim1` composite
 * animation (no separate librarySymbols), the visual is driven entirely by the
 * pre-rendered anim1 frames. The runtime registers `anim1` as a single symbol
 * whose timeline carries the wobble physics described above. We attach it at
 * root with the canonical onLoad/onEnterFrame/frameScripts.
 *
 * signalHit: fired at the entry frame (frame_1 / index 0) since this is a
 * caster self-buff — the "hit" (buff application) happens immediately.
 *
 * complete: fired from the frameScript at index 387 (AS frame_388), which is
 * the canonical `_parent.removeMovieClip(); stop();`.
 *
 * Library symbols: none (librarySymbols[] is empty in manifest).
 * The `anim1` texture prefix has NO `lib_` prefix.
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

const ANIM1_BOUNDS = {
  width: 15.15,
  height: 35.45,
  offsetX: -7,
  offsetY: -53.15,
};

export class Spell2916 extends RuntimeSpell {
  readonly spellId = 2916;
  readonly displayType = SpellDisplayType.CasterCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — outer 390-frame wobble-drift composite ----------
    // The entire spell visual is one composite clip. The canonical AS
    // nests DefineSprite_7 → DefineSprite_6 → DefineSprite_4 →
    // DefineSprite_3 inside DefineSprite_8, all baked into anim1.
    //
    // We model the outermost behaviour (DefineSprite_8's clip events
    // and frame_388 script) directly on this symbol. The inner wobble
    // layers are pre-rendered into the anim1 frame textures, so no
    // separate child attaches are needed at runtime.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 390,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,

      // AS: DefineSprite_8/frame_1/PlaceObject2_7_1/CLIPACTIONRECORD onClipEvent(load).as
      //   t = 0;
      //   vent = 0.16 + 0.16 * Math.random();
      //   vy = 0.33 + 0.33 * Math.random();
      onLoad: (clip) => {
        clip.vars.t = 0;
        clip.vars.vent = 0.16 + 0.16 * Math.random();
        clip.vars.vy = 0.33 + 0.33 * Math.random();
      },

      // AS: DefineSprite_8/frame_1/PlaceObject2_7_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
      //   if(t++ > 330) { _alpha = _alpha - 1.67; }
      //   _X = _X + vent;
      //   _Y = _Y - vy;
      onEnterFrame: (clip) => {
        let t = clip.vars.t as number;
        const vent = clip.vars.vent as number;
        const vy = clip.vars.vy as number;

        if (t++ > 330) {
          clip.alpha = clip.alpha - 1.67 / 100;
        }
        clip.x = clip.x + vent;
        clip.y = clip.y - vy;

        clip.vars.t = t;
      },

      frameScripts: new Map([
        [
          // AS: frame_13/DoAction.as → stop()
          // Main timeline stop at frame 13 (0-based index 12).
          // This holds the outer timeline; the inner DefineSprite_8
          // continues ticking independently. We mirror the stop() here
          // so the root clip halts at frame 12 (AS frame 13).
          // NOTE: This frameScript is on the ROOT symbol (anim1 IS the
          // outer content). In canonical AS the main timeline stops at
          // frame 13; the DefineSprite_8 content keeps playing.
          // We also fire signalHit here — the buff applies immediately
          // on the caster.
          12,
          (clip) => {
            // AS: frame_13/DoAction.as — stop()
            clip.stop();
            this.runtime.signalHit();
          },
        ],
        [
          // AS: DefineSprite_8/frame_388/DoAction.as
          //   _parent.removeMovieClip();
          //   stop();
          387,
          (clip) => {
            clip.stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Main timeline has no SOMA.playSound call (no sound in manifest.scripts).
    // Attach the anim1 composite at root so it starts ticking from the next
    // runtime frame, mirroring the canonical placement of DefineSprite_8 on
    // the main timeline.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
