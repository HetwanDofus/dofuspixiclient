/**
 * Spell 1014 — (Osamodas/Licorne spell, "licrounch").
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1014/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has a single authored timeline
 * (sprite_17, 120 frames) that positions itself at cellTo on frame_1 and
 * drives the full animation. sprite_11 is a library symbol attached inside
 * sprite_17's timeline (not referenced by attachMovie in the scripts we have,
 * but is a 21-frame animation used as authored content within sprite_17 since
 * librarySymbols is empty — it appears only in animations[], so it is a
 * top-level pre-rendered composite). Since there are no `librarySymbols[]`
 * entries and no `attachMovie` calls in the AS scripts, sprite_17 is
 * registered as a self-contained authored timeline, and sprite_11 as a
 * sub-animation.
 *
 * Looking at the scripts:
 *   - sprite_17/frame_1: positions self at _parent.cellTo
 *   - sprite_17/frame_28: plays sound "licrounch_1014"
 *   - sprite_17/frame_88: this.end() → signalHit
 *   - sprite_17/frame_106: plays sound "jump"
 *   - sprite_17/frame_118: _parent.removeMovieClip() → complete
 *   - sprite_11/frame_1: random rotation, scale, random start frame (particle-like reusable clip)
 *   - frame_2/DoAction.as: stop() on main timeline
 *
 * Because `librarySymbols` is empty and both sprite_11 and sprite_17 are in
 * `animations[]` only, we use bare names (no `lib_` prefix) for getFrames.
 *
 * sprite_17 is the main animation container — we attach it from onSpellStart
 * and give it frameScripts for all the canonical DoAction frames.
 *
 * sprite_11 is used inside sprite_17 (it has its own frame_1 script with
 * c-guard random-start logic). Since there is no explicit attachMovie call in
 * sprite_17's scripts for sprite_11, sprite_17 is an isComposite animation
 * whose frames already embed sprite_11's content. The sprite_11 frame_1 script
 * (random rotation / scale / gotoAndPlay) applies to any runtime-attached
 * instances; since sprite_17 has isComposite=true and sprite_11 appears as an
 * authored sub-element, we register sprite_11 as a SymbolDefinition for
 * completeness but the main visual is driven by sprite_17's pre-rendered frames.
 *
 * Sounds are played from within sprite_17's frameScripts since they are part
 * of its authored timeline (the manifest's sounds[] entries indicate frames 27
 * and 105 of the main timeline, matching sprite_17 frame_28 and frame_106 in
 * 1-based terms). We capture callbacks in onSpellStart to use inside frameScripts.
 *
 * Main timeline: frame_2 → stop(). sprite_17 is placed on frame_1 implicitly;
 * we attach it from onSpellStart.
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

// sprite_17 bounds from animations[] (no lib_ prefix — not in librarySymbols)
const SPRITE_17_BOUNDS = {
  width: 107.95,
  height: 85.85,
  offsetX: -21.55,
  offsetY: -79.75,
};

// sprite_11 bounds from animations[]
const SPRITE_11_BOUNDS = {
  width: 75.05,
  height: 1,
  offsetX: 9.7,
  offsetY: -0.5,
};

export class Spell1014 extends RuntimeSpell {
  readonly spellId = 1014;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite17Sym!: SymbolDefinition;
  private sprite11Sym!: SymbolDefinition;
  private soundCallbacks?: SpellCallbacks;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite17Anchor = calculateAnchor(SPRITE_17_BOUNDS);
    const sprite11Anchor = calculateAnchor(SPRITE_11_BOUNDS);

    // ---- sprite_11 — reusable particle/decoration clip -----------
    // AS scripts/DefineSprite_11/frame_1/DoAction.as:
    //   _rotation = random(360);
    //   t = random(50) + 50;
    //   _xscale = t; _yscale = t;
    //   if (c != 1) { c = 1; gotoAndPlay(random(27) + 1); }
    this.sprite11Sym = {
      name: "sprite_11",
      totalFrames: 21,
      frames: textures.getFrames("sprite_11"),
      anchorX: sprite11Anchor.x,
      anchorY: sprite11Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_11/frame_1/DoAction.as
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
            const t = Math.floor(Math.random() * 50) + 50;
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
            const c = clip.vars.c as number | undefined;
            if (c !== 1) {
              clip.vars.c = 1;
              // AS: gotoAndPlay(random(27) + 1) → 1-based → gotoAndPlay(N-1)
              const targetFrame = Math.floor(Math.random() * 27); // random(27)+1 - 1
              clip.gotoAndPlay(targetFrame);
            }
          },
        ],
      ]),
    };

    // ---- sprite_17 — main 120-frame animation at target ----------
    // AS DefineSprite_17/frame_1/DoAction.as:
    //   _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
    // AS DefineSprite_17/frame_28/DoAction.as:
    //   SOMA.playSound("licrounch_1014");
    // AS DefineSprite_17/frame_88/DoAction.as:
    //   this.end(); → signalHit
    // AS DefineSprite_17/frame_106/DoAction.as:
    //   SOMA.playSound("jump");
    // AS DefineSprite_17/frame_118/DoAction.as:
    //   _parent.removeMovieClip(); → complete
    this.sprite17Sym = {
      name: "sprite_17",
      totalFrames: 120,
      frames: textures.getFrames("sprite_17"),
      anchorX: sprite17Anchor.x,
      anchorY: sprite17Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_17/frame_1/DoAction.as
            // For displayType=11 (TargetCell), the container is already anchored
            // at cellTo. The frame_1 script positions self at _parent.cellTo in
            // world coords. Since root.vars.cellTo holds world coords and our
            // container origin IS cellTo (anchor resolved by harness), we set
            // the clip position to world cellTo coords relative to the container
            // origin (which is cellTo itself), i.e. (0, 0) offset from origin.
            // However, the canonical AS assigns _X/_Y to world coords — the clip
            // is a direct child of root whose origin is at cellTo, so the child's
            // local position should be (0, 0) to appear at cellTo.
            // We faithfully set x/y from root.vars.cellTo minus anchor (= 0,0).
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
            // The container origin is at cellTo (TargetCell anchor).
            // In container-local coords, cellTo is (0,0).
            // Setting clip to world cellTo would offset it by the container's
            // world position (cellTo), effectively doubling. We use (0,0).
            if (cellTo) {
              clip.x = 0;
              clip.y = 0;
            }
          },
        ],
        [
          27,
          () => {
            // AS DefineSprite_17/frame_28/DoAction.as
            // SOMA.playSound("licrounch_1014");
            this.soundCallbacks?.playSound("licrounch_1014");
          },
        ],
        [
          87,
          () => {
            // AS DefineSprite_17/frame_88/DoAction.as
            // this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          105,
          () => {
            // AS DefineSprite_17/frame_106/DoAction.as
            // SOMA.playSound("jump");
            this.soundCallbacks?.playSound("jump");
          },
        ],
        [
          117,
          (clip) => {
            // AS DefineSprite_17/frame_118/DoAction.as
            // _parent.removeMovieClip() → complete
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite11Sym);
    this.registry.register(this.sprite17Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture callbacks for use inside frameScripts (sounds played mid-timeline).
    this.soundCallbacks = callbacks;

    // Main timeline frame_1: implicitly places sprite_17 on stage.
    // frame_2/DoAction.as: stop() — main timeline stops after frame 2.
    // We attach sprite_17 so it starts ticking from the next runtime frame.
    this.root.attach(this.sprite17Sym, "sprite17", 1, context);
  }
}
