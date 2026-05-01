import { Tooltip } from "@base-ui/react/tooltip";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

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
import { getSpellIconRenderer } from "@/game/render/spell-icon-renderer";
import { togglePanel, toggleWorldMap } from "@/game/stores";
import { characterStore } from "@/game/stores/character-store";
import { type SpellEntry, spellsStore } from "@/game/stores/spells-store";
import { useFightMode } from "@/hud/fight/useFightMode";

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

/**
 * Mount a live HTMLCanvasElement into the hotbar slot. The host div is
 * `inset: 0` in the slot, so its size equals the slot's. A ResizeObserver
 * reads that size and asks SpellIconRenderer for a canvas whose natural
 * dimensions are exactly `pixelSize × pixelSize` — no CSS scaling, no
 * blur, regardless of the game's `--resolution-factor`.
 *
 * The global `.map-renderer canvas { image-rendering: pixelated }` rule
 * (MapRenderer.tsx) would otherwise cascade in and snap this to nearest-
 * neighbour. Override to `auto` — the canvas IS pixel-perfect so default
 * smooth rendering is fine, and if a stray subpixel scale shows up we'd
 * rather smooth-sample than hard-crunch.
 */
function SpellIconMount({
  spellId,
  label,
}: {
  spellId: number;
  label: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [pixelSize, setPixelSize] = useState(0);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);

  // Measure the slot (via the host div it contains) and republish as
  // integer pixels. Integer so cache keys don't thrash on sub-pixel layout
  // noise, and a 1 px off-axis rect doesn't invalidate the cache.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(() => {
      const rect = host.getBoundingClientRect();
      const size = Math.max(0, Math.round(Math.max(rect.width, rect.height)));
      setPixelSize(size);
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  // Pull the canvas for the current (spellId, pixelSize). `pull` re-peeks
  // from the renderer cache after each await so an out-of-order promise
  // resolution (e.g., from a prior pixelSize) can't clobber newer state.
  useEffect(() => {
    if (pixelSize <= 0) return;
    const renderer = getSpellIconRenderer();
    let cancelled = false;

    const pull = () => {
      if (cancelled) return;
      const cached = renderer.peekCanvas(spellId, pixelSize);
      if (cached) {
        setCanvas(cached);
        return;
      }
      renderer.getCanvas(spellId, pixelSize).then(() => {
        if (cancelled) return;
        const current = renderer.peekCanvas(spellId, pixelSize);
        if (current) setCanvas(current);
      });
    };

    const unsubscribe = renderer.subscribe(spellId, pixelSize, pull);
    // HUD mounts before battlefield bootstrap wires Vello/Pixi; retry
    // once the renderer latches.
    const unsubscribeReady = renderer.subscribeReady(pull);
    pull();

    return () => {
      cancelled = true;
      unsubscribe();
      unsubscribeReady();
    };
  }, [spellId, pixelSize]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !canvas) return;
    // Canvas intrinsic size = `Math.round(slot)` (integer pixels), slot CSS
    // size may be fractional (e.g. 48.72 px at resolution-factor 1.9488).
    // `width/height: 100%` pins the canvas's CSS box to the slot exactly,
    // leaving only a sub-pixel downscale (imperceptible + smooth-filtered).
    // Without these the canvas renders at its intrinsic integer size and
    // overflows the slot by the rounding delta.
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    // Contain + center keeps the icon aligned in the slot even if Vello's
    // tight-bounds output isn't perfectly square (non-square content would
    // otherwise stretch in one axis, looking lopsided).
    canvas.style.objectFit = "contain";
    canvas.style.objectPosition = "center";
    canvas.style.pointerEvents = "none";
    // Override the global `.map-renderer canvas { image-rendering: pixelated }`
    // rule (MapRenderer.tsx) which would otherwise snap this to nearest-
    // neighbour and look crunchy on the sub-pixel downscale.
    canvas.style.imageRendering = "auto";
    canvas.setAttribute("aria-label", label);
    canvas.setAttribute("role", "img");
    host.replaceChildren(canvas);
    return () => {
      if (host.contains(canvas)) host.removeChild(canvas);
    };
  }, [canvas, label]);

  // Icon fills the slot flush with the beveled inner edge — matches
  // the original where the icon frame sits directly against the slot
  // bevel with no intermediate sand gap.
  return <div ref={hostRef} className="absolute inset-0 pointer-events-none" />;
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
  const handleClick = clickable && onCast ? () => onCast(spell.spellId) : undefined;
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
    characterStore.getSnapshot,
  );
  const { spells } = useSyncExternalStore(
    spellsStore.subscribe,
    spellsStore.getSnapshot,
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
  }, [hotbar, fight.isCombat, fight.isMyTurn, fight.ap, cast.selectedSpellId, cast.isPending]);

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
