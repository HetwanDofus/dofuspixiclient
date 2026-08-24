---
id: QA-077
title: Le débit de kamas du zaap n'était pas atomique
severity: P2
domain: inventory
type: bug
status: fixed
session: 3
opened: 2026-08-23
closed:
fixed_in:
related: []
files:
  - apps/gameserver-ts/src/core/modules/players/players.repository.ts
  - apps/gameserver-ts/src/core/modules/waypoints/waypoints.service.ts
---

## Symptôme

`PlayersRepository.addXpAndKamas(playerId, xp, kamas)` accepte un delta signé
et n'a aucun garde-fou de solde ; `WaypointsService.teleportViaZaap` lisait
`players.kamas`, comparait au coût, puis appelait `addXpAndKamas(id, 0,
-cost)` dans une requête séparée — un lire-puis-écrire classique. Deux
téléportations envoyées au même instant peuvent toutes deux lire un solde
suffisant avant que l'une ou l'autre n'écrive, et passer toutes les deux.

## Cause

`PlayersRepository` n'avait pas d'équivalent kamas au motif déjà utilisé pour
les points de caractéristiques et de sorts —
`spendStatPoints`/`spendSpellPoints` portent leur prédicat de solde dans
l'`UPDATE` lui-même (`.where("statsPoints", ">=", cost)`), ce qui rend deux
débits concurrents mutuellement exclusifs sans transaction explicite.
`addXpAndKamas` n'a jamais eu ce prédicat.

## Correctif

`spendKamas(playerId, amount)` ajouté à `PlayersRepository`, même patron que
`spendStatPoints` : le prédicat `kamas >= amount` vit dans l'`UPDATE`,
retourne le nombre de lignes touchées, `0` = refus. `WaypointsService`
l'utilise à la place du lire-puis-écrire ; `addXpAndKamas` reste inchangé
pour les crédits (XP + kamas de fin de combat), qui n'ont pas ce problème
car ils ne peuvent jamais faire passer un solde sous zéro.

## Vérification

`bun test src/core/modules/waypoints` et `src/core/modules/players` restent
verts. Non-régression manuelle : un zaap avec un solde suffisant débite
toujours et téléporte ; le comportement observable ne change pas, seule la
garantie de concurrence est nouvelle.
