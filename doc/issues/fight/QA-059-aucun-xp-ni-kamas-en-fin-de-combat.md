---
id: QA-059
title: XP et kamas toujours nuls en fin de combat
severity: P1
domain: fight
type: bug
status: in-progress
session: 2
opened: 2026-08-23
closed:
fixed_in:
related: [QA-060, QA-058]
files:
  - apps/gameserver-ts/src/core/features/game/fight-start/fight-start.service.ts:306-325
  - apps/gameserver-ts/src/core/modules/monsters/map-monster.service.ts:22-34
  - apps/gameserver-ts/src/core/modules/fight/core/fight.fighter.ts:27-29
---

## Symptôme

Un combat PvM gagné ne rapporte ni expérience ni kamas. Constaté manette en
main.

## Cause

`FightEndService` calcule bien la récompense — `totalXp += f.monsterXp`, tirage
aléatoire entre `monsterKamasMin` et `monsterKamasMax`, répartition entre les
vainqueurs, `levelUp()` si le seuil est franchi. Toute la chaîne de distribution
est écrite.

Mais les trois champs qu'elle lit sont déclarés à zéro dans `Fighter` et
**ne sont assignés nulle part** :

```ts
monsterXp = 0;
monsterKamasMin = 0;
monsterKamasMax = 0;
```

`addMonsters()` recopie `templateId`, `gfx`, `level`, les couleurs et les sorts
depuis `LiveMonsterMember`, mais `LiveMonsterMember` ne porte pas les trois
champs de récompense — ils sont perdus un étage plus haut.

La donnée existe pourtant : `monster_levels` porte `xp`, `kamasMin` et
`kamasMax`, et le dépôt fait déjà `selectAll()` sur cette table. **Les valeurs
sont chargées depuis la base puis jetées.**

## Correctif

Ajouter les trois champs à `LiveMonsterMember`, les recopier dans
`addMonsters()`. Aucune requête supplémentaire, aucune migration.

## Vérification

Tuer un groupe et lire `[FightEnd] … xp: N, kamas: N` avec N > 0 dans les logs,
puis `select experience, kamas from players` avant / après.
