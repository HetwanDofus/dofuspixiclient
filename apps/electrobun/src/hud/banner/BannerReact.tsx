import { Tooltip } from "@base-ui/react/tooltip";
import { useMemo, useSyncExternalStore } from "react";

import {
  MainBanner,
  MainBannerButtons,
  MainBannerChat,
  MainBannerChatInput,
  MainBannerCircle,
  MainBannerGrid,
  MainBannerGridSlot,
  MainBannerHeart,
  MainBannerIconButton,
  MainBannerMorePanel,
  MainBannerRightPanel,
} from "@/components/ui/main-banner";
import { useSpellCast } from "@/game/machines/spell-cast-selectors";
import { togglePanel, toggleWorldMap } from "@/game/stores";
import { characterStore } from "@/game/stores/character-store";
import { type SpellEntry, spellsStore } from "@/game/stores/spells-store";
import { useFightMode } from "@/hud/fight/useFightMode";
import { SpellIconMount } from "@/hud/spells/SpellIconMount";

import { Minimap } from "../minimap/Minimap";

/**
 * In-fight cast state for a single hotbar slot. Used to drive the
 * visual treatment (selected ring, dimmed when out of AP, greyed-out
 * cooldown) and to gate clicks on whether the slot is castable.
 */
type FightSlotState =
  | "idle" // not in a fight, no special treatment
  | "ready"
  | "selected"
  | "pending"
  | "unaffordable"
  | "cooldown"
  | "disabled";

interface SpellHotbarCellProps {
  spell: SpellEntry | null;
  fight: FightSlotState;
  /** Click handler for fight casts. No-op when fight === "idle". */
  onCast?: ((spellId: number) => void) | undefined;
}

/** Hotbar slot count — mirrors the 14 MainBannerGridSlot cells in the HUD. */
const HOTBAR_SLOTS = 14;

/**
 * Maps the slot's fight state to the Tailwind classes that overlay the
 * stock MainBannerGridSlot frame. Idle = no overlay; selected = a bright
 * inner ring; cooldown / unaffordable = dim; disabled = lower opacity.
 */
const FIGHT_SLOT_OVERLAY: Record<FightSlotState, string> = {
  idle: "",
  ready: "",
  selected: "ring-2 ring-[#ffcb5c] ring-inset shadow-[0_0_0_1px_#ffe9a8]",
  pending: "ring-2 ring-[#9be6ff] ring-inset",
  unaffordable: "opacity-60 saturate-50",
  cooldown: "grayscale opacity-50",
  disabled: "opacity-40 cursor-not-allowed",
};

/**
 * Hotbar cell — one slot of the 14-wide spell grid. Wraps MainBannerGridSlot
 * with a Base UI Tooltip so hover shows the localized name + level +
 * description instead of the native browser title (which doesn't style + is
 * unreliable inside nested positioned containers).
 *
 * In a fight the cell becomes castable: clicking it routes to
 * `gameClient.fightSelectSpell` (via the `onCast` prop) and the visual
 * treatment reflects the spell-cast machine + per-spell affordability.
 * Outside a fight the cell is purely informational (hover tooltip).
 */
