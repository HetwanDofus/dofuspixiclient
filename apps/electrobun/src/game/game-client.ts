import { create } from "@bufbuild/protobuf";
import { AreaKind, cellsInArea, hasLineOfSight } from "@dofus/grid";
import { match } from "ts-pattern";

import type { Battlefield } from "@/game/scene";
import type { InventoryStore } from "@/game/stores/inventory-store";
import type { CharacterStats } from "@/game/types/stats";
import { AudioManager } from "@/game/audio/audio-manager";
import { derivePasswordKey } from "@/game/auth/pbkdf2";
import { loginActor } from "@/game/machines/actors";
import { spellCastActor } from "@/game/machines/spell-cast.machine";
import { Connection, type ConnectionEvent } from "@/game/network/connection";
import { AuthHandler } from "@/game/network/handlers/auth.handler";
import {
  CharacterHandler,
  type CharacterInfo,
} from "@/game/network/handlers/character.handler";
import { FightHandler } from "@/game/network/handlers/fight.handler";
import { InventoryHandler } from "@/game/network/handlers/inventory.handler";
import { MapHandler } from "@/game/network/handlers/map.handler";
import { SpellHandler } from "@/game/network/handlers/spell.handler";
import {
  createMessageHandler,
  type MessageHandler,
} from "@/game/network/message-handler";
import {
  AccountGetCharactersListSchema,
  AccountGetServersListSchema,
  AccountSelectCharacterSchema,
  AccountSelectServerRequestSchema,
  AccountSendIdentitySchema,
  AccountSendTicketSchema,
  encodeClient,
  GameActionRequestSchema,
  GameCreateRequestSchema,
  ItemDestroyRequestSchema,
  ItemDropRequestSchema,
  ItemMoveRequestSchema,
  ItemUseRequestSchema,
} from "@/game/network/protocol";
import { HighlightType } from "@/game/scene/overlays/cell-highlighter";
import { PlayerAnimation } from "@/game/scene/player/animation";
import { characterStore } from "@/game/stores";
import { fightActor, fightStore } from "@/game/stores/fight-store";
import { spellsStore, tickCooldowns } from "@/game/stores/spells-store";
import { HoverPreview } from "@/hud/fight/hover-preview";
import { createLogger } from "@/utils/logger";

export type { CharacterInfo } from "@/game/network/handlers/character.handler";

export interface GameClientConfig {
  serverUrl?: string;
}

const log = createLogger("GameClient");

/**
 * Composition root for the network layer:
 *   Connection → MessageHandler → per-domain handlers → stores + machines.
 */
export class GameClient {
  private readonly connection: Connection;
  private readonly messageHandler: MessageHandler;
  private readonly audioManager: AudioManager;

  private readonly authHandler: AuthHandler;
  private readonly characterHandler: CharacterHandler;
  private readonly inventoryHandler: InventoryHandler;
  private readonly fightHandler: FightHandler;
  private readonly mapHandler: MapHandler;
  private readonly spellHandler: SpellHandler;

  private battlefield: Battlefield | null = null;
  private hoverPreview: HoverPreview | null = null;

  /**
   * Whether the user is currently rolling over their own avatar in the
   * battlefield. Drives the MP-reachable-range overlay — canonical 1.29
   * paints the green pattern only while the local sprite is hovered
   * (Sprite._rollOver / _rollOut), never on turn entry.
   */
  private selfHovered = false;

  /**
   * Sequencer chain for in-fight visual events. Mirrors the canonical
   * Dofus 1.29 per-sprite Sequencer: GA;100 (damage) actions
   * (popup + `setAnim("Hit")`) are queued AFTER the GA;300
   * (SpellLaunch) actions on the same sequencer, so the recoil +
   * floating number only fire once the cast pose + spell visual have
   * completed. On the wire all those events arrive back-to-back, so
   * without the chain the popup pops the moment the damage frame
   * lands — visibly out of sync with the cast animation.
   *
   * Each onSpellCast resets the chain to that spell's visual-complete
   * promise; onDamage then defers the popup behind the most recent
   * chain, falling through immediately when no spell is in flight.
   */
  private spellSequencer: Promise<void> = Promise.resolve();

  private onConnected?: () => void;
  private onDisconnected?: () => void;

  constructor(config?: GameClientConfig) {
    this.connection = new Connection({
      url: config?.serverUrl ?? "ws://localhost:8080/game",
    });
    this.messageHandler = createMessageHandler();
    this.audioManager = AudioManager.getInstance();
    this.audioManager.init();

    this.authHandler = new AuthHandler(this.messageHandler);
    this.characterHandler = new CharacterHandler(this.messageHandler, {
      onCharacterSelected: (character) => {
        this.battlefield?.setDebugPlayerId(character.id);
      },
    });
    this.inventoryHandler = new InventoryHandler(this.messageHandler);
    this.fightHandler = new FightHandler(
      this.messageHandler,
      this.connection,
      () => this.characterHandler.getCurrentCharacter()?.spriteId ?? null
    );
    this.spellHandler = new SpellHandler(this.messageHandler);
    void this.spellHandler;
    this.mapHandler = new MapHandler(
      this.messageHandler,
      this.connection,
      this.audioManager,
      this.characterHandler,
      () => this.battlefield
    );

    this.connection.addEventListener((event: ConnectionEvent) => {
      match(event)
        .with({ type: "connected" }, () => {
          log.info("Connected");
          // If we connected as part of an authd→gamed pivot, the ticket
          // is queued up; flush it as the first frame so gamed binds the
          // session to our account before any character query.
          if (this.pendingTicket) {
            const ticket = this.pendingTicket;
            this.pendingTicket = null;
            log.info("Sending auth ticket to gamed");
            this.connection.send(
              encodeClient(
                "accountSendTicket",
                create(AccountSendTicketSchema, { ticket })
              )
            );
          }
          this.onConnected?.();
        })
        .with({ type: "disconnected" }, (e) => {
          log.info("Disconnected:", e.reason);
          // Suppress LOGOUT on intentional pivot disconnects — we'll
          // reconnect in a moment to gamed and the auth state must
          // survive the gap.
          if (this.pivotInFlight) {
            this.onDisconnected?.();
            return;
          }
          loginActor.send({ type: "LOGOUT" });
          // The world is gone — so is its music. A pivot disconnect returns
          // above, so the track survives the gamed handoff.
          this.audioManager.stop();
          this.onDisconnected?.();
        })
        .with({ type: "message" }, (e) => {
          this.messageHandler.handle(e.message);
        })
        .otherwise(() => {});
    });

    // Listen for AccountSelectServer success on the SAME message bus the
    // AuthHandler uses; trigger the authd→gamed pivot here so callers
    // don't have to thread payloads through the actor.
    this.messageHandler.on("accountSelectServer", (payload) => {
      if (!payload.success || !payload.ip || !payload.port || !payload.ticket) {
        return;
      }
      this.pivotToGame(payload.ip, payload.port, payload.ticket);
    });

    // After the server confirms our character, request roleplay mode so
    // gamed starts streaming map + sprite data. Dofus 1.29 wire: GC1.
    this.messageHandler.on("accountCharacterSelected", (payload) => {
      if (!payload.success) {
        return;
      }
      log.info("Entering world (GameCreate type=1)");
      this.connection.send(
        encodeClient("gameCreate", create(GameCreateRequestSchema, { type: 1 }))
      );
    });
  }

