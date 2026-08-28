---
id: QA-095
title: Des combattants restent sans case quand le bloc de placement est plus petit que le groupe
severity: P1
domain: fight
type: bug
status: fixed
session: 3
opened: 2026-08-28
closed:
fixed_in:
related: [QA-094]
files:
  - apps/gameserver-ts/src/core/modules/fight/core/fight.states.ts
---

## Symptôme

Sur certaines maps, le combat démarre avec moins de monstres que le groupe n'en
montrait, et le combat ne peut pas être gagné : les monstres manquants sont
vivants mais invisibles.

## Attendu (1.29)

Tout combattant engagé est posé sur une case du damier.

## Cause

`PlacementState.enter` (`fight.states.ts`) faisait `break` dès que les cases de
placement de l'équipe étaient épuisées. Les combattants restants gardaient
`cell = -1`, et `emitJoinFrames` les diffusait quand même avec `cellId: -1`, que
le client projette hors grille.

Le cas est courant, pas théorique :

```sql
select count(*) from maps m join map_fight_places p on p.map_id = m.id
 where m.monsters_raw <> '' and m.mob_size_max > length(p.places1)/2;
-- 52
```

615 maps embarquent moins de 8 cases côté monstres alors que
`maps.mob_size_max` monte à 8 (207 n'en ont aucune).

Second défaut au même endroit : `if (!startCell || …)` traite **la case 0 comme
fausse**. Aucun `places1` du bundle 1.29 ne contient la case 0 aujourd'hui, donc
il ne se déclenche pas — c'est une mine.

## Correctif

Quand le bloc est plein, `findOverflowCell` cherche en largeur, depuis le bloc
de l'équipe, une case libre et praticable qui n'appartient à aucun des deux
blocs de placement — bornée à deux couronnes. Aucun combattant n'est plus émis à
`cell = -1`. Le test de fin de liste passe par `=== undefined`.

## Vérification

`bun test src/core/modules/fight/core/fight.placement.spec.ts` — 4 cas, dont le
débordement, l'exclusion des deux blocs, et la case 0.
