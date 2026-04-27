import type {
  Buff,
  StatModifier,
} from "@modules/fight/effects/fight.buff.types";
import { emptyStatModifier } from "@modules/fight/effects/fight.buff.types";

export type {
  Buff,
  CastContext,
  DamageContext,
  StatModifier,
} from "@modules/fight/effects/fight.buff.types";
export { emptyStatModifier } from "@modules/fight/effects/fight.buff.types";

export class BuffList {
  private items: Buff[] = [];
  private nextId = 0;

  add(b: Buff): void {
    this.nextId++;
    b.id = this.nextId;
    this.items.push(b);
  }

  each(fn: (b: Buff) => void): void {
    const snap = [...this.items];
    for (const b of snap) {
      fn(b);
    }
  }

  remove(id: number): Buff | undefined {
    const idx = this.items.findIndex((b) => b.id === id);
    if (idx === -1) {
      return undefined;
    }
    return this.items.splice(idx, 1)[0];
  }

  tickDown(): Buff[] {
    const expired: Buff[] = [];
    this.items = this.items.filter((b) => {
      if (b.remaining < 0) {
        return true;
      }
      if (b.remaining === 0) {
        expired.push(b);
        return false;
      }
      b.remaining--;
      return true;
    });
    return expired;
  }

  summary(): StatModifier {
    const total = emptyStatModifier();
    for (const b of this.items) {
      const sm = b.statModifier;
      total.ap += sm.ap;
      total.mp += sm.mp;
      total.strength += sm.strength;
      total.intelligence += sm.intelligence;
      total.chance += sm.chance;
      total.agility += sm.agility;
      total.wisdom += sm.wisdom;
      total.vitality += sm.vitality;
      total.power += sm.power;
      total.range += sm.range;
      total.damageBonus += sm.damageBonus;
      total.damagePct += sm.damagePct;
      total.healBonus += sm.healBonus;
      total.reflectFlat += sm.reflectFlat;
      total.reflectPct += sm.reflectPct;
      total.criticalHit += sm.criticalHit;
      total.criticalResist += sm.criticalResist;
      total.armorFlat += sm.armorFlat;
      total.resistFlat[0] += sm.resistFlat[0];
      total.resistFlat[1] += sm.resistFlat[1];
      total.resistFlat[2] += sm.resistFlat[2];
      total.resistFlat[3] += sm.resistFlat[3];
      total.resistFlat[4] += sm.resistFlat[4];
      total.resistPct[0] += sm.resistPct[0];
      total.resistPct[1] += sm.resistPct[1];
      total.resistPct[2] += sm.resistPct[2];
      total.resistPct[3] += sm.resistPct[3];
      total.resistPct[4] += sm.resistPct[4];
    }
    return total;
  }

  clear(): void {
    this.items = [];
  }
}