  // pivotToGame disconnects from authd and reconnects to the gamed
  // address returned in AccountSelectServer. The ticket is queued and
  // sent as the first frame on the new connection.
  private pendingTicket: string | null = null;
  private pivotInFlight = false;
  private pivotToGame(host: string, port: number, ticket: string): void {
    const url = `ws://${host}:${port}/game`;
    log.info(`Pivoting to gamed at ${url}`);
    this.pendingTicket = ticket;
    this.pivotInFlight = true;
    this.connection.disconnect();
    this.connection.setUrl(url);
    // Reconnect on the next tick so the close event lands first.
    setTimeout(() => {
      this.pivotInFlight = false;
      this.connection.connect();
    }, 50);
  }

  setBattlefield(battlefield: Battlefield): void {
    this.battlefield = battlefield;
    battlefield.setOnCellClick((cellId) => this.handleCellClick(cellId));
    // Sole driver of the MP-reachable-range tint: roll-over our own
    // avatar shows the green pattern, roll-out clears it. Replicates
    // canonical Sprite._rollOver / _rollOut from the 1.29 client.
    battlefield.setOnSelfHover((hovered) => {
      this.selfHovered = hovered;
      const ui = this.battlefield?.getFightUI();
      if (!ui) {
        return;
      }
      if (hovered) {
        this.refreshReachableRange();
      } else {
        ui.clearHighlightType("movement");
      }
    });

    // Cell-hover → path / AoE preview. Lives here for the same reason
    // the other fight wiring does: we need pathfinding + current cell
    // + the fight UI overlay, and gameClient already owns the handles.
    this.hoverPreview = new HoverPreview({
      battlefield,
      fightUI: () => this.battlefield?.getFightUI() ?? null,
      pathfinding: () => this.mapHandler.getPathfinding(),
      currentCellId: () => this.mapHandler.getCurrentCellId(),
      isMoving: () => this.mapHandler.isCharacterMoving(),
      mapDimensions: () => {
        const d = this.battlefield?.getCurrentMapData();
        return d ? { width: d.width, height: d.height } : null;
      },
      occupiedCells: () => {
        // Spell LoS / AoE obstruction set. fightStore.fighters is
        // the authoritative roster now that FighterSnapshot flows
        // through applyStats / upsertFighter.
        //
        // Treat hp <= 0 as dead too, in case `dead` ends up false
        // for a clearly-dead fighter — the death `FIGHTER_UPDATE`
        // sets `{ dead: true, hp: 0 }`, but a subsequent
        // `gameTurnMiddle` overwrites the patch with `dead: entry.
        // isDead`, which can momentarily be false on the wire while
        // the corpse is being torn down server-side.
        const out = new Set<number>();
        for (const f of fightStore.getSnapshot().fighters.values()) {
          if (!f.dead && f.hp > 0) {
            out.add(f.cell);
          }
        }
        return out;
      },
      syncOccupied: () => {
        const pf = this.mapHandler.getPathfinding();
        const self = this.mapHandler.getCurrentCellId();
        if (pf && self !== null) {
          this.syncFightOccupiedCells(pf, self);
        }
      },
      losBlocked: (cell: number) =>
        this.battlefield?.isCellLosBlocked(cell) ?? false,
    });

    // Bridge fight network events to the canvas overlays. fightActor
    // already drives enter/exit lifecycle via Battlefield.init's
    // subscription; here we route per-frame visual events.
    this.fightHandler.setHandlers({
      onSpellCast: (payload) => {
        // Drive the cast machine forward the moment the server echoes
        // back our launch (casterId == our sprite id). Opposing-caster
        // launches still play their animation but don't touch the
        // machine — it tracks only *our* cast UX.
        const myIdStr = this.characterHandler.getCurrentCharacter()?.spriteId;
        const myId = myIdStr === undefined ? null : Number(myIdStr);
        if (myId !== null && payload.casterId === myId) {
          const snap = spellCastActor.getSnapshot();
          if (snap.matches("pending")) {
            spellCastActor.send({ type: "SERVER_ACK" });
          }
        }
        // Resolve the caster cell from the world-actor renderer — that
        // is where fighters actually live in this codebase (both during
        // roleplay AND combat). The FightUI's internal PlayerRenderer
        // stays empty, so querying it would always miss and fall
        // through to cell 0. The fight-store fighter snapshot is a
        // last-ditch fallback in case the sprite hasn't been added yet.
        const casterCellId =
          this.battlefield
            ?.getWorldActorRenderer()
            ?.getPlayerCell(payload.casterId) ??
          fightStore.getSnapshot().fighters.get(String(payload.casterId))
            ?.cell ??
          payload.targetCellId;
        // Play the caster's CAST pose, then launch the spell visual
        // ONCE THE POSE COMPLETES. Mirrors canonical SpriteHandler.as
        // launchVisualEffect:
        //   addAction(18, blocking=true, setAnim, [castPose, false, true])
        //   addAction(20, blocking=false, addEffect, [...])
        // The blocking=true flag makes the sequencer wait for setAnim
        // to report completion (= last frame reached) before running
        // the addEffect step. Without this gate the visual fires in
        // parallel with the cast pose, which the user perceives as
        // "no delay before the spell fires".
        const actorRenderer = this.battlefield?.getWorldActorRenderer();
        const fightUI = this.battlefield?.getFightUI();
        // Hit gate — resolves when the spell visual fires its canonical
        // `runtime.signalHit()` (clip/harness.ts LANDED branch for
        // projectile displayTypes 30/31/40/41). For instant spells
        // without a separate hit phase, the runtime never fires this,
        // so the chain falls back to `launchedVisual` completion (or
        // the SEQUENCER_HOLD_CAP_MS cap below).
        let hitFiredResolve!: () => void;
        const hitFired = new Promise<void>((resolve) => {
          hitFiredResolve = resolve;
        });
        const launchSpellVisual = (): Promise<void> | undefined =>
          fightUI?.playSpell({
            // visualGfxId comes from the server's GA;300 param3 (the
            // SWF filename / sorts.sprite); spell.spellId stays for
            // gameplay logic + lang lookup.
            spellId: payload.visualGfxId,
            casterCellId,
            targetCellId: payload.targetCellId,
            casterId: payload.casterId,
            spellLevel: payload.spellLevel,
            critical: payload.critical,
            onHit: () => hitFiredResolve(),
          });
        // Canonical timing pulls from two distinct hooks on the
        // caster's animation, so damage popups land at the perceived
        // "hit" instead of mid-windup:
        //
        //   1. applyEnd (mid-anim) — `GAC.applyEnd(this)` routes to
        //      `GlobalSpriteHandler.applyEnd → sequencer.onActionEnd()`,
        //      which is the canonical signal to LAUNCH the spell visual
        //      (advance past the blocking setAnim action to action 20 =
        //      `addEffect`). PlayerRenderer fires `onComplete` here.
        //
        //   2. lastFrame (end of anim) — the inner timeline's `stop()`
        //      lands on the last frame, which the Sequencer treats as
        //      "the cast/melee sequence finished". GA;100 damage actions
        //      queue AFTER the spell visual on the same Sequencer, so the
        //      damage popup canonical fires at lastFrame + visual end —
        //      that is when the punch contacts (close combat) or when the
        //      projectile lands (ranged spells with proper visuals).
        //
        // The 1500 ms cap is a defensive fallback (canonical Sequencer
        // hard cap is 1000 ms in Sprite.as:60; we add a small buffer for
        // the visual completion). It only fires when the metadata-driven
        // hooks don't (sprite not loaded, monster sprite without applyEnd
        // metadata, etc.).
        const SEQUENCER_HOLD_CAP_MS = 1500;
        const noCaster =
          !actorRenderer || !actorRenderer.hasPlayer?.(payload.casterId);
        // The cast pose's last-frame promise — gates the damage popup
        // (so it lands at fist-contact / windup-end, not mid-anim).
        let castPoseDoneResolve!: () => void;
        const castPoseDone = new Promise<void>((resolve) => {
          castPoseDoneResolve = resolve;
          if (noCaster) {
            // No tracked sprite to animate — resolve immediately so the
            // chain doesn't stall.
            resolve();
          }
          // Defensive cap (sprite never finishes its anim, e.g. metadata
          // race or the renderer drops the player mid-cast).
          setTimeout(resolve, SEQUENCER_HOLD_CAP_MS);
        });
        let visualPromise: Promise<void> | undefined;
        // Spell-launch promise — fires when the visual has completed
        // (or is skipped). Wired separately so we can `Promise.all`
        // both signals into a single hit-resolution gate.
        const launchedVisual = new Promise<void>((resolve) => {
          let fired = false;
          const fire = (): void => {
            if (fired) {
              return;
            }
            fired = true;
            visualPromise = launchSpellVisual();
            if (visualPromise) {
              void visualPromise.finally(resolve);
            } else {
              resolve();
            }
          };
          // Pick the cast pose based on the server-supplied animation
          // hint. Canonical Dofus 1.29 sends "anim0" for close-combat
          // (the melee punch frame in every player's atlas) and "anim1"
          // for any ranged / magic spell. Without this gate the punch
          // (spell 0) used to play the same cast pose as a fireball.
          // Direction handling has moved to the server — fight-turn
          // handler emits an authoritative `directionChange` action
          // before every SpellLaunch (and before close combat).
          const castPose =
            payload.animation === "anim0"
              ? PlayerAnimation.ATTACK
              : PlayerAnimation.CAST;
          actorRenderer?.setAnimation(payload.casterId, castPose, {
            revertTo: PlayerAnimation.IDLE,
            // Spell visual launches at applyEnd — the canonical hook
            // (`GAC.applyEnd → sequencer.onActionEnd`).
            onComplete: fire,
            // Cast pose's actual end — gate for the damage popup.
            onLastFrame: () => castPoseDoneResolve(),
          });
          setTimeout(fire, SEQUENCER_HOLD_CAP_MS);
          if (noCaster) {
            fire();
          }
        });
        // Damage popup gate — resolves the moment the spell visual
        // signals hit. For melee impact spells (displayType 11) this
        // is the cast pose's `applyEnd` (Spell0.onSpellStart fires
        // signalHit immediately, and onSpellStart runs when playSpell
        // launches — i.e. at applyEnd). For ranged projectiles
        // (displayType 30/31/40/41) this is the harness's LANDED
        // branch (clip/harness.ts:195). Crucially this does NOT wait
        // for `castPoseDone` — that hook fires at the cast pose's
        // last frame, which is ~500 ms past `applyEnd` for a melee
        // punch. Gating damage on castPoseDone made the popup land
        // half a second after fist contact.
        //
        // Defensive race: launchedVisual covers spells that finish
        // their entire visual without ever calling signalHit
        // (legacy / pre-rendered fallback at the wrong displayType);
        // HIT_CAP_MS = 1500 mirrors the canonical per-sprite Sequencer
        // hard cap (`new Sequencer(1000)` in Sprite.as:60, plus a 500
        // ms buffer for the visual completion), so the popup never
        // stalls indefinitely for a misconfigured spell.
        const HIT_CAP_MS = 1500;
        const damageGate = Promise.race([
          hitFired,
          launchedVisual,
          new Promise<void>((r) => setTimeout(r, HIT_CAP_MS)),
        ]);
        // Update the in-fight sequencer so subsequent damage events
        // queue behind THIS spell's hit moment. Mirrors the canonical
        // per-sprite `oSeq.addAction` queueing where GA;100 (damage)
        // actions come AFTER GA;300 (SpellLaunch) actions on the same
        // sequencer.
        this.spellSequencer = damageGate.catch(() => undefined);
        if (myId !== null && payload.casterId === myId) {
          // Spell-cast machine completion gate — separate from the
          // damage gate. The XState actor stays in `animating` until
          // both the caster's cast pose has fully run (so the sprite
          // is back at idle) AND the spell visual is fully done (so
          // we don't allow a follow-up cast while a fireball is still
          // in flight). Today damage / ap-change all arrive before
          // playSpell resolves, so we collapse ANIMATION_COMPLETE +
          // EFFECTS_RESOLVED at the same moment.
          const machineGate = Promise.all([castPoseDone, launchedVisual]);
          void machineGate.finally(() => {
            const s = spellCastActor.getSnapshot();
            if (s.matches("animating")) {
              spellCastActor.send({ type: "ANIMATION_COMPLETE" });
              spellCastActor.send({ type: "EFFECTS_RESOLVED" });
            } else if (s.matches("pending")) {
              // Rare: animation finished before the SERVER_ACK reducer
              // ran (same microtask). Drive straight through.
              spellCastActor.send({ type: "SERVER_ACK" });
              spellCastActor.send({ type: "ANIMATION_COMPLETE" });
              spellCastActor.send({ type: "EFFECTS_RESOLVED" });
            }
          });
        }
      },
      onDamage: (payload) => {
        // Server emits ActionDamage with sprite_id = target + amount
        // (positive = damage, negative = heal). Two side effects:
        //   1. floating "+12" / "-50" popup over the target cell
        //      (canonical FightPointAnimManager.addLifePointAnim)
        //   2. play the target's `hit` animation, but ONLY for
        //      damage — canonical PlayableCharacter.updateLP:68
        //      gates `mc.setAnim("Hit")` on `dLP < 0`.
        // HP bar updates flow through the fightStore subscription
        // wired in BattlefieldWorldActors (FIGHTER_UPDATE fires from
        // routeAction right after this callback returns). Don't try
        // to apply the delta locally here — that races with the
        // store-driven update and produced the "bar drops to 0"
        // visual the user reported.
        //
        // Defer the popup + recoil pose behind the current spell's
        // sequencer chain — canonical 1.29 queues GA;100 actions
        // AFTER GA;300 actions on the same per-sprite sequencer, so
        // the recoil and floating number only fire once the cast
        // pose + spell visual have completed. Without this gate
        // they'd pop the moment the damage frame lands on the wire,
        // which the user noticed as "damage view shows straight away
        // instead of waiting for the actual hit".
        const targetId = Number(payload.spriteId) || 0;
        const chain = this.spellSequencer;
        const apply = (): void => {
          const ui = this.battlefield?.getFightUI();
          if (!ui) {
            return;
          }
          const actorRenderer = this.battlefield?.getWorldActorRenderer();
          const cell =
            actorRenderer?.getPlayerCell(targetId) ??
            fightStore.getSnapshot().fighters.get(payload.spriteId)?.cell;
          if (cell === undefined) {
            return;
          }
          if (payload.amount >= 0) {
            ui.showDamageAtCell(cell, payload.amount, payload.element);
            if (payload.amount > 0) {
              actorRenderer?.setAnimation(targetId, PlayerAnimation.HIT, {
                revertTo: PlayerAnimation.IDLE,
              });
            }
          } else {
            ui.showHealAtCell(cell, -payload.amount);
          }
        };
        chain.then(apply, apply);
      },
      onPositionStart: (payload) => {
        // Server tells us which cells each team can occupy during
        // placement. The original paints them by team number
        // (team 0 = red, team 1 = blue) regardless of whose side we're
        // on, so we pass them through unswapped — previously this
        // remapped to ally/enemy which inverted the colors for
        // players on team 0.
        const ui = this.battlefield?.getFightUI();
        if (!ui) {
          return;
        }
        ui.showPlacementCells(payload.team1Cells, payload.team2Cells);
      },
      onTeleport: (payload) => {
        const targetId = Number(payload.spriteId) || 0;
        this.battlefield
          ?.getFightUI()
          ?.teleportPlayer(targetId, payload.cellId);
        // Same reason as onDeath: a fighter just changed cells without
        // a walk animation, so the pathfinder's occupancy snapshot is
        // stale. Refresh + re-fire the active hover preview.
        this.refreshOccupancyAndHover();
      },
      onAPChange: (payload) => {
        // Server emits ACTION_AP_SPENT (102) + relatives 101/111/120/168
        // whenever a fighter's AP changes (spell cost, debuff, buff,
        // return-AP). Float the delta above the affected fighter — same
        // animation pipeline as damage, just a different colour /
        // prefix. fighters.get takes the canonical sprite id; world
        // actor renderer falls back to the cell map when the fighter
        // is no longer in the snapshot (rare race during summon teardown).
        if (payload.delta === 0) {
          return;
        }
        const ui = this.battlefield?.getFightUI();
        const actorRenderer = this.battlefield?.getWorldActorRenderer();
        const targetId = Number(payload.spriteId) || 0;
        const cell =
          actorRenderer?.getPlayerCell(targetId) ??
          fightStore.getSnapshot().fighters.get(payload.spriteId)?.cell;
        if (cell !== undefined) {
          ui?.showStatChangeAtCell(cell, payload.delta, "AP");
        }
      },
      onMPChange: (payload) => {
        if (payload.delta === 0) {
          return;
        }
        // Canonical Dofus 1.29 (`__Packages/dofus/%1A%18/%1E%09%1D.as:428`):
        // ACTION_MP_CHANGE adds `updateMP` at sequencer step 56,
        // which is AFTER the path-movement animation completes
        // (movement runs on lower step IDs). Visually the MP cost
        // popup appears once the fighter has finished walking — the
        // user explicitly called this out as the canonical timing.
        //
        // Our network path delivers the MP_CHANGE protocol packet
        // BEFORE the `gameMovement` walk animation finishes, so we
        // defer the popup until `isCharacterMoving()` flips back
        // to false (poll cheaply at 50 ms; typical fight moves
        // finish within ~300 ms). For non-self fighters
        // `isCharacterMoving()` already returns false, so the
        // popup fires immediately as before.
        const fire = (): void => {
          const ui = this.battlefield?.getFightUI();
          const actorRenderer = this.battlefield?.getWorldActorRenderer();
          const targetId = Number(payload.spriteId) || 0;
          const cell =
            actorRenderer?.getPlayerCell(targetId) ??
            fightStore.getSnapshot().fighters.get(payload.spriteId)?.cell;
          if (cell !== undefined) {
            ui?.showStatChangeAtCell(cell, payload.delta, "MP");
          }
        };
        const fireAfterMove = (): void => {
          if (this.mapHandler.isCharacterMoving()) {
            setTimeout(fireAfterMove, 50);
            return;
          }
          fire();
        };
        fireAfterMove();
      },
      onDirectionChange: (payload) => {
        const targetId = Number(payload.spriteId) || 0;
        // Route to the world-actor renderer where fighters actually
        // live in this codebase. fightUI.playerRenderer is empty so
        // routing through it would silently drop every direction
        // change — the visible bug for this is the punch animation
        // playing in the caster's stale facing instead of toward
        // their target.
        this.battlefield
          ?.getWorldActorRenderer()
          ?.setDirection(targetId, payload.direction);
      },
      onDeath: (payload) => {
        const targetId = Number(payload.spriteId) || 0;
        // Canonical Dofus 1.29 (GameActions.as case 103):
        //   - addAction(59, true, mc.setAnim, ["Die"], 1500, true)
        //   - addAction(61, false, mc.clear)
        // i.e. play the death animation, then remove the sprite. The
        // fighter entry stays on the HUD timeline (greyed via
        // `dead: true` on the fight store) so the user can still see
        // it in the round order, but the sprite goes away from the
        // battlefield.
        //
        // Death actions queue on the same per-sprite Sequencer that
        // owns GA;300 (SpellLaunch) and GA;100 (Damage), so the death
        // pose only kicks in once the cast pose + spell visual have
        // finished — otherwise the target collapses mid-windup.
        const chain = this.spellSequencer;
        const apply = (): void => {
          const actorRenderer = this.battlefield?.getWorldActorRenderer();
          if (!actorRenderer) {
            return;
          }
          actorRenderer.setAnimation(targetId, PlayerAnimation.DEATH, {
            revertTo: PlayerAnimation.IDLE,
          });
          // Corpse cell becomes walkable + LoS-transparent immediately
          // for preview purposes — fightStore already has `dead: true`,
          // we just need to push the new occupancy snapshot into the
          // pathfinder and re-fire the hover so the cursor's path /
          // spell preview updates without waiting for the next mouse
          // move.
          this.refreshOccupancyAndHover();
          const DEATH_REMOVE_DELAY_MS = 1500;
          setTimeout(() => {
            // Re-check the fight is still running before removing — if
            // the fight ended in the meantime, the renderer's clear()
            // already wiped the sprite and a stray remove would log.
            if (
              this.battlefield?.getWorldActorRenderer()?.hasPlayer?.(targetId)
            ) {
              this.battlefield?.getWorldActorRenderer()?.removePlayer(targetId);
            }
          }, DEATH_REMOVE_DELAY_MS);
        };
        chain.then(apply, apply);
      },
      onFightEnd: () => {
        this.battlefield?.getFightUI()?.clearFightVisuals();
      },
      onZoneAdd: (zone) => {
        // Glyphs and traps share GameZoneData. Server supplies the
        // zone shape (areaKind), size, and the canonical element
        // colour (looked up server-side from the trigger spell's
        // primary damage element). The client renders the zone via
        // the canonical Zone.drawCircle path: 30% alpha translucent
        // fill across the whole zone polygon + 1px solid border on
        // the outer perimeter only. areaKind=0 (None) is the legacy
        // default = Circle.
        const ui = this.battlefield?.getFightUI();
        const highlighter = ui?.getCellHighlighter();
        const dims = this.battlefield?.getCurrentMapData();
        if (!highlighter || !dims) {
          return;
        }
        const isTrap = zone.color === 0xff8000;
        const type = isTrap ? HighlightType.TRAP : HighlightType.GLYPH;
        const kind: AreaKind =
          zone.areaKind === AreaKind.None
            ? AreaKind.Circle
            : (zone.areaKind as AreaKind);
        const cells = cellsInArea(
          { width: dims.width, height: dims.height },
          zone.cellId,
          zone.cellId,
          kind,
          zone.size
        );
        highlighter.addZone(zone.cellId, cells, type, zone.color);
      },
      onZoneRemove: (zone) => {
        const highlighter = this.battlefield
          ?.getFightUI()
          ?.getCellHighlighter();
        if (!highlighter) return;
        // Remove the matching zone instance — the highlighter keeps
        // the cell footprint per (centerCell, type) so we don't need
        // to recompute it from areaKind/size here. Try both types
        // since the wire only carries the centre cell.
        highlighter.removeZone(zone.cellId, HighlightType.GLYPH);
        highlighter.removeZone(zone.cellId, HighlightType.TRAP);
      },
    });

    // Tint the MP-bound reachable cells whenever it becomes the
    // player's turn (and clear them on every other transition). Lives
    // here — not in Battlefield — because the network MapHandler holds
    // both the player's current cell and the pathfinding instance.
    //
    // The subscribe fires for every fightMachine context change (stats,
    // roster, turn), so we MUST guard the pathfinding call on isMoving:
    // MP-change frames arrive mid-animation and the currentCellId is
    // still the pre-move cell, which would draw a ghost-wide ring
    // centered on the sprite's starting square. After movement
    // completes, map-handler's onSelfMoveComplete hook replays the
    // refresh with the settled cell.
    // selfHovered is a class field — fed by Battlefield.setOnSelfHover
    // which is wired in setBattlefield(). The MP-reachable-range tint
    // follows that signal exclusively — it never appears just because
    // the turn flipped to ours. Mirrors canonical Sprite._rollOver
    // (battlefield/mc/Sprite.as:753), where the green pattern is a
    // roll-over decoration on the fighter, not a turn indicator.
    let lastMyTurn = false;
    let lastMode: string | null = null;
    let lastModeDump = "";
    this.mapHandler.setOnSelfMoveComplete(() => {
      // Drop the blue "path I chose" flash at the end of the walk.
      // Original 1.29 (GameActionsEx.as:163) clears it at broadcast
      // time, before the walk — on a loopback server that's ~1 ms
      // and the flash is imperceptible, so we hold it through the
      // animation so the click registers visibly.
      const ui = this.battlefield?.getFightUI();
      ui?.clearHighlightType("selected");
      // Only re-paint the range if the user is still pointing at
      // their avatar — otherwise the move ends with a clean board.
      if (this.selfHovered) {
        this.refreshReachableRange();
      }
      // Push the new self position into the pathfinder + replay the
      // current hover so the MP path / spell preview catches up
      // immediately. Without this the cursor sits over a cell from
      // the pre-move world until the user wiggles the mouse.
      this.refreshOccupancyAndHover();
    });
    this.mapHandler.setOnSelfMoveStart(() => {
      // The hover-path overlay doesn't need to linger while the
      // sprite is walking — clear it here and let SELECTED carry
      // the "you clicked this path" color until the walk finishes.
      this.battlefield?.getFightUI()?.clearHighlightType("movement-path");
    });
    fightActor.subscribe((snap) => {
      const isMyTurn =
        typeof snap.value === "object" &&
        snap.value !== null &&
        (snap.value as { fighting?: string }).fighting === "myTurn";
      const dump = `${JSON.stringify(snap.value)} mySprite=${snap.context.mySpriteId} turnSprite=${snap.context.currentTurnSpriteId} ap=${snap.context.ap} mp=${snap.context.mp}`;
      if (dump !== lastModeDump) {
        log.info(`fight-state: ${dump}`);
        lastModeDump = dump;
      }
      const ui = this.battlefield?.getFightUI();
      if (!ui) {
        lastMyTurn = isMyTurn;
        return;
      }
      // Placement → combat boundary: drop the blue/red starting-cell
      // tint so it doesn't linger under the fighters the server is
      // about to spawn. fightMachine uses a "placement" string state
      // and a "fighting" compound state, so we compare projections.
      const modeStr =
        typeof snap.value === "string"
          ? snap.value
          : snap.value &&
              typeof snap.value === "object" &&
              "fighting" in snap.value
            ? "fighting"
            : String(snap.value);
      if (lastMode === "placement" && modeStr !== "placement") {
        ui.clearPlacementHighlights();
      }
      lastMode = modeStr;

      // Turn changes never paint the MP overlay on their own —
      // canonical 1.29 only shows it on sprite roll-over. Clear any
      // stale ring when we leave myTurn so the previous frame's tint
      // doesn't bleed across a turn boundary.
      if (lastMyTurn && !isMyTurn) {
        ui.clearHighlightType("movement");
        ui.clearHighlightType("movement-path");
      }
      lastMyTurn = isMyTurn;
    });

    // (The MP overlay's hover-on-self subscription is wired in
    // `setBattlefield` below — Battlefield doesn't exist yet at this
    // point in the constructor.)

    // Spell-range + AoE preview driven by the spell-cast machine.
    // `targeting` tints the full range ring; `HOVER_CELL` (wired in
    // step 3) adds the AoE overlay on top. Any non-targeting state
    // drops the spell highlights. The MP-reachable-range tint is NOT
    // auto-restored here — it follows sprite hover only, so cancelling
    // a spell selection without re-hovering the avatar correctly
    // leaves the map clean.
    spellCastActor.subscribe((snap) => {
      const ui = this.battlefield?.getFightUI();
      if (!ui) {
        return;
      }
      if (snap.matches("targeting")) {
        ui.clearHighlightType("movement");
        // Canonical `dofus.managers.GameManager.drawSpellRange` paints
        // TWO layers (default option `AdvancedLineOfSight = true`):
        //   1. underlay polygon over EVERY cell in range
        //      (`gfx.drawZone`, dark blue 30%) — `GameManager.as:400`
        //   2. per-cell bright tint on each cell that passes
        //      `checkCanLaunchSpellOnCell` (LoS + valid)
        //      (`gfx.select(cell, 0x0066CC, "spell", 50, false)`) —
        //      `GameManager.as:470` via `drawAllowedZone`.
        // Cells in range but blocked by LoS get only layer 1 — that's
        // the visual cue the user is asking for: a darker shade behind
        // a monster that obstructs the cast.
        const spell = snap.context.spell;
        const caster = snap.context.casterCellId;
        const targeting = snap.context.targetingCells;
        const dims = this.battlefield?.getCurrentMapData();
        const occupants = new Set<number>();
        for (const f of fightStore.getSnapshot().fighters.values()) {
          // Also exclude `hp <= 0` — same defensive double-check
          // as `occupiedCells()` above; protects against a stale
          // `gameTurnMiddle` patch that flips `dead` back to false.
          if (!f.dead && f.hp > 0) {
            occupants.add(f.cell);
          }
        }
        const allowed: number[] = [];
        if (spell && caster !== null && dims) {
          const fmap = {
            width: dims.width,
            height: dims.height,
            occupantOf: (cell: number): number | undefined =>
              occupants.has(cell) ? cell : undefined,
            losBlocked: (cell: number): boolean =>
              this.battlefield?.isCellLosBlocked(cell) ?? false,
          };
          for (const cell of targeting) {
            // Caster cell is always "allowed" visually — never paint
            // its own square as blocked.
            if (cell === caster) {
              allowed.push(cell);
              continue;
            }
            if (!spell.lineOfSight || hasLineOfSight(fmap, caster, cell)) {
              allowed.push(cell);
            }
          }
        }
        ui.showSpellRange(targeting, allowed);
        ui.showSpellZone(snap.context.previewCells);
      } else {
        ui.clearHighlightType("spell-range");
        ui.clearHighlightType("spell-range-outline");
        ui.clearHighlightType("spell-zone");
        ui.clearHighlightType("spell-zone-invalid");
        // Replay the hover→range path so cancelling a selection while
        // the avatar is still under the cursor restores the tint.
        if (this.selfHovered) {
          this.refreshReachableRange();
        }
      }
    });

    // TURN_START / TURN_END on the fight machine bubbles into the
    // cast machine as TURN_ENDED so any in-flight selection is dropped
    // when the active fighter changes — the server rejects stale casts
    // anyway and we must not carry highlights across turns.
    let lastFighting: string | null = null;
    fightActor.subscribe((snap) => {
      const state =
        typeof snap.value === "object" &&
        snap.value !== null &&
        "fighting" in snap.value
          ? String((snap.value as { fighting: string }).fighting)
          : null;
      if (state !== lastFighting) {
        if (lastFighting === "myTurn" && state !== "myTurn") {
          spellCastActor.send({ type: "TURN_ENDED" });
        }
        if (state === "myTurn" && lastFighting !== "myTurn") {
          // Dofus 1.29 cooldowns tick down at the start of the
          // caster's turn — the server only emits SpellCooldown on
          // initial lock-out, so the client owns the countdown.
          tickCooldowns();
        }
        lastFighting = state;
      }
    });

    const stats = this.characterHandler.getCurrentStats();
    if (stats) {
      characterStore.setState({ stats });
    }

    // gameMapData / gameMovement frames that arrived before the battlefield
    // was initialised have been buffered — replay them now.
    this.mapHandler.flushPending();
  }

