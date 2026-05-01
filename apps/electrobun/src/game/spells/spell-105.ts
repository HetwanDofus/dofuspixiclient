/**
 * Spell 105 — Artillerie (Osamodas / Artilleur).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/105/scripts/scripts/
 *
 * displayType=11 (TargetCell). No projectile, no dual-anchor, no beam.
 * A single animation (DefineSprite_11) at the target cell spawns a ring
 * of "tige" (shaft/cannon) sprites oscillating via a shared angle `i`,
 * alongside a large composite sprite (sprite9) that wraps a multi-frame
 * animated sprite7 with internal clip-event-driven alpha and drift.
 *
 * Layout:
 *   - DefineSprite_11 (sprite11): 241-frame outer container.
 *       frame_1: seeds _parent.i = -π; starts onEnterFrame loop that
 *                attaches up to 20 "tige" clips (every 2 frames, +0.3 rad
 *                each), stopping when c >= 40.
 *       frame_178: this.end() → signalHit.
 *       frame_241: _parent.removeMovieClip() → complete().
 *   - DefineSprite_10 "tige": 1-frame library symbol.
 *       frame_1: positions self using _parent._parent.i (3-level: tige →
 *                sprite11 → root). Sets _X, _Y, _xscale from cos/sin of i.
 *                Conditional: if _Y < 0, sets _alpha.
 *   - DefineSprite_9 "sprite9": 222-frame composite wrapper (directlyDynamic: false).
 *       frame_220: stop(). Contains sprite7 instances placed at various frames.
 *   - DefineSprite_7 "sprite7": 177-frame animated sprite (directlyDynamic: true).
 *       frame_52: gotoAndPlay(random(20) + 52) — random loop within fire frames.
 *       frame_175: stop().
 *       Internal CLIPACTIONRECORD handlers on placed sub-objects:
 *         - PlaceObject2_4_1 at frame_112: onLoad _alpha = random(80)
 *         - PlaceObject2_4_1 at frame_127: onLoad _alpha = random(80)
 *         - PlaceObject2_6_1 at frame_118: onLoad _alpha = random(80)
 *         - PlaceObject2_6_1 at frame_133: onLoad _alpha = random(80)
 *         - PlaceObject2_6_1 at frame_139: onLoad _alpha = random(120);
 *                                          onEnterFrame: _alpha -= 5; _X -= 2
 *
 * Main timeline: SOMA.playSound("arty_105"); (then implicitly sprite11 plays)
 *
 * Library symbols:
 *   - tige — 1-frame cannon shaft. frame_1 positions via parent.i angle.
 *   - sprite7 — 177-frame animated impact; internal clip events randomize alpha
 *               + drive drift on late-placed sub-objects. frame_52 random loop.
 *               frame_175 stop.
 *   - sprite9 — 222-frame wrapper around sprite7; frame_220 stop.
 *   - sprite11 — 241-frame outer container; owns the tige spawn loop +
 *                signalHit at frame_178 + complete at frame_241.
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

// --- Manifest bounds for library symbols ---

const TIGE_BOUNDS = {
  width: 244.6,
  height: 224.85,
  offsetX: -102.55,
  offsetY: -176.7,
};

const SPRITE7_BOUNDS = {
  width: 16.55,
  height: 69.25,
  offsetX: -8.25,
  offsetY: -24.25,
};

const SPRITE9_BOUNDS = {
  width: 344.4,
  height: 224.85,
  offsetX: -144.4,
  offsetY: -175,
};

export class Spell105 extends RuntimeSpell {
  readonly spellId = 105;
  readonly displayType = SpellDisplayType.TargetCell;

  // Symbol references needed across methods
  private tigeSym!: SymbolDefinition;
  private sprite7Sym!: SymbolDefinition;
  private sprite9Sym!: SymbolDefinition;
  private sprite11Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const tigeAnchor = calculateAnchor(TIGE_BOUNDS);
    const sprite7Anchor = calculateAnchor(SPRITE7_BOUNDS);
    const sprite9Anchor = calculateAnchor(SPRITE9_BOUNDS);

    // ---- tige (DefineSprite_10_tige) — 1-frame cannon shaft ----
    // AS: DefineSprite_10_tige/frame_1/DoAction.as
    // Positions self via _parent._parent.i (tige → sprite11 → root.vars.i).
    // _X = 20 * sin(i); _Y = 7 * cos(i); _xscale = 50 * cos(i)
    // if (_Y < 0) { _alpha = 70 * cos(i) + 100 }
    this.tigeSym = {
      name: "tige",
      totalFrames: 1,
      frames: textures.getFrames("lib_tige"),
      anchorX: tigeAnchor.x,
      anchorY: tigeAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_10_tige/frame_1/DoAction.as
            // _parent._parent = sprite11 clip; i is on root (sprite11.parent = root)
            // Walk: clip → sprite11 → root
            const sprite11 = clip.parent;
            const root = sprite11?.parent;
            const i = (root?.vars.i as number) ?? 0;
            clip.x = 20 * Math.sin(i);
            clip.y = 7 * Math.cos(i);
            clip.scaleX = (50 * Math.cos(i)) / 100;
            // scaleY not set by AS — leave at default 1
            if (clip.y < 0) {
              // AS: _alpha = 70 * cos(i) + 100  (Flash 0-100 → TS 0-1)
              clip.alpha = (70 * Math.cos(i) + 100) / 100;
            }
          },
        ],
      ]),
    };

    // ---- sprite7 (DefineSprite_7) — 177-frame animated impact ----
    // directlyDynamic: true. Has internal clip events on sub-objects
    // placed at frames 112, 118, 127, 133, 139 (depth 4 or 6).
    // The sub-objects' CLIPACTIONRECORD behaviors are modeled via
    // phantom SymbolDefinitions with onLoad/onEnterFrame that we
    // attach from sprite7's frameScripts at the appropriate frame.
    //
    // frame_52: gotoAndPlay(random(20) + 52)  → gotoAndPlay(random(20) + 51)
    // frame_175: stop()
    //
    // Sub-object "alpha4" (PlaceObject2_4_1) placed at frames 112 & 127:
    //   onLoad: _alpha = random(80)
    // Sub-object "alpha6a" (PlaceObject2_6_1) placed at frame 118 & 133:
    //   onLoad: _alpha = random(80)
    // Sub-object "alpha6b" (PlaceObject2_6_1) placed at frame 139:
    //   onLoad:      _alpha = random(120)
    //   onEnterFrame: _alpha -= 5; _X -= 2

    // Sub-symbol for depth-4 placed objects (onLoad: random alpha 0-79)
    // AS: DefineSprite_7/frame_112/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load).as
    // AS: DefineSprite_7/frame_127/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load).as
    const subAlpha4Sym: SymbolDefinition = {
      name: "_sub_alpha4",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS: _alpha = random(80)  → 0-79 in AS → 0-1 in TS
        clip.alpha = Math.floor(Math.random() * 80) / 100;
      },
    };

    // Sub-symbol for depth-6 placed objects (onLoad: random alpha 0-79)
    // AS: DefineSprite_7/frame_118/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(load).as
    // AS: DefineSprite_7/frame_133/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(load).as
    const subAlpha6Sym: SymbolDefinition = {
      name: "_sub_alpha6",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS: _alpha = random(80)
        clip.alpha = Math.floor(Math.random() * 80) / 100;
      },
    };

    // Sub-symbol for depth-6 at frame_139 (onLoad: random 0-119; drifts left + fades)
    // AS: DefineSprite_7/frame_139/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(load).as
    // AS: DefineSprite_7/frame_139/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    const subDrift6Sym: SymbolDefinition = {
      name: "_sub_drift6",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS: _alpha = random(120)
        clip.alpha = Math.floor(Math.random() * 120) / 100;
      },
      onEnterFrame: (clip) => {
        // AS: _alpha = _alpha - 5; _X = _X - 2
        clip.alpha -= 5 / 100;
        clip.x -= 2;
        // Remove when fully transparent
        if (clip.alpha <= 0) {
          clip.remove();
        }
      },
    };

    this.sprite7Sym = {
      name: "sprite7",
      totalFrames: 177,
      frames: textures.getFrames("lib_sprite7"),
      anchorX: sprite7Anchor.x,
      anchorY: sprite7Anchor.y,
      frameScripts: new Map([
        [
          51,
          (clip, ctx) => {
            // AS: DefineSprite_7/frame_52/DoAction.as
            // gotoAndPlay(random(20) + 52) — AS 1-based → 0-based: random(20) + 51
            clip.gotoAndPlay(Math.floor(Math.random() * 20) + 51);
          },
        ],
        [
          111,
          (clip, ctx) => {
            // AS: DefineSprite_7/frame_112/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load)
            // Place sub-object at depth 4 with load-time alpha randomization
            clip.attach(subAlpha4Sym, "sub_d4_112", 4, ctx);
          },
        ],
        [
          117,
          (clip, ctx) => {
            // AS: DefineSprite_7/frame_118/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(load)
            // Place sub-object at depth 6 with load-time alpha randomization
            clip.attach(subAlpha6Sym, "sub_d6_118", 6, ctx);
          },
        ],
        [
          126,
          (clip, ctx) => {
            // AS: DefineSprite_7/frame_127/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load)
            // Place sub-object at depth 4 with load-time alpha randomization (replaces existing)
            clip.attach(subAlpha4Sym, "sub_d4_127", 4, ctx);
          },
        ],
        [
          132,
          (clip, ctx) => {
            // AS: DefineSprite_7/frame_133/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(load)
            // Place sub-object at depth 6 with load-time alpha randomization (replaces existing)
            clip.attach(subAlpha6Sym, "sub_d6_133", 6, ctx);
          },
        ],
        [
          138,
          (clip, ctx) => {
            // AS: DefineSprite_7/frame_139/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(load+enterFrame)
            // Place drifting/fading sub-object at depth 6
            clip.attach(subDrift6Sym, "sub_d6_139", 6, ctx);
          },
        ],
        [
          174,
          (clip) => {
            // AS: DefineSprite_7/frame_175/DoAction.as
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite9 (DefineSprite_9) — 222-frame wrapper (directlyDynamic: false) ----
    // Contains sprite7 via PlaceObject2. The manifest placements show sprite7 (characterId 7)
    // placed inside sprite9 (characterId 9) at frame 0, depth 2, with an initial
    // matrix of translateX=24.75, translateY=-10.15. We attach sprite7 in frame_0.
    // Also the manifest shows a sprite10 (tige/characterId 10) is placed at depth 1
    // inside sprite9 via the placements — but that is sprite9's OWN authored content
    // (it contains a tige instance). Actually looking again:
    // sprite9 placements: parentSpriteId=10 (DefineSprite_10_tige) frame=0 depth=1 matrix scaleX=0.71 translateY=-1.7
    // This means sprite10 (tige) is placed INSIDE sprite9 at depth 1.
    // sprite7 placements: parentSpriteId=9 frame=0 depth=2 matrix translateX=24.75 translateY=-10.15
    // This means sprite7 is placed INSIDE sprite9.
    // frame_220: stop()
    this.sprite9Sym = {
      name: "sprite9",
      totalFrames: 222,
      frames: textures.getFrames("lib_sprite9"),
      anchorX: sprite9Anchor.x,
      anchorY: sprite9Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: PlaceObject2 sprite7 at depth 2, frame 0, inside sprite9
            // matrix: translateX=24.75, translateY=-10.15, scaleX=1, scaleY=1
            clip.attach(this.sprite7Sym, "sprite7_inst", 2, ctx, {
              x: 24.75,
              y: -10.15,
            });
            // AS: PlaceObject2 tige (sprite10) at depth 1, frame 0, inside sprite9
            // matrix: scaleX=0.71014404296875, scaleY=1, translateX=0, translateY=-1.7
            // Tige's frame_1 will reposition itself via _parent._parent.i,
            // but since it's placed inside sprite9 (not sprite11), the
            // traversal path here is different. The canonical AS path for
            // tige placed in sprite9 goes: tige → sprite9 → sprite11.
            // We attach it using tigeSym; its frameScript reads parent?.parent?.vars.i
            // which will be sprite9.parent (= sprite11) → sprite11.parent (= root).
            // Actually tige's frameScript reads: clip.parent (=sprite9) → .parent (=sprite11) → .parent (=root).
            // So root.vars.i is accessed correctly through the 3-level chain.
            const tigeInSprite9: SymbolDefinition = {
              name: "_tige_in_s9",
              totalFrames: 1,
              frames: textures.getFrames("lib_tige"),
              anchorX: tigeAnchor.x,
              anchorY: tigeAnchor.y,
              frameScripts: new Map([
                [
                  0,
                  (tigeClip) => {
                    // AS: DefineSprite_10_tige/frame_1/DoAction.as
                    // _parent._parent here: tige→sprite9→sprite11
                    // i is on sprite11's parent (root), i.e. tige→sprite9→sprite11→root
                    const sprite9clip = tigeClip.parent;
                    const sprite11clip = sprite9clip?.parent;
                    const rootClip = sprite11clip?.parent;
                    const i = (rootClip?.vars.i as number) ?? 0;
                    tigeClip.x = 20 * Math.sin(i);
                    tigeClip.y = 7 * Math.cos(i);
                    tigeClip.scaleX = (50 * Math.cos(i)) / 100;
                    if (tigeClip.y < 0) {
                      tigeClip.alpha = (70 * Math.cos(i) + 100) / 100;
                    }
                  },
                ],
              ]),
            };
            clip.attach(tigeInSprite9, "tige_inst", 1, ctx, {
              x: 0,
              y: -1.7,
            });
          },
        ],
        [
          219,
          (clip) => {
            // AS: DefineSprite_9/frame_220/DoAction.as
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite11 (DefineSprite_11) — 241-frame outer container ----
    // frame_1: _parent.i = -π; c = 0; starts onEnterFrame that attaches
    //          tige clips until c >= 40 (every 2 increments = 20 clips).
    // frame_178: this.end() → signalHit
    // frame_241: _parent.removeMovieClip() → complete
    this.sprite11Sym = {
      name: "sprite11",
      totalFrames: 241,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_11/frame_1/DoAction.as
            // _parent.i = -3.1415  (_parent = root here; sprite11 is attached to root)
            const root = clip.parent;
            if (root) {
              root.vars.i = -3.1415;
            }
            clip.vars.c = 0;
            // The canonical AS installs this.onEnterFrame on sprite11 itself.
            // Each tick: if c < 40, attach tige + increment c by 2, i by 0.3.
            clip.onEnterFrame = (self, innerCtx) => {
              const c = self.vars.c as number;
              if (c < 40) {
                const root2 = self.parent;
                if (root2) {
                  // Increment i first (AS does i += 0.3 each iteration in the loop)
                  const curI = (root2.vars.i as number) ?? -3.1415;
                  root2.vars.i = curI + 0.3;
                }
                self.attach(this.tigeSym, `tige${c}`, c, innerCtx);
                self.vars.c = c + 2;
              }
            };
          },
        ],
        [
          177,
          () => {
            // AS: DefineSprite_11/frame_178/DoAction.as → this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          240,
          (clip) => {
            // AS: DefineSprite_11/frame_241/DoAction.as → _parent.removeMovieClip()
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // Register all symbols
    this.registry.register(this.tigeSym);
    this.registry.register(this.sprite7Sym);
    this.registry.register(this.sprite9Sym);
    this.registry.register(this.sprite11Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS: frame_1/DoAction.as → SOMA.playSound("arty_105")
    callbacks.playSound("arty_105");
    // The main timeline implicitly places sprite11 (DefineSprite_11) at the root.
    // Attach it so it starts ticking from the next runtime frame.
    this.root.attach(this.sprite11Sym, "sprite11", 1, context);
    // sprite9 is also on the main timeline (it is placed via the main anim).
    // Looking at the structure: anim1 (243 frames) is the top-level animation,
    // which is itself rendered as sprite9's composite. But DefineSprite_11 is
    // the outer ActionScript container. The "anim1" textures are the pre-baked
    // frames of the full scene. We do NOT attach sprite9 separately at the root
    // because sprite9 is a child of sprite11 per the AS structure — sprite11's
    // onEnterFrame attaches tige clips, while sprite9 contains the visual
    // animated content. However, looking at the AS scripts:
    //   DefineSprite_11/frame_1: attaches "tige" library symbols
    //   DefineSprite_9: is placed on the MAIN timeline (not inside sprite11)
    // The manifest's "animations" entry "anim1" is the composite of everything.
    // sprite9 appears to be placed on the outer SWF main timeline directly.
    // We attach it at root as a sibling to sprite11.
    this.root.attach(this.sprite9Sym, "sprite9", 2, context);
  }
}
