import type { MonsterSpell } from "@modules/fight/cast/fight.spell";
import type { PlayerSnapshot } from "@modules/fight/core/fight.fighter.types";
import type { FightTeam } from "@modules/fight/core/fight.team";
import { FightStateBitmap } from "@modules/fight/core/fight.state-bitmap";
import { BuffList } from "@modules/fight/effects/fight.buff";
import { CharacteristicStack } from "@modules/fight/effects/fight.characteristic-stack";
import { Characteristic, FighterKind } from "@modules/fight/fight.types";
import { clampFightDirection } from "@dofus/grid";

export type { PlayerSnapshot } from "@modules/fight/core/fight.fighter.types";

export class Fighter {
  readonly id: number;
  readonly kind: FighterKind;
  readonly name: string;
  sessionId: string;
  player: PlayerSnapshot | null;
  readonly buffs: BuffList;
  readonly states: FightStateBitmap;
  readonly stats: CharacteristicStack;

  monsterTemplateId = 0;
  monsterGfx = 0;
  monsterColor1 = -1;
  monsterColor2 = -1;
  monsterColor3 = -1;
  monsterXp = 0;
  monsterKamasMin = 0;
  monsterKamasMax = 0;
  monsterLevel = 0;
  invocatorId = 0;

  team: FightTeam | null = null;
  cell = -1;
  ready = false;
  lp: number;
  lpMax: number;
  ap: number;
  mp: number;
  dead = false;
  direction: number;
  damageDealt = 0;
  damageTaken = 0;
  hasLeftFight = false;
  monsterSpells: MonsterSpell[] = [];

  constructor(
    id: number,
    kind: FighterKind,
    name: string,
    lp: number,
    ap: number,
    mp: number,
    direction: number
  ) {
    this.id = id;
    this.kind = kind;
    this.name = name;
    this.sessionId = "";
    this.player = null;
    this.buffs = new BuffList();
    this.states = new FightStateBitmap();
    this.stats = new CharacteristicStack();
    this.lp = lp;
    this.lpMax = lp;
    this.ap = ap;
    this.mp = mp;
    // Clamp to fight directions {1,3,5,7} on entry — keeps the
    // server's tracked value coherent with what the client renders
    // (PlayerRenderer.setDirection clamps anyway). Fighters that come
    // from a roleplay PlayerSnapshot with an even direction would
    // otherwise let the cast handler's `if (facing !== direction)`
    // suppress legitimate re-emits.
    this.direction = clampFightDirection(direction);
  }

  static fromPlayer(sessionId: string, p: PlayerSnapshot): Fighter {
    const f = new Fighter(
      p.id,
      FighterKind.Player,
      p.name,
      p.life,
      6,
      3,
      p.direction
    );
    // Constructor sets lpMax = lp; override with the authoritative
    // computed max so a player coming in mid-recovery (e.g. 200/1050)
    // doesn't have their cap clamped down to the current LP. When
    // lifeMax is omitted (test fixtures), keep lpMax = life.
    f.lpMax = Math.max(p.lifeMax ?? p.life, p.life);
    f.sessionId = sessionId;
    f.player = p;
    f.stats.setBase(Characteristic.Strength, p.stats.strength);
    f.stats.setBase(Characteristic.Vitality, p.stats.vitality);
    f.stats.setBase(Characteristic.Wisdom, p.stats.wisdom);
    f.stats.setBase(Characteristic.Intelligence, p.stats.intelligence);
    f.stats.setBase(Characteristic.Chance, p.stats.chance);
    f.stats.setBase(Characteristic.Agility, p.stats.agility);
    f.stats.setBase(Characteristic.ActionPoints, 6);
    f.stats.setBase(Characteristic.MovementPoints, 3);
    return f;
  }

  setLp(v: number): void {
    this.lp = v;
    if (v <= 0) {
      this.dead = true;
    }
  }

  revive(amount: number): number {
    if (!this.dead) {
      return this.lp;
    }
    const clamped = Math.max(1, Math.min(amount, this.lpMax));
    this.lp = clamped;
    this.dead = false;
    return clamped;
  }

  isInvocation(): boolean {
    if (this.invocatorId !== 0) {
      return true;
    }
    return (
      this.kind === FighterKind.Invocation ||
      this.kind === FighterKind.Static ||
      this.kind === FighterKind.Double
    );
  }

  get level(): number {
    return this.player ? this.player.level : this.monsterLevel;
  }

  spendAp(n: number): void {
    this.ap -= n;
  }

  spendMp(n: number): void {
    this.mp -= n;
  }

  resetAp(v: number): void {
    this.ap = v;
  }

  resetMp(v: number): void {
    this.mp = v;
  }

  markLeftFight(): void {
    this.hasLeftFight = true;
  }
}