  // ── Connection lifecycle ─────────────────────────────────────────

  connect(): void {
    this.connection.connect();
  }

  disconnect(): void {
    this.connection.disconnect();
  }

  isConnected(): boolean {
    return this.connection.isConnected();
  }

  setOnConnected(fn: () => void): void {
    this.onConnected = fn;
  }

  setOnDisconnected(fn: () => void): void {
    this.onDisconnected = fn;
  }

  // ── Pre-game commands ────────────────────────────────────────────

  async login(username: string, password: string): Promise<void> {
    const passwordKey = await derivePasswordKey(password, username);
    loginActor.send({ type: "START_LOGIN", username });
    this.connection.send(
      encodeClient(
        "accountSendIdentity",
        create(AccountSendIdentitySchema, {
          username,
          encryptedPassword: passwordKey,
        })
      )
    );
  }

  requestServers(): void {
    this.connection.send(
      encodeClient("accountGetServers", create(AccountGetServersListSchema, {}))
    );
  }

  selectServer(serverId: number): void {
    loginActor.send({ type: "SELECT_SERVER", serverId });
    this.connection.send(
      encodeClient(
        "accountSelectServer",
        create(AccountSelectServerRequestSchema, { serverId })
      )
    );
  }

  requestCharacters(): void {
    this.connection.send(
      encodeClient(
        "accountGetCharacters",
        create(AccountGetCharactersListSchema, { forced: false })
      )
    );
  }

