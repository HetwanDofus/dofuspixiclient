import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import {
  classSpellRank,
  isClassSpell,
  loadClassesLang,
} from "@/game/lang/classes-lang";
import { characterStore } from "@/game/stores";
import {
  MAX_SPELL_LEVEL,
  type SpellEntry,
  spellsStore,
  spellUpgradeCost,
} from "@/game/stores/spells-store";
import {
  HOTBAR_DRAG_IMAGE_ATTR,
  hotbarDragProps,
} from "@/hud/banner/hotbar-dnd";

import { Panel } from "../components/Panel";
import { Scrollbar } from "../components/Scrollbar";
import { SpellIconMount } from "./SpellIconMount";
import { type SpellTypeFilter, SpellTypeSelect } from "./SpellTypeSelect";
import { SPELL_BOOK_COLORS, SPELL_LIST_METRICS } from "./spell-book-theme";

interface SpellsPanelProps {
  onClose: () => void;
  zoom?: number;
  /** Spell whose detail panel is open, so the row can render selected. */
  selectedSpellId: number | null;
  onSelectSpell: (spellId: number) => void;
  onUpgradeSpell: (spellId: number) => void;
}

const M = SPELL_LIST_METRICS;
const C = SPELL_BOOK_COLORS;

/**
 * "Tes sorts" — the spell book's list panel.
 *
 * Layout is a 1:1 transcription of the retail 1.29 window (see
 * `spell-book-theme.ts` for how the numbers were derived): a capital
 * counter, a spell-type filter, then a fixed 10-row viewport over the
 * player's spells with its own scrollbar.
 *
 * Every row is a button: clicking opens the spell in the detail panel,
 * and the `+` appears only when the player can actually afford the next
 * level. Affordability is re-checked server-side — this only decides
 * whether the button is drawn.
 */
