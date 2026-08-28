---
id: QA-099
title: Les PNJ marqués mobiles ne déambulent pas — leur chemin n'est jamais rejoué
severity: P3
domain: world-render
type: gap
status: fixed
session: 3
opened: 2026-08-28
closed:
fixed_in:
related: [QA-093]
files:
  - apps/gameserver-ts/migrations/0052_npc_dialog_graph.ts
  - apps/gameserver-ts/scripts/import-starloco-content.ts
  - apps/gameserver-ts/src/core/modules/npcs/npc-wander.path.ts
  - apps/gameserver-ts/src/core/modules/npcs/npc-wander.service.ts
---

## Symptôme

Tous les PNJ sont figés. Le dump marque pourtant 73 placements `isMovable = 1`,
et 57 templates portent un `path` de patrouille (`"G2;B1"`, `"B1;G3;D1;G2"`).
Ni la colonne ni le drapeau n'étaient importés.

Le croisement des deux ne donne que **14 placements** réellement mobiles ;
c'est de l'ambiance, pas un sous-système, et le correctif est dimensionné pour
ça.

## Cause

`npc_templates` n'avait pas de colonne `path`, `scripted_npcs` pas de colonne
`is_movable`, et rien côté serveur ne faisait bouger un sprite hors combat.

## Correctif

Les deux colonnes arrivent avec la migration 0052 (même réimport que le graphe
de dialogue). `NpcWanderService` tique toutes les 6 s et ne regarde que les maps
déjà résolues **et** occupées par un joueur : monde vide, aucun travail.

Aucun encodage de chemin n'a été nécessaire. Le client anime n'importe quel
sprite qui n'est pas le sien sur `GameAction` / `ACTION_MOVEMENT` avec
`path_cells`, et n'acquitte pas ceux-là (`map.handler.ts` `handleActorPath`) —
donc pas de `rawParams`, pas de move en attente.

Deux détails qui ne se voient pas :

Le compteur de `sequenceId` est distinct de celui de `PendingMovesService` et
compte à l'envers. `MoveAckHandler` apparie un `GameActionAck` sur l'id seul ;
un pas de PNJ dans la même plage pourrait acquitter le déplacement d'un joueur.

Un PNJ en conversation ne bouge pas — canonique, et sans ça il sort du champ
pendant que le joueur lit.

Le chemin va jusqu'au bout puis se rejoue à l'envers, plutôt que de boucler :
aucune route du dump ne se referme sur elle-même (`"G2;B1"` laisserait le PNJ
une case plus bas à gauche à chaque cycle, dérivant indéfiniment).

**Réserve.** La table `H`/`B`/`G`/`D` → `NORTH`/`SOUTH`/`WEST`/`EAST` est déduite
de la géométrie de la grille, pas d'une source StarLoco : ce sont les quatre
directions axiales, celles qui déplacent d'un losange plein à l'écran. Elle a
peu de témoins et doit être confirmée en jeu.

## Vérification

`bun test src/core/modules/npcs/npc-wander.path.spec.ts` — lecture des routes
réelles du dump, arrêt sur case non marchable, miroir des directions.

En jeu, map 7412, *Mon'Hawt'Wit'* (`path = "B2"`) : il descend de deux cases,
remonte, recommence. C'est ce test qui valide la table des directions — s'il
part à l'horizontale, elle est à corriger.