  selectCharacter(characterId: number): void {
    loginActor.send({ type: "SELECT_CHARACTER", characterId });
    this.connection.send(
      encodeClient(
        "accountSelectCharacter",
        create(AccountSelectCharacterSchema, { characterId })
      )
    );
  }

  // ── In-game commands ─────────────────────────────────────────────
  // Each outbound action is a GameActionRequest with a semicolon-separated
  // params string — the legacy Dofus 1.29 wire format the server still
  // speaks on the ingress side. Full native-proto client actions will land
  // when the server's request side migrates away from GA-style strings.

  move(path: number[]): void {
    const params = path.join(",");
    this.connection.send(
      encodeClient(
        "gameAction",
        create(GameActionRequestSchema, { actionType: 1, params })
      )
    );
  }

  changeMap(mapId: number): void {
    this.connection.send(
      encodeClient(
        "gameAction",
        create(GameActionRequestSchema, {
          actionType: 2,
          params: String(mapId),
        })
      )
    );
  }

  moveItem(unicId: number, position: number, quantity = 1): void {
    this.connection.send(
      encodeClient(
        "itemMove",
        create(ItemMoveRequestSchema, {
          itemUnicId: unicId,
          position,
          quantity,
        })
      )
    );
  }

  useItem(unicId: number): void {
    this.connection.send(
      encodeClient(
        "itemUse",
        create(ItemUseRequestSchema, { itemUnicId: unicId })
      )
    );
  }

