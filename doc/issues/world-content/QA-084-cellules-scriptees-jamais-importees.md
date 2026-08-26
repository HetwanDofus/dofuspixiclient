---
id: QA-084
title: Aucune cellule scriptée n'est importée — banque, boutiques et donjons inaccessibles
severity: P1
domain: world-content
type: data
status: fixed
session: 2
opened: 2026-08-25
closed:
fixed_in:
related: [QA-085]
files:
  - apps/gameserver-ts/scripts/import-starloco-triggers.ts
  - apps/gameserver-ts/src/core/modules/scripted-cells/scripted-cells.service.ts
  - apps/gameserver-ts/src/core/features/game/move-ack/move-ack.handler.ts
---

## Symptôme

Marcher sur la porte de la banque d'Astrub ne fait rien. Idem pour toutes les
boutiques, les temples, les étages de maison et les entrées de donjon.

Relevé en base avant correctif :

| | |
|---|---|
| `scripted_cells` dans `apps/gameserver-ts/game.sql` | **23 795** |
| `scripted_cells` en base | **16** |

Les 16 lignes sont le seed en dur de la migration 0032 (cartes 4 à 9,
Incarnam). Aucun script n'en importait davantage : `insertRows(dump,
"scripted_cells")` n'existait nulle part.

## Attendu (1.29)

Une porte de bâtiment public n'est pas un objet cliquable : c'est une cellule
marchable qui porte un téléport côté serveur. Le dump relie la banque d'Astrub
par une ligne unique :

```
INSERT INTO `scripted_cells` VALUES (7411, 202, 0, 1, '10111,181', '-1');
```

## Cause

`ScriptedCellsService.onPlayerArrived` était écrit et branché
(`move-ack.handler.ts:77-86`, où il court-circuite `maybeCrossEdge`), mais sans
données. La cellule 7411:202 a `movement = 4`, donc le joueur s'y rendait bien ;
`move-ack` interrogeait `scripted_cells`, ne trouvait rien, retombait sur la
traversée de bordure — qui ne voit pas une cellule intérieure — et rien ne se
passait.

## Correctif

Nouveau `scripts/import-starloco-triggers.ts` + recette `just import-triggers`,
chaînée dans `import-world` après `import-maps`. Le dump n'a pas de colonne
`verb` mais un `ActionID` : 0 (23 689 lignes), 979 (100) et 1 (1) portent tous
des arguments `mapId,cellId` et deviennent `TP` ; 101 et 971 (4 lignes) sont
ignorées et comptées.

Décision assumée : **tout est importé**, lignes de bordure comprises. Les
`scripted_cells` rétail deviennent donc prioritaires sur l'élection géométrique
de `map_neighbors`, ce qui est plus fidèle au 1.29 et corrige au passage les
mauvaises élections décrites dans `doc/data-seeding.md`. `map_neighbors` reste
le repli pour la grande majorité des bordures, que le dump ne mentionne pas.

Le même script remplit trois jeux de données restés vides pour la même raison :
`interactive_objects_templates` (197), `waypoints` (33 zaaps + 75 zaapis,
trouvés en scannant les payloads `maps.cells`) et la géométrie des maisons —
voir QA-085.

## Vérification

```bash
just import-triggers game.sql
# scripted cells: 23 726 importées
docker exec dofuspixiclient-postgres-1 psql -U dofus -d dofus \
  -c "select * from scripted_cells where map_id=7411 and cell_id=202"
# → TP, '10111,181'
```

En jeu : se placer sur la carte 7411 (Astrub, [4,-19]) et marcher sur la
cellule 202 → la carte devient 10111, la banque.
