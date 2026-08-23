import type { DecodedCell } from "@modules/maps/maps.cells-codec";
import { MapCacheService } from "@modules/maps/maps.cache.service";
import { MapsRepository } from "@modules/maps/maps.repository";
import { MonstersRepository } from "@modules/monsters/monsters.repository";
import { Injectable, Logger } from "@nestjs/common";

export interface LiveMonsterGroup {
  id: number;
  mapId: number;
  cellId: number;
  direction: number;
  members: LiveMonsterMember[];
  /**
   * Difficulty bonus, mirrors `dofus.datacenter.MonsterGroup._nBonusValue`
   * in canonical 1.29. Drives the 5-star colouring on the hover panel
   * (`TextWithTitleOverHead.STARS_COLORS`). Zero = no stars filled (a
   * baseline group). Server bumps this for elite spawns / event groups.
   */
  bonusValue: number;
}

export interface LiveMonsterMember {
  templateId: number;
  level: number;
  name: string;
  gfx: number;
  life: number;
  ap: number;
  mp: number;
  color1: number;
  color2: number;
  color3: number;
  spells: Array<{ spellId: number; level: number }>;
  /**
   * Fight rewards, carried from `monster_levels` all the way to
   * `Fighter.monsterXp` / `monsterKamasMin` / `monsterKamasMax`, which
   * `FightEndService` reads to build the end-of-fight payout.
   *
   * `monsters.repository.level()` already `selectAll()`s these three
   * columns — before QA-059 they were loaded from the database and then
   * dropped right here, so every PvM fight paid out zero.
   *
   * `xp` is a bigint in postgres and reaches us as a string; it is
   * narrowed to a number once, here, rather than at every read site.
   */
  xp: number;
  kamasMin: number;
  kamasMax: number;
}

interface MapMonsterState {
  groups: Map<number, LiveMonsterGroup>;
  walkable: number[];
}

// Negative IDs avoid collision with player character IDs (positive).
// Mirrors original Dofus 1.29 where monster groups use negative sprite IDs.
let nextGroupId = -1;

/**
 * Global map-scoped monster group manager. Groups are shared state —
 * every player on a map sees the same groups at the same positions.
 *
 * Lifecycle:
 *   - First player enters map → `ensureSpawned(mapId)` loads
 *     `monsters_raw` and spawns `numgroup` groups on random walkable cells.
 *   - All players on the map receive the same group list.
 *   - When a fight starts, `consumeGroup(groupId)` removes it globally
 *     and returns the group data for fight initialization.
 *   - Groups respawn on next map activation (player re-enters after
 *     all groups consumed or map evicted).
 *
 * Future: periodic movement via interval timer, respawn timers.
 */
@Injectable()
export class MapMonsterService {
  private readonly logger = new Logger(MapMonsterService.name);
  private readonly maps = new Map<number, MapMonsterState>();

  constructor(
    private readonly mapsRepo: MapsRepository,
    private readonly mapCache: MapCacheService,
    private readonly monsters: MonstersRepository
  ) {}

  async ensureSpawned(mapId: number): Promise<LiveMonsterGroup[]> {
    const existing = this.maps.get(mapId);
    if (existing && existing.groups.size > 0) {
      return [...existing.groups.values()];
    }

    const config = await this.mapsRepo.findMonsterConfig(mapId);
    if (!config?.monstersRaw) {
      return [];
    }

    const pool = parseMonsterPool(config.monstersRaw);
    if (pool.length === 0) {
      return [];
    }

    const cached = await this.mapCache.load(mapId);
    if (!cached) {
      return [];
    }

    const walkable = cached.cells
      .filter((c: DecodedCell) => c.walkable && c.movement > 0)
      .map((c: DecodedCell) => c.id);

    if (walkable.length === 0) {
      return [];
    }

    const state: MapMonsterState = { groups: new Map(), walkable };
    const usedCells = new Set<number>();

    for (let g = 0; g < config.numgroup; g++) {
      const size = randBetween(config.mobSizeMin, config.mobSizeMax);

      const cellId = pickCell(walkable, usedCells);
      if (cellId === undefined) {
        break;
      }

      const members = await this.buildMembers(pool, size);
      if (members.length === 0) {
        continue;
      }

      const groupId = nextGroupId--;
      state.groups.set(groupId, {
        id: groupId,
        mapId,
        cellId,
        direction: Math.floor(Math.random() * 4) * 2 + 1,
        members,
        // Baseline groups have no bonus — five empty stars on the hover
        // panel. Elite / quest spawns can override this when they inject
        // their own LiveMonsterGroup via `consumeGroup` upstream.
        bonusValue: 0,
      });
    }

    this.maps.set(mapId, state);
    this.logger.log(
      `spawned ${state.groups.size} monster groups on map=${mapId}`
    );

    return [...state.groups.values()];
  }