  dropItem(unicId: number, quantity: number): void {
    this.connection.send(
      encodeClient(
        "itemDrop",
        create(ItemDropRequestSchema, { itemUnicId: unicId, quantity })
      )
    );
  }

  destroyItem(unicId: number, quantity: number): void {
    this.connection.send(
      encodeClient(
        "itemDestroy",
        create(ItemDestroyRequestSchema, { itemUnicId: unicId, quantity })
      )
    );
  }

  private handleCellClick(targetCellId: number): void {
    const fightMode = fightStore.getSnapshot().mode;
    log.debug(`cell-click cell=${targetCellId} fightMode=${fightMode}`);

    // Placement: send GameSetPosition; the server validates against the
    // allowed cells and broadcasts the sprite move.
    if (fightMode === "placement") {
      this.fightHandler.setPlacement(targetCellId);
      return;
    }

    // Combat: route clicks through the spell-cast machine. When it is
    // in `targeting`, the click is a cast target — we advance the
    // machine to `pending` and fire the cast request. Otherwise the
    // click is a movement command.
    if (fightMode === "fighting") {
      // Ignore clicks while our sprite is still animating a previous
      // move. `currentCellId` on the map-handler is only updated
      // when handleActorPath resolves; a click mid-animation would
      // compute a path from the STALE pre-move cell — the server
      // would then reject it (fighter already moved, distance
      // check fails) and the position would silently desync.
      if (this.mapHandler.isCharacterMoving()) {
        log.debug(
          "fight-click ignored: self sprite still animating previous move"
        );
        return;
      }
      const castSnap = spellCastActor.getSnapshot();
      if (castSnap.matches("targeting") && castSnap.context.spell) {
        const spell = castSnap.context.spell;
        if (!castSnap.context.targetingCells.includes(targetCellId)) {
          // Click outside the range ring — cancel targeting and fall
          // through to the movement branch.
          spellCastActor.send({ type: "DESELECT" });
        } else {
          log.info(
            `cast spell=${spell.spellId} target=${targetCellId} level=${spell.level}`
          );
          spellCastActor.send({ type: "TARGET_CELL", cellId: targetCellId });
          this.fightHandler.sendCast(spell.spellId, targetCellId, spell.level);
          return;
        }
      }
      const fightCurrentCell = this.mapHandler.getCurrentCellId();
      const fightPathfinding = this.mapHandler.getPathfinding();
      if (fightCurrentCell === null || !fightPathfinding) {
        log.warn(
          `fight-move dropped: currentCell=${fightCurrentCell} pathfinding=${!!fightPathfinding}`
        );
        return;
      }
      // Sync fighter-occupied cells into the pathfinder before
      // computing a route — the server drops any path that crosses
      // another fighter (fight-turn.handler.ts isFree check), so
      // the client must reach the same answer or the click looks
      // like it was silently swallowed.
      this.syncFightOccupiedCells(fightPathfinding, fightCurrentCell);
      // Fight paths must stay on the 4 cardinal-isometric directions.
      const fightPath = fightPathfinding.findFightPath(
        fightCurrentCell,
        targetCellId
      );
      if (!fightPath || fightPath.length < 2) {
        log.warn(
          `fight-move dropped: no path from ${fightCurrentCell} → ${targetCellId}`
        );
        return;
      }
      const mp = fightStore.getSnapshot().mp;
      if (mp > 0 && fightPath.length - 1 > mp) {
        log.warn(
          `fight-move dropped: ${fightPath.length - 1} steps needed but only ${mp} MP`
        );
        return;
      }
      const mapWidth = this.battlefield?.getCurrentMapData()?.width ?? 15;
      log.info(
        `fight-move ${fightCurrentCell} → ${targetCellId} (${fightPath.length - 1} steps)`
      );
      // Flash the path in CELL_PATH_SELECT_COLOR (dark blue) while we
      // wait for the server broadcast, matching
      // InteractionsManager.as:86 on release. The hover overlay
      // (orange CELL_PATH_OVER_COLOR) gets replaced by this. When the
      // move broadcast comes back, onSelfMoveStarted clears it —
      // mirrors GameActionsEx.as:163 `unSelect(true)`.
      const ui = this.battlefield?.getFightUI();
      if (ui) {
        ui.clearHighlightType("movement-path");
        ui.highlightCells(fightPath.slice(1), "selected");
      }
      this.fightHandler.sendMove(fightPath, mapWidth);
      return;
    }

    // Roleplay: standard cell-to-cell pathfinding move.
    const currentCellId = this.mapHandler.getCurrentCellId();
    const pathfinding = this.mapHandler.getPathfinding();
    if (
      currentCellId === null ||
      !pathfinding ||
      this.mapHandler.isCharacterMoving()
    ) {
      return;
    }
    const path = pathfinding.findPath(currentCellId, targetCellId);
    if (!path || path.length < 2) {
      return;
    }
    log.debug(`Moving: ${currentCellId} → ${targetCellId}`);
    this.move(path);
  }

