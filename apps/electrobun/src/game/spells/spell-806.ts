/**
 * Spell 806 — Vlad (Sacrieur self-buff / impact).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/806/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no projectile, no caster reference,
 * no `_parent.cellFrom` / `_parent.cellTo` world-absolute positioning, and no
 * `move`/`shoot`/`duplicate` symbols. It is a pure impact animation at the target
 * cell. All authored children are container-only timelines with frame scripts.
 *
 * Manifest has no `librarySymbols[]` — all content lives in the `animations[]`
 * list as a single `anim1` entry (5-frame composite). The DefineSprite_* scripts
 * are inner symbols driven from the main timeline's authored placement; since
 * they have no explicit `attachMovie` calls we treat them as container-only
 * inner sprites wired from `onSpellStart`.
 *
 * Symbol layout (from manifest scripts[] + AS source):
 *
 *   DefineSprite_6  — impact flash composite (19 frames).
 *                     frame_1a: SOMA.playSound("punch").
 *                     frame_1b: seeds t = random(parent.t) + parent.t,
 *                               scaleX=scaleY=0, onEnterFrame scales up
 *                               then decays (t /= 1.6).
 *                     frame_19: stop().
 *
 *   DefineSprite_7  — variant A timeline (91 frames).
 *                     frame_1: t = 7.
 *                     frame_22: this.end() → signalHit.
 *                     frame_91: _parent._parent.removeMovieClip → complete.
 *
 *   DefineSprite_8  — variant B timeline (106 frames).
 *                     frame_1: t = 11.
 *                     frame_64: this.end() → signalHit.
 *                     frame_106: _parent._parent.removeMovieClip → complete.
 *
 *   DefineSprite_9  — variant C timeline (118 frames).
 *                     frame_1: t = 20.
 *                     frame_79: this.end() → signalHit.
 *                     frame_118: _parent._parent.removeMovieClip → complete.
 *
 *   DefineSprite_10 — variant D timeline (121 frames).
 *                     frame_1: t = 25.
 *                     frame_79: this.end() → signalHit.
 *                     frame_121: _parent._parent.removeMovieClip → complete.
 *
 *   DefineSprite_11 — variant E timeline (121 frames).
 *                     frame_1: t = 33.
 *                     frame_79: this.end() → signalHit.
 *                     frame_121: _parent._parent.removeMovieClip → complete.
 *
 *   DefineSprite_3  — rotation/alpha decoration.
 *                     frame_1: _rotation = random(360); _alpha = 50.
 *
 *   DefineSprite_12 — level-selector child.
 *                     frame_1: gotoAndStop(_parent.level) → jumps to
 *                     the level-indexed frame, which contains the
 *                     appropriate variant sprite (7/8/9/10/11) on its
 *                     authored timeline.
 *
 * The main timeline (frame_1/DoAction.as): SOMA.playSound("vlad_806").
 *
 * Because we cannot statically introspect which variant frame DefineSprite_12
 * jumps to (it depends on level at runtime), we implement DefineSprite_12 as a
 * dispatcher: frame_1 calls gotoAndStop(level - 1), and each level-frame
 * (0-indexed 0..4 for levels 1..5) attaches the corresponding variant symbol.
 * Only ONE variant is active per spell cast.
 *
 * signalHit is fired by the active variant's "this.end()" frame.
 * complete() is fired by the active variant's final removal frame.
 * The anim1 texture is used for DefineSprite_3 visual frames.
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

// anim1 bounds from manifest animations[0]
const ANIM1_BOUNDS = {
  width: 238.25,
  height: 242.35,
  offsetX: -84.65,
  offsetY: -144.45,
};

export class Spell806 extends RuntimeSpell {
  readonly spellId = 806;
  readonly displayType = SpellDisplayType.TargetCell;

  // Hold symbol refs for cross-symbol attaches from DefineSprite_12
  private sprite6Sym!: SymbolDefinition;
  private sprite7Sym!: SymbolDefinition;
  private sprite8Sym!: SymbolDefinition;
  private sprite9Sym!: SymbolDefinition;
  private sprite10Sym!: SymbolDefinition;
  private sprite11Sym!: SymbolDefinition;
  private sprite3Sym!: SymbolDefinition;
  private sprite12Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);
    const anim1Frames = textures.getFrames("anim1");

    // ----------------------------------------------------------------
    // DefineSprite_3 — rotation/alpha decoration
    // AS DefineSprite_3/frame_1/DoAction.as:
    //   _rotation = random(360);
    //   _alpha = 50;
    // ----------------------------------------------------------------
    this.sprite3Sym = {
      name: "sprite3",
      totalFrames: 5,
      frames: anim1Frames,
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_3/frame_1/DoAction.as
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
            clip.alpha = 50 / 100;
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // DefineSprite_6 — impact flash (19 frames)
    // AS DefineSprite_6/frame_1/DoAction.as  → playSound("punch")
    // AS DefineSprite_6/frame_1/DoAction_2.as → seed t, scale 0, onEnterFrame
    // AS DefineSprite_6/frame_19/DoAction.as  → stop()
    // ----------------------------------------------------------------
    this.sprite6Sym = {
      name: "sprite6",
      totalFrames: 19,
      frames: anim1Frames.slice(0, Math.min(5, anim1Frames.length)),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_6/frame_1/DoAction_2.as
        // t = random(_parent.t) + _parent.t
        const parentT = (clip.parent?.vars.t as number) ?? 10;
        const t = Math.floor(Math.random() * parentT) + parentT;
        clip.vars.t = t;
        clip.scaleX = 0;
        clip.scaleY = 0;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_6/frame_1/DoAction_2.as onEnterFrame
        let t = clip.vars.t as number;
        clip.scaleX = clip.scaleX + t / 100;
        clip.scaleY = clip.scaleY + t / 100;
        t = t / 1.6;
        clip.vars.t = t;
      },
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_6/frame_1/DoAction.as — sound is played
            // from onSpellStart (main timeline), but the canonical AS
            // also fires SOMA.playSound("punch") here inside sprite6.
            // We capture the callback via a stored ref set in onSpellStart.
            // Use the spell-level sound callback if available.
            const soundFn = (ctx as unknown as { _soundFn?: (id: string) => void })._soundFn;
            if (soundFn) {
              soundFn("punch");
            }
          },
        ],
        [
          18,
          (clip) => {
            // AS DefineSprite_6/frame_19/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // DefineSprite_7 — variant A (91 frames, t=7)
    // AS DefineSprite_7/frame_1/DoAction.as  → t = 7
    // AS DefineSprite_7/frame_22/DoAction.as → this.end() → signalHit
    // AS DefineSprite_7/frame_91/DoAction.as → _parent._parent.removeMovieClip()
    // ----------------------------------------------------------------
    this.sprite7Sym = {
      name: "sprite7",
      totalFrames: 91,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_7/frame_1/DoAction.as: t = 7
            clip.vars.t = 7;
            // Attach the impact flash sprite6 inside this variant
            clip.attach(this.sprite6Sym, "sprite6", 1, ctx);
          },
        ],
        [
          21,
          () => {
            // AS DefineSprite_7/frame_22/DoAction.as: this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          90,
          (clip) => {
            // AS DefineSprite_7/frame_91/DoAction.as:
            // _parent._parent.removeMovieClip() — outer mc removal
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // DefineSprite_8 — variant B (106 frames, t=11)
    // AS DefineSprite_8/frame_1/DoAction.as   → t = 11
    // AS DefineSprite_8/frame_64/DoAction.as  → this.end() → signalHit
    // AS DefineSprite_8/frame_106/DoAction.as → _parent._parent.removeMovieClip()
    // ----------------------------------------------------------------
    this.sprite8Sym = {
      name: "sprite8",
      totalFrames: 106,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_8/frame_1/DoAction.as: t = 11
            clip.vars.t = 11;
            clip.attach(this.sprite6Sym, "sprite6", 1, ctx);
          },
        ],
        [
          63,
          () => {
            // AS DefineSprite_8/frame_64/DoAction.as: this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          105,
          (clip) => {
            // AS DefineSprite_8/frame_106/DoAction.as:
            // _parent._parent.removeMovieClip()
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // DefineSprite_9 — variant C (118 frames, t=20)
    // AS DefineSprite_9/frame_1/DoAction.as   → t = 20
    // AS DefineSprite_9/frame_79/DoAction.as  → this.end() → signalHit
    // AS DefineSprite_9/frame_118/DoAction.as → _parent._parent.removeMovieClip()
    // ----------------------------------------------------------------
    this.sprite9Sym = {
      name: "sprite9",
      totalFrames: 118,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_9/frame_1/DoAction.as: t = 20
            clip.vars.t = 20;
            clip.attach(this.sprite6Sym, "sprite6", 1, ctx);
          },
        ],
        [
          78,
          () => {
            // AS DefineSprite_9/frame_79/DoAction.as: this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          117,
          (clip) => {
            // AS DefineSprite_9/frame_118/DoAction.as:
            // _parent._parent.removeMovieClip()
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // DefineSprite_10 — variant D (121 frames, t=25)
    // AS DefineSprite_10/frame_1/DoAction.as   → t = 25
    // AS DefineSprite_10/frame_79/DoAction.as  → this.end() → signalHit
    // AS DefineSprite_10/frame_121/DoAction.as → _parent._parent.removeMovieClip()
    // ----------------------------------------------------------------
    this.sprite10Sym = {
      name: "sprite10",
      totalFrames: 121,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_10/frame_1/DoAction.as: t = 25
            clip.vars.t = 25;
            clip.attach(this.sprite6Sym, "sprite6", 1, ctx);
          },
        ],
        [
          78,
          () => {
            // AS DefineSprite_10/frame_79/DoAction.as: this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          120,
          (clip) => {
            // AS DefineSprite_10/frame_121/DoAction.as:
            // _parent._parent.removeMovieClip()
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // DefineSprite_11 — variant E (121 frames, t=33)
    // AS DefineSprite_11/frame_1/DoAction.as   → t = 33
    // AS DefineSprite_11/frame_79/DoAction.as  → this.end() → signalHit
    // AS DefineSprite_11/frame_121/DoAction.as → _parent._parent.removeMovieClip()
    // ----------------------------------------------------------------
    this.sprite11Sym = {
      name: "sprite11",
      totalFrames: 121,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_11/frame_1/DoAction.as: t = 33
            clip.vars.t = 33;
            clip.attach(this.sprite6Sym, "sprite6", 1, ctx);
          },
        ],
        [
          78,
          () => {
            // AS DefineSprite_11/frame_79/DoAction.as: this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          120,
          (clip) => {
            // AS DefineSprite_11/frame_121/DoAction.as:
            // _parent._parent.removeMovieClip()
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // DefineSprite_12 — level dispatcher
    // AS DefineSprite_12/frame_1/DoAction.as:
    //   gotoAndStop(_parent.level)
    //
    // The canonical AS jumps to frame N == level (1-based), where each
    // frame on the authored timeline contains one of the variant sprites
    // (sprite7..sprite11) as an authored child. We model this as:
    //   frame_1 reads level from parent.vars, then gotoAndStop(level-1),
    //   and frames 0..4 each attach the matching variant symbol.
    // ----------------------------------------------------------------
    this.sprite12Sym = {
      name: "sprite12",
      totalFrames: 6,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_12/frame_1/DoAction.as:
            // gotoAndStop(_parent.level)
            // _parent here is the root (displayType=11 anchor = target).
            const level = (clip.parent?.vars.level as number) ?? 1;
            // gotoAndStop(level) → 0-based index = level - 1
            clip.gotoAndStop(Math.max(1, Math.min(level, 5)) - 1);
          },
        ],
        [
          // Level 1 → frame index 0 (= AS frame 1) → sprite7 (t=7, 91 frames)
          // Already handled by frame_1 script above — attach on the resolved frame.
          // We attach the variant symbol in each level frame below.
          0,
          // NOTE: frameScripts is a Map so we cannot have two entries at key 0.
          // The gotoAndStop in the frame_1 script above moves the playhead BEFORE
          // the entry frame fires, so we handle the dispatch inside the single key-0
          // handler using a nested gotoAndStop + immediate attach pattern:
          // (This entry intentionally overrides the previous key-0; see combined handler below.)
          (_clip, _ctx) => { /* replaced by combined handler */ },
        ],
      ]),
    };

    // Re-build sprite12Sym with a proper combined frame_1 dispatcher
    // that both jumps to the level frame AND attaches the right variant.
    this.sprite12Sym = {
      name: "sprite12",
      totalFrames: 6,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_12/frame_1/DoAction.as:
            // gotoAndStop(_parent.level)
            const level = (clip.parent?.vars.level as number) ?? 1;
            const safeLevel = Math.max(1, Math.min(level, 5));

            // Attach the variant that corresponds to this level.
            // Level 1 → sprite7 (t=7)
            // Level 2 → sprite8 (t=11)
            // Level 3 → sprite9 (t=20)
            // Level 4 → sprite10 (t=25)
            // Level 5 → sprite11 (t=33)
            if (safeLevel === 1) {
              clip.attach(this.sprite7Sym, "variant", 1, ctx);
            } else if (safeLevel === 2) {
              clip.attach(this.sprite8Sym, "variant", 1, ctx);
            } else if (safeLevel === 3) {
              clip.attach(this.sprite9Sym, "variant", 1, ctx);
            } else if (safeLevel === 4) {
              clip.attach(this.sprite10Sym, "variant", 1, ctx);
            } else {
              clip.attach(this.sprite11Sym, "variant", 1, ctx);
            }

            // Stop on the level frame (gotoAndStop semantics — stop self).
            clip.gotoAndStop(safeLevel - 1);
          },
        ],
      ]),
    };

    // Register all symbols
    this.registry.register(this.sprite3Sym);
    this.registry.register(this.sprite6Sym);
    this.registry.register(this.sprite7Sym);
    this.registry.register(this.sprite8Sym);
    this.registry.register(this.sprite9Sym);
    this.registry.register(this.sprite10Sym);
    this.registry.register(this.sprite11Sym);
    this.registry.register(this.sprite12Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("vlad_806")
    callbacks.playSound("vlad_806");

    // Store sound callback so sprite6's frame_1 can call "punch".
    // We pass it through context cast as a side-channel since
    // onLoad/frameScripts don't receive callbacks directly.
    // We attach sprite3 (decoration) and sprite12 (level dispatcher)
    // as the main-timeline authored children.

    // Attach the decoration sprite at depth 1
    this.root.attach(this.sprite3Sym, "sprite3", 1, context);

    // Attach the level dispatcher at depth 2 — it will attach the
    // appropriate variant (sprite7..11) which in turn attaches sprite6.
    // We need to pass the sound callback into sprite6's frame_1 script.
    // We use a context extension pattern via root.vars.
    this.root.vars._soundFn = callbacks.playSound.bind(callbacks);

    this.root.attach(this.sprite12Sym, "sprite12", 2, context);
  }
}