export function SpellsPanel({
  onClose,
  zoom = 1,
  selectedSpellId,
  onSelectSpell,
  onUpgradeSpell,
}: SpellsPanelProps) {
  const p = (n: number) => n * zoom;

  const { spells } = useSyncExternalStore(
    spellsStore.subscribe,
    spellsStore.getSnapshot
  );
  const { classId, stats } = useSyncExternalStore(
    characterStore.subscribe,
    characterStore.getSnapshot
  );

  const [filter, setFilter] = useState<SpellTypeFilter>("class");
  const [scrollTop, setScrollTop] = useState(0);
  const [classesReady, setClassesReady] = useState(false);

  // The breed→spells table only gates the "Classe" filter, so it can
  // land after the first paint; re-render once it does.
  useEffect(() => {
    let cancelled = false;
    loadClassesLang().then(() => {
      if (!cancelled) {
        setClassesReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const spellPoints = stats?.bonusPointsSpell ?? 0;

  // classesReady is not read below: it re-runs the memo once the breed
  // table lands, so isClassSpell stops answering "everything".
  // biome-ignore lint/correctness/useExhaustiveDependencies: classesReady is a re-run trigger, not an input.
  const visible = useMemo(() => {
    // Spell 0 is the weapon attack, which the book never lists. Every
    // other id is fair game: breed spells run from 1 (Féca's Armure
    // Aqueuse) to 705 (Pandawa), so there is no low-id range to skip.
    const known = spells.filter((s) => s.spellId > 0);
    const filtered =
      filter === "class"
        ? known.filter((s) => isClassSpell(classId, s.spellId))
        : known;
    // Obtention order, always — never `position`. The book listed
    // itself by hotbar slot until the bar became draggable, at which
    // point rearranging the bar reshuffled the book underneath it.
    // Learn level first, the class bundle's own order for the spells
    // that share one (three starters all say level 1), spell id last so
    // the sort is total.
    return [...filtered].sort((a, b) => {
      if (a.learnLevel !== b.learnLevel) {
        return a.learnLevel - b.learnLevel;
      }
      // Subtracting would turn "both unlisted" (∞ − ∞) into NaN, so
      // compare instead: two unlisted spells tie and fall through.
      const aRank = classSpellRank(classId, a.spellId);
      const bRank = classSpellRank(classId, b.spellId);
      if (aRank !== bRank) {
        return aRank < bRank ? -1 : 1;
      }
      return a.spellId - b.spellId;
    });
  }, [spells, filter, classId, classesReady]);

  const viewportHeight = M.rowHeight * M.visibleRows;
  const contentHeight = M.rowHeight * visible.length;
  const maxScroll = Math.max(0, contentHeight - viewportHeight);
  const clampedScroll = Math.min(scrollTop, maxScroll);
  const scrollable = maxScroll > 0;

  const listWidth =
    M.width - 2 * M.border - 2 * M.gutter - (scrollable ? M.scrollbarWidth : 0);

  return (
    <Panel
      title="Tes sorts"
      width={M.width}
      height={M.height}
      onClose={onClose}
      zoom={zoom}
      style={{ background: C.body }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          color: C.text,
          fontFamily: "Verdana, sans-serif",
          overflow: "hidden",
        }}
      >
        {/* Capital sorts */}
        <Row centerY={p(M.capitalRowCenter)} gutter={p(M.gutter)}>
          <span style={{ fontSize: p(9) }}>Capital sorts</span>
          <span style={{ fontSize: p(10), fontWeight: "bold" }}>
            {spellPoints}
          </span>
        </Row>

        {/* Type de sort + filter dropdown */}
        <Row centerY={p(M.typeRowCenter)} gutter={p(M.gutter)}>
          <span style={{ fontSize: p(9) }}>Type de sort</span>
        </Row>
        <div
          style={{
            position: "absolute",
            right: p(M.gutter),
            top: p(M.dropdownTop),
            width: p(M.dropdownWidth),
            height: p(M.dropdownHeight),
          }}
        >
          <SpellTypeSelect value={filter} onChange={setFilter} zoom={zoom} />
        </div>

        {/* Column header */}
        <div
          style={{
            position: "absolute",
            left: p(M.gutter),
            right: p(M.gutter),
            top: p(M.listTop),
            height: p(M.columnHeader),
            display: "flex",
            alignItems: "center",
            background: C.header,
            color: C.headerText,
            fontSize: p(9),
          }}
        >
          <span style={{ flex: 2, textAlign: "center" }}>Nom</span>
          <span style={{ flex: 1, textAlign: "center" }}>Niveau</span>
        </div>

        {/* Row viewport + scrollbar */}
        <div
          style={{
            position: "absolute",
            left: p(M.gutter),
            right: p(M.gutter),
            top: p(M.listTop + M.columnHeader),
            height: p(viewportHeight),
            display: "flex",
          }}
        >
          <div
            style={{ width: p(listWidth), height: "100%", overflow: "hidden" }}
            onWheel={(e) => {
              if (!scrollable) {
                return;
              }
              e.stopPropagation();
              setScrollTop((prev) =>
                Math.max(
                  0,
                  Math.min(maxScroll, prev + Math.sign(e.deltaY) * M.rowHeight)
                )
              );
            }}
          >
            <div
              style={{
                transform: `translateY(${p(-clampedScroll)}px)`,
                willChange: "transform",
              }}
            >
              {visible.map((spell, index) => (
                <SpellRow
                  key={spell.spellId}
                  spell={spell}
                  index={index}
                  selected={spell.spellId === selectedSpellId}
                  spellPoints={spellPoints}
                  width={listWidth}
                  zoom={zoom}
                  onSelect={onSelectSpell}
                  onUpgrade={onUpgradeSpell}
                />
              ))}
            </div>
          </div>

          {scrollable && (
            <Scrollbar
              zoom={zoom}
              width={M.scrollbarWidth}
              scrollTop={clampedScroll}
              maxScroll={maxScroll}
              viewportHeight={viewportHeight}
              contentHeight={contentHeight}
              step={M.rowHeight}
              onScroll={setScrollTop}
              trackColor={SPELL_BOOK_COLORS.scrollTrack}
              thumbColor={SPELL_BOOK_COLORS.header}
            />
          )}
        </div>
      </div>
    </Panel>
  );
}

function Row({
  centerY,
  gutter,
  children,
}: {
  centerY: number;
  gutter: number;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: gutter,
        right: gutter,
        top: centerY,
        transform: "translateY(-50%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      {children}
    </div>
  );
}

interface SpellRowProps {
  spell: SpellEntry;
  index: number;
  selected: boolean;
  spellPoints: number;
  width: number;
  zoom: number;
  onSelect: (spellId: number) => void;
  onUpgrade: (spellId: number) => void;
}

function SpellRow({
  spell,
  index,
  selected,
  spellPoints,
  width,
  zoom,
  onSelect,
  onUpgrade,
}: SpellRowProps) {
  const p = (n: number) => n * zoom;
  const [hovered, setHovered] = useState(false);

  const atMax = spell.level >= MAX_SPELL_LEVEL;
  const cost = spellUpgradeCost(spell.level);
  // The character-level requirement is only known once the detail panel
  // has fetched the level table, so the row gates on affordability alone
  // and lets the server reject the rest — exactly what retail does, where
  // clicking `+` on a too-low character produces an error message.
  const canAfford = !atMax && spellPoints >= cost;

  const background = selected
    ? C.rowSelected
    : hovered
      ? C.rowHover
      : index % 2 === 0
        ? C.rowEven
        : C.rowOdd;

  return (
    // biome-ignore lint/a11y/useSemanticElements: the row holds the + button, and a <button> cannot legally nest one.
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(spell.spellId)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(spell.spellId);
        }
      }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      // Drag source for the hotbar. The bar sends the SM frame; this
      // row only says which spell left the book.
      {...hotbarDragProps({ kind: "spell", spellId: spell.spellId })}
      style={{
        position: "relative",
        width: p(width),
        height: p(M.rowHeight),
        background,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: p(6),
        paddingLeft: p(3),
        paddingRight: p(3),
        boxSizing: "border-box",
      }}
    >
      <div
        // The row is the drag source, but the icon is what gets dragged:
        // without this the cursor tows the whole strip — name, level and
        // `+` button — instead of the thing that lands in the slot.
        {...{ [HOTBAR_DRAG_IMAGE_ATTR]: "" }}
        style={{
          position: "relative",
          width: p(M.iconSize),
          height: p(M.iconSize),
          flexShrink: 0,
        }}
      >
        <SpellIconMount spellId={spell.spellId} label={spell.name} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: p(4),
          }}
        >
          <span
            style={{
              fontSize: p(9),
              fontWeight: "bold",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {spell.name}
          </span>
          <span
            style={{
              fontSize: p(9),
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            Niv. {spell.level}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: p(4),
            color: C.textMuted,
            fontSize: p(8),
            marginTop: p(1),
          }}
        >
          <span style={{ whiteSpace: "nowrap" }}>
            {spell.apCost} PA
            <span
              style={{ display: "inline-block", width: p(M.costRangeGap) }}
            />
            {formatRange(spell.rangeMin, spell.rangeMax)} PO
          </span>
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: p(3),
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {!atMax && <>Coût du niveau suivant : {cost}</>}
            {canAfford && (
              <PlusButton
                zoom={zoom}
                label={`Améliorer ${spell.name} au niveau ${spell.level + 1}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onUpgrade(spell.spellId);
                }}
              />
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

function PlusButton({
  zoom,
  label,
  onClick,
}: {
  zoom: number;
  label: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  const p = (n: number) => n * zoom;
  const [pressed, setPressed] = useState(false);
  const size = p(12);

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      style={{
        width: size,
        height: size,
        padding: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: C.plus,
        border: `${Math.max(1, p(1))}px solid ${C.plusBorder}`,
        boxSizing: "border-box",
        cursor: "pointer",
        filter: pressed ? "brightness(0.85)" : "none",
        flexShrink: 0,
      }}
    >
      <svg
        width={size * 0.7}
        height={size * 0.7}
        viewBox="0 0 10 10"
        aria-hidden="true"
      >
        <path d="M4 0h2v4h4v2H6v4H4V6H0V4h4z" fill={C.plusText} />
      </svg>
    </button>
  );
}

/**
 * Range as the book prints it: `1-8`, or just the maximum when the
 * minimum is 0. Retail keeps `1-1` (La Bloqueuse) but writes a 0..5
 * range as plain `5` — the zero is what it elides, not the repetition.
 */
function formatRange(min: number, max: number): string {
  return min === 0 ? String(max) : `${min}-${max}`;
}