  // ── Fight actions (called by FightOverlay) ───────────────────────

  fightReady(): void {
    this.fightHandler.setReady(true);
  }

  fightPassTurn(): void {
    this.fightHandler.passTurn();
  }

  fightForfeit(): void {
    this.fightHandler.forfeit();
  }

  /**
   * User picked a spell slot during combat. Feeds the cast machine so
   * the HUD tints the range ring and the next cell-click is routed as
   * a cast target. Re-clicking the same slot deselects (mirrors the
   * original Dofus 1.29 behavior).
   */
  fightSelectSpell(spellId: number): void {
    const snap = spellCastActor.getSnapshot();
    if (snap.context.spell?.spellId === spellId && snap.matches("targeting")) {
      spellCastActor.send({ type: "DESELECT" });
      return;
    }
    const spell = spellsStore.getSnapshot().byId.get(spellId);
    if (!spell) {
      log.warn(`fight-select-spell: unknown spell ${spellId}`);
      return;
    }
    const casterCellId = this.mapHandler.getCurrentCellId();
    const pf = this.mapHandler.getPathfinding();
    if (casterCellId === null || !pf) {
      log.warn(
        `fight-select-spell: no caster cell or pathfinding for ${spellId}`
      );
      return;
    }
    // Spell range = canonical Dofus 1.29 4-way Manhattan diamond
    // expansion (BFS over the 4 diamond-adjacent cells = SE/SW/NW/NE).
    // `orthogonalOnly=true` switches the BFS to those 4 directions so
    // the preview shape matches the server's distance check (which
    // uses the same 4-way metric in fightDistance) AND the canonical
    // diamond range overlay players know from the original client.
    // The 8-way default would produce a SQUARE shape with ~2x the
    // cells, which is what the user reported as "wrong".
    const targetingCells = pf.cellsInRange(
      casterCellId,
      spell.rangeMin,
      spell.rangeMax,
      true
    );
    spellCastActor.send({
      type: "SELECT_SPELL",
      spell,
      casterCellId,
      targetingCells,
    });
  }

