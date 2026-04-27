import type { Scope } from "@modules/fight/effects/fight.effect-registry.types";
import { Fighter } from "@modules/fight/core/fight.fighter";
import { EffectHandler } from "@modules/fight/effects/fight.effect-handler.decorator";
import { FighterKind } from "@modules/fight/fight.types";
import { Injectable } from "@nestjs/common";

let summonIdCounter = -1000;

@Injectable()
export class SummonEffectHandler {
  @EffectHandler(185)
  handleSummon(scope: Scope): void {
    const { fight, caster, targetCell, effect } = scope;
    const templateId = effect.special;
    if (templateId <= 0) {
      return;
    }

    // Check max summons (default 1)
    const maxSummons = caster.stats.get(30) || 1; // Characteristic.MaxSummons = 30
    const currentSummons = fight
      .fighters()
      .filter((f) => f.invocatorId === caster.id && !f.dead).length;
    if (currentSummons >= maxSummons) {
      return;
    }

    // Check cell is free
    if (!fight.fightMap.isFree(targetCell)) {
      return;
    }

    // Create summoned fighter
    summonIdCounter--;
    const summon = new Fighter(
      summonIdCounter,
      FighterKind.Invocation,
      "Summon",
      effect.min > 0 ? effect.min : 20, // HP from effect min or default
      4, // AP
      2, // MP
      3 // direction
    );
    summon.monsterTemplateId = templateId;
    summon.monsterGfx = templateId; // simplified: gfx = template ID
    summon.monsterLevel = caster.level;
    summon.invocatorId = caster.id;

    // Add to caster's team
    const team = caster.team;
    if (!team) {
      return;
    }
    team.add(summon);
    summon.cell = targetCell;
    fight.fightMap.occupy(targetCell, summon.id);

    // TODO: broadcast summon sprite add to all fight participants
  }
}