function SpellHotbarCell({ spell, fight, onCast }: SpellHotbarCellProps) {
  if (!spell) {
    return <MainBannerGridSlot />;
  }
  const overlay = FIGHT_SLOT_OVERLAY[fight];
  const clickable =
    fight !== "idle" &&
    fight !== "disabled" &&
    fight !== "cooldown" &&
    fight !== "pending";
  const handleClick =
    clickable && onCast ? () => onCast(spell.spellId) : undefined;
  const cooldownBadge =
    fight === "cooldown" && spell.cooldownRemaining > 0 ? (
      <span className="absolute inset-0 z-20 flex items-center justify-center font-[Verdana,sans-serif] text-[calc(14px*var(--resolution-factor))] font-bold text-white drop-shadow-[0_0_2px_#000] pointer-events-none">
        {spell.cooldownRemaining}
      </span>
    ) : null;
  const apBadge =
    fight !== "idle" && spell.apCost > 0 ? (
      <span className="absolute bottom-0 right-0 z-10 px-[calc(2px*var(--resolution-factor))] font-[Verdana,sans-serif] text-[calc(9px*var(--resolution-factor))] font-bold text-[#ffd27a] drop-shadow-[0_0_2px_#000] pointer-events-none">
        {spell.apCost}
      </span>
    ) : null;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={
          <MainBannerGridSlot
            className={overlay}
            {...(handleClick ? { onClick: handleClick } : {})}
          >
            <SpellIconMount spellId={spell.spellId} label={spell.name} />
            {apBadge}
            {cooldownBadge}
          </MainBannerGridSlot>
        }
      />
      <Tooltip.Portal>
        {/* Positioner is the floating-UI fixed container; the z-index
         * has to live here, not on Popup, or the entire tooltip stacks
         * under any HUD panel with higher z-index than the Positioner's
         * default. 999999 matches the app's custom tooltip layer
         * (`hud/components/Tooltip.tsx`) so spell tooltips float above
         * world-map / fight / conquest panels. */}
        <Tooltip.Positioner sideOffset={6} style={{ zIndex: 999999 }}>
          {/*
            Canonical Dofus 1.29 spell tooltip styling — sourced from
            `dofus.graphics.gapi.styles.DofusStylePackage`:
              • bg `ExtraLightBrownSpellFullInfosStylizedRectangle` (cream
                #EDE5CC, 10px corner radius)
              • title `BrownCenterBigBoldLabel` (Font2 size 13, dark brown
                #514A3C bold)
              • body `FilterLabel` (Font1 size 11, dark brown #514A3C bold)
              • AP-cost emphasis: `OrangeLeftMediumBoldLabel` (#FF6800)
            Earlier we shipped a dark-theme bubble (#2b2a24 bg, gold
            title) which read as a generic web tooltip rather than
            anything Ankama drew.
          */}
          <Tooltip.Popup
            className={
              "max-w-xs rounded-[6px] border border-[#514a3c] " +
              "bg-[#ede5cc] px-[8px] py-[6px] " +
              "text-[11px] leading-snug text-[#514a3c] " +
              "shadow-[0_2px_6px_rgba(0,0,0,0.45)] " +
              "font-[Verdana,sans-serif] whitespace-pre-wrap"
            }
          >
            <div className="text-[13px] font-bold leading-tight">
              {spell.name}
              <span className="ml-2 text-[11px] font-normal text-[#7a7060]">
                Niv. {spell.level}
              </span>
            </div>
            {fight !== "idle" && (
              <div className="mt-[2px] font-bold">
                <span className="text-[#e87a0d]">{spell.apCost} PA</span>
                <span className="text-[#7a7060]"> · portée </span>
                {spell.rangeMin === spell.rangeMax
                  ? spell.rangeMin
                  : `${spell.rangeMin}–${spell.rangeMax}`}
                {spell.cooldownRemaining > 0 && (
                  <span className="text-[#7a7060]">
                    {" · "}
                    {spell.cooldownRemaining} tour(s) restant(s)
                  </span>
                )}
              </div>
            )}
            {spell.description && (
              <div className="mt-[3px] font-normal text-[#3a3528]">
                {spell.description}
              </div>
            )}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

const ICON_BUTTONS = [
  { icon: "stats", panel: "stats" },
  { icon: "spells", panel: "spells" },
  { icon: "inventory", panel: "inventory" },
  { icon: "quests", panel: "quests" },
  { icon: "map", panel: "map" },
  { icon: "friends", panel: "friends" },
  { icon: "guild", panel: "guild" },
  { icon: "mount", panel: "mount" },
] as const;

interface BannerReactProps {
  /** Callback when a spell slot is clicked during a fight (cast/select). */
  onSelectSpell?: (spellId: number) => void;
}

export function BannerReact({ onSelectSpell }: BannerReactProps = {}) {
  const { stats } = useSyncExternalStore(
    characterStore.subscribe,
    characterStore.getSnapshot
  );
  const { spells } = useSyncExternalStore(
    spellsStore.subscribe,
    spellsStore.getSnapshot
  );

  const fight = useFightMode();
  const cast = useSpellCast();
  const { isFighting } = fight;

  // During a fight the live LP/LPmax for our sprite live in fightStore
  // (FIGHTER_UPSERT seeds them on placement, FIGHTER_UPDATE patches
  // them on every damage/heal/turn snapshot). characterStore.stats is
  // a roleplay snapshot taken at login and never refreshed mid-fight,
  // so reading it during combat shows pre-fight HP and never moves.
  // Outside combat the fightStore mirror is empty, so we fall back to
  // the character snapshot.
  const myFighter =
    isFighting && fight.mySpriteId
      ? fight.fighters.get(fight.mySpriteId)
      : undefined;
  const hp = myFighter?.hp ?? stats?.hp ?? 100;
  const maxHp = myFighter?.maxHp ?? stats?.maxHp ?? 100;

  /**
   * Project the SpellEntry list into fixed HOTBAR_SLOTS cells, keyed by
   * `position` (0-based). Positions outside the bar are dropped; duplicate
   * positions collide — the last one wins, matching Dofus 1.29's drag-and-
   * drop semantics. Out-of-bar spells (no position assigned) can live in
   * the Sorts panel later; for now they just don't show in the hotbar.
   */
  const hotbar = useMemo<(SpellEntry | null)[]>(() => {
    const slots: (SpellEntry | null)[] = Array(HOTBAR_SLOTS).fill(null);
    for (const s of spells) {
      if (s.position < 0 || s.position >= HOTBAR_SLOTS) continue;
      slots[s.position] = s;
    }
    return slots;
  }, [spells]);

  /**
   * Resolve fight-slot state per spell. Outside combat every slot is
   * "idle" (regular hotbar). Inside combat we mirror the old
   * FightSpellBar treatment: disabled when not our turn, then cooldown,
   * then pending/selected, then unaffordable, else ready.
   */
  const fightStates = useMemo<FightSlotState[]>(() => {
    if (!fight.isCombat) {
      return hotbar.map(() => "idle");
    }
    return hotbar.map((spell): FightSlotState => {
      if (!spell) return "idle";
      if (!fight.isMyTurn) return "disabled";
      if (spell.cooldownRemaining > 0) return "cooldown";
      const isSelected = cast.selectedSpellId === spell.spellId;
      if (isSelected && cast.isPending) return "pending";
      if (isSelected) return "selected";
      if (spell.apCost > fight.ap) return "unaffordable";
      return "ready";
    });
  }, [
    hotbar,
    fight.isCombat,
    fight.isMyTurn,
    fight.ap,
    cast.selectedSpellId,
    cast.isPending,
  ]);

  const handleIconClick = (panel: string) => {
    if (panel === "map") {
      toggleWorldMap();
    } else {
      togglePanel(panel as never);
    }
  };

  return (
    <div className="absolute bottom-0 left-1/2 -translate-x-1/2 pointer-events-auto z-10">
      <MainBanner mode={isFighting ? "fight" : "normal"}>
        <MainBannerChat />
        <MainBannerChatInput placeholder="Chat here..." />

        <MainBannerCircle>
          <Minimap />
        </MainBannerCircle>

        <MainBannerHeart hp={hp} max={maxHp} />

        <MainBannerButtons>
          {ICON_BUTTONS.map(({ icon, panel }) => (
            <MainBannerIconButton
              key={icon}
              icon={icon}
              onClick={() => handleIconClick(panel)}
            />
          ))}
        </MainBannerButtons>

        <MainBannerMorePanel>
          <MainBannerIconButton
            icon="pvp"
            onClick={() => togglePanel("conquest")}
          />
          <MainBannerIconButton icon="job" />
          <MainBannerIconButton icon="achievement" />
          <MainBannerIconButton icon="event" />
          <MainBannerIconButton icon="title" />
        </MainBannerMorePanel>
        <MainBannerRightPanel />

        <MainBannerGrid
          tabs={[
            { value: "spells", label: "Sorts" },
            { value: "items", label: "Obj." },
          ]}
        >
          <Tooltip.Provider>
            {hotbar.map((spell, i) => (
              <SpellHotbarCell
                key={i}
                spell={spell}
                fight={fightStates[i] ?? "idle"}
                onCast={onSelectSpell}
              />
            ))}
          </Tooltip.Provider>
        </MainBannerGrid>
      </MainBanner>
    </div>
  );
}