  /**
   * Snapshot the fight store's fighter positions into the pathfinder's
   * occupied-cell set so both `findFightPath` and `reachable` return
   * the same answer the server does. Excludes our own cell so the
   * player can start a path from where they stand. Called before any
   * fight-mode pathfinding query.
   */
  private syncFightOccupiedCells(
    pf: ReturnType<MapHandler["getPathfinding"]>,
    selfCellId: number
  ): void {
    if (!pf) {
      return;
    }
    pf.clearOccupied();
    const fighters = fightStore.getSnapshot().fighters;
    for (const f of fighters.values()) {
      // `f.dead === true` OR `f.hp <= 0` — both indicate a corpse
      // that should not block pathing. Defensive double-check
      // because `gameTurnMiddle` patches sometimes overwrite the
      // dead flag with the server's transient state.
      if (f.dead || f.hp <= 0) {
        continue;
      }
      if (f.cell === selfCellId) {
        continue;
      }
      pf.addOccupied(f.cell);
    }
  }

  /**
   * Recompute the MP-bound reachable cells for my fighter. Guarded on
   * `isCharacterMoving()` — during a move animation the server has
   * already dispatched the MP delta but our currentCellId still points
   * at the pre-move cell, so recomputing now would render a ring
   * centered on the wrong cell. The map handler replays this hook
   * after the animation resolves.
   */
  private refreshReachableRange(): void {
    const ui = this.battlefield?.getFightUI();
    if (!ui) {
      return;
    }
    const snap = fightActor.getSnapshot();
    const isMyTurn =
      typeof snap.value === "object" &&
      snap.value !== null &&
      (snap.value as { fighting?: string }).fighting === "myTurn";
    if (!isMyTurn) {
      return;
    }
    if (this.mapHandler.isCharacterMoving()) {
      // Animation still running; the move-complete hook will call us
      // back with the settled currentCellId.
      return;
    }
    const cell = this.mapHandler.getCurrentCellId();
    const pf = this.mapHandler.getPathfinding();
    const mp = snap.context.mp;
    if (cell === null || !pf) {
      return;
    }
    if (mp <= 0) {
      // Original behaviour: reachable ring disappears once MP is spent.
      ui.clearHighlightType("movement");
      return;
    }
    // Keep occupied cells in sync — the ring should skip tiles the
    // server would never let us land on. Fight moves are restricted
    // to the 4 cardinal-isometric directions (no half-step
    // diagonals, same constraint the server enforces when decoding
    // the path).
    this.syncFightOccupiedCells(pf, cell);
    ui.showMovementRange(pf.reachable(cell, mp, true));
  }

