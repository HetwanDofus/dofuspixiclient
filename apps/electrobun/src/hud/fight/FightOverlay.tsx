import { useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { Forfeit } from "@/components/ui/icons/fight/forfeit";
import { PassTurn } from "@/components/ui/icons/fight/pass-turn";
import { Tactical } from "@/components/ui/icons/fight/tactical";
import { ResourceGauge } from "@/components/ui/resource-gauge";
import {
  TurnTimeline,
  type TurnTimelineEntry,
} from "@/components/ui/turn-timeline";
import { characterStore } from "@/game/stores/character-store";
import { useTacticalMode } from "@/hud/fight/tactical-mode-store";
import { useFightMode } from "@/hud/fight/useFightMode";

import { FightPlacementPanel } from "./FightPlacementPanel";
import { TurnChangeBanner } from "./TurnChangeBanner";

export interface FightOverlayActions {
  onPassTurn: () => void;
  onForfeit: () => void;
  onReady: () => void;
  onSelectSpell: (spellId: number) => void;
}

interface FightOverlayProps {
  actions: FightOverlayActions;
}

/**
 * React fight HUD layered above the canvas. Mounted whenever fightStore
 * reports placement/fighting/spectating. Renders the timeline + gauges
 * + buttons + spell bar; placement state additionally shows the Ready
 * panel and hides the spell bar.
 */
export function FightOverlay({ actions }: FightOverlayProps) {
  const fight = useFightMode();
  const character = useSyncExternalStore(
    characterStore.subscribe,
    characterStore.getSnapshot
  );
  const { tactical, toggleTactical } = useTacticalMode();

  if (!fight.isFighting) {
    return null;
  }

  // Live fight LP: read from fightStore (updated by FIGHTER_UPSERT
  // on placement and FIGHTER_UPDATE on every damage / heal / GTM).
  // characterStore.stats is a roleplay snapshot taken at login and
  // never refreshed mid-fight, so it'd freeze the gauge at pre-fight
  // values. Outside combat the fightStore mirror is empty, so we
  // fall back to the character snapshot.
  const myFighter = fight.mySpriteId
    ? fight.fighters.get(fight.mySpriteId)
    : undefined;
  const hp = myFighter?.hp ?? character.stats?.hp ?? 0;
  const maxHp = myFighter?.maxHp ?? character.stats?.maxHp ?? hp;

  // The server-truth roster lives on fightStore.fighters. For every
  // sprite on the timeline we look up its FighterSnapshot; team
  // coloring comes from `fighter.team` vs our own team, not from
  // sprite-id sign (which is only meaningful for monster groups).
  const mySpriteId = fight.mySpriteId;
  const myTeam =
    (mySpriteId && fight.fighters.get(mySpriteId)?.team) ?? 0;
  const entries: TurnTimelineEntry[] = fight.timeline.map((spriteId) => {
    const f = fight.fighters.get(spriteId);
    const team: "ally" | "enemy" =
      f ? (f.team === myTeam ? "ally" : "enemy") : "ally";
    const hp = f && f.maxHp > 0 ? f.hp / f.maxHp : undefined;
    return {
      id: spriteId,
      name: f?.name ?? spriteId,
      level: f?.level,
      team,
      active: fight.currentTurnSpriteId === spriteId,
      dead: f?.dead,
      ...(hp !== undefined ? { hpFraction: hp } : {}),
      ...(f ? { ap: f.ap, mp: f.mp } : {}),
    };
  });

  return (
    <div
      className="pointer-events-none absolute inset-0 z-20"
      data-fight-overlay
    >
      {/* Top-left: animated turn-change banner (canonical
          UI_StringCourse — name + level + portrait + colour zones,
          slides in on every TURN_START). */}
      <TurnChangeBanner />

      {/* Top-center: turn timeline */}
      <div className="pointer-events-auto absolute top-[calc(8px*var(--resolution-factor))] left-1/2 -translate-x-1/2">
        <TurnTimeline entries={entries} currentTurn={fight.turnIndex + 1} />
      </div>

      {/* Top-right: HP/AP/MP gauges */}
      <div className="pointer-events-auto absolute top-[calc(8px*var(--resolution-factor))] right-[calc(8px*var(--resolution-factor))] flex flex-col gap-[calc(4px*var(--resolution-factor))]">
        <ResourceGauge variant="hp" value={hp} max={maxHp} />
        <ResourceGauge variant="ap" value={fight.ap} max={fight.maxAp} />
        <ResourceGauge variant="mp" value={fight.mp} max={fight.maxMp} />
      </div>

      {/* Bottom-right (above banner): tactical / forfeit always visible
          during placement + combat; pass-turn only inside combat. */}
      <div className="pointer-events-auto absolute right-[calc(8px*var(--resolution-factor))] bottom-[calc(140px*var(--resolution-factor))] flex gap-[calc(4px*var(--resolution-factor))]">
        <Button
          variant="rectangle"
          onClick={toggleTactical}
          aria-pressed={tactical}
          title={tactical ? "Mode normal" : "Mode tactique"}
        >
          <Tactical className="h-[calc(16px*var(--resolution-factor))] w-[calc(16px*var(--resolution-factor))]" />
        </Button>
        <Button
          variant="rectangle"
          onClick={actions.onForfeit}
          title="Abandonner"
        >
          <Forfeit className="h-[calc(16px*var(--resolution-factor))] w-[calc(16px*var(--resolution-factor))]" />
        </Button>
        {fight.isCombat && (
          <Button
            variant="pill"
            onClick={actions.onPassTurn}
            disabled={!fight.isMyTurn}
            title="Passer le tour"
          >
            <PassTurn className="h-[calc(16px*var(--resolution-factor))] w-[calc(22px*var(--resolution-factor))]" />
          </Button>
        )}
      </div>

      {/* Bottom-center: placement panel during prep. Spell selection
        * during combat is handled by BannerReact's hotbar slots — they
        * already render the player's positioned spells with proper
        * Vello icons + tooltips, so we no longer overlay a separate
        * FightSpellBar with a duplicated visual style. */}
      {fight.isPlacement && <FightPlacementPanel onReady={actions.onReady} />}
    </div>
  );
}