  groupsOnMap(mapId: number): LiveMonsterGroup[] {
    const state = this.maps.get(mapId);
    return state ? [...state.groups.values()] : [];
  }

  findGroupAtCell(mapId: number, cellId: number): LiveMonsterGroup | undefined {
    const state = this.maps.get(mapId);
    if (!state) {
      return undefined;
    }
    for (const g of state.groups.values()) {
      if (g.cellId === cellId) {
        return g;
      }
    }
    return undefined;
  }

  consumeGroup(groupId: number): LiveMonsterGroup | undefined {
    for (const state of this.maps.values()) {
      const group = state.groups.get(groupId);
      if (group) {
        state.groups.delete(groupId);
        return group;
      }
    }
    return undefined;
  }

  walkableCells(mapId: number): number[] {
    return this.maps.get(mapId)?.walkable ?? [];
  }

  clearMap(mapId: number): void {
    this.maps.delete(mapId);
  }

  private async buildMembers(
    pool: MonsterPoolEntry[],
    size: number
  ): Promise<LiveMonsterMember[]> {
    const members: LiveMonsterMember[] = [];

    for (let i = 0; i < size; i++) {
      const pick = pool[Math.floor(Math.random() * pool.length)]!;
      const template = await this.monsters.template(pick.templateId);
      if (!template) {
        continue;
      }

      const levelData = await this.monsters.level(pick.templateId, pick.level);

      members.push({
        templateId: pick.templateId,
        level: pick.level,
        name: template.name,
        gfx: template.gfx,
        life: levelData?.life ?? 50,
        ap: levelData?.ap ?? 6,
        mp: levelData?.mp ?? 3,
        color1: template.color1,
        color2: template.color2,
        color3: template.color3,
        spells: parseSpells(levelData?.spells),
        xp: Number(levelData?.xp ?? 0),
        kamasMin: levelData?.kamasMin ?? 0,
        kamasMax: levelData?.kamasMax ?? 0,
      });
    }

    return members;
  }
}

type MonsterPoolEntry = { templateId: number; level: number };

function parseMonsterPool(raw: string): MonsterPoolEntry[] {
  const pool: MonsterPoolEntry[] = [];
  for (const part of raw.split("|").filter(Boolean)) {
    const [idStr, levelStr] = part.split(",");
    if (!idStr || !levelStr) {
      continue;
    }
    const templateId = Number(idStr);
    const level = Number(levelStr);
    if (templateId > 0 && level > 0) {
      pool.push({ templateId, level });
    }
  }
  return pool;
}

function parseSpells(raw: unknown): Array<{ spellId: number; level: number }> {
  if (!Array.isArray(raw)) {
    return [];
  }
  const result: Array<{ spellId: number; level: number }> = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const e = entry as Record<string, unknown>;
    const spellId = Number(e.spellId ?? e.id ?? 0);
    const level = Number(e.level ?? 1);
    if (spellId > 0) {
      result.push({ spellId, level });
    }
  }
  return result;
}

function pickCell(walkable: number[], used: Set<number>): number | undefined {
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = walkable[Math.floor(Math.random() * walkable.length)]!;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  return undefined;
}

function randBetween(min: number, max: number): number {
  return min === max ? min : min + Math.floor(Math.random() * (max - min + 1));
}