  /**
   * Push the latest fighter occupancy into the pathfinder and re-fire
   * the hover preview against the cell the cursor is currently over.
   *
   * Used after server events that change what's blocking pathing /
   * line-of-sight without the user moving the mouse: a fighter dies,
   * we teleport, our own move animation finishes. The previous
   * implementation just cleared previews on these events, which left
   * stale paths or red invalid-LoS flashes on screen until the next
   * cursor movement.
   */
  private refreshOccupancyAndHover(): void {
    const pf = this.mapHandler.getPathfinding();
    const self = this.mapHandler.getCurrentCellId();
    if (pf && self !== null) {
      this.syncFightOccupiedCells(pf, self);
    }
    this.hoverPreview?.refreshFromCurrentHover();
  }

  // ── Accessors ────────────────────────────────────────────────────

  getCurrentCharacter(): CharacterInfo | null {
    return this.characterHandler.getCurrentCharacter();
  }

  getCurrentMapId(): number | null {
    return this.mapHandler.getCurrentMapId();
  }

  getCurrentStats(): CharacterStats | null {
    return this.characterHandler.getCurrentStats();
  }

  getAudioManager(): AudioManager {
    return this.audioManager;
  }

  getInventory(): InventoryStore {
    return this.inventoryHandler.store;
  }

  getAuthState() {
    return this.authHandler.getState();
  }

  destroy(): void {
    this.connection.destroy();
    this.messageHandler.clear();
    this.audioManager.destroy();
    this.fightHandler.destroy();
    this.battlefield = null;
  }
}
