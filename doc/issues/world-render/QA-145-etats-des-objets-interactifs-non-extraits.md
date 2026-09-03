---
id: QA-145
title: L'arbre coupé reste figé à mi-chute et ne laisse aucune souche
severity: P1
domain: world-render
type: bug
status: fixed
session: 7
opened: 2026-09-02
closed:
fixed_in:
related: [QA-143, QA-144]
files:
  - tools/assets-exporter/src/Swf/InteractiveStateResolver.php
  - tools/assets-exporter/src/Command/ExtractTileCommand.php
  - tools/asset-pipeline/src/stages/extract/tiles.ts
  - tools/asset-pipeline/src/stages/compile/tiles.ts
  - packages/dofasset-format/src/binary-reader.ts
  - apps/electrobun/src/game/scene/battlefield/picking.ts
---

## Symptôme

En coupant un Frêne avec le compte `dev` :

- pendant l'action, l'arbre est déjà penché, souche apparente, et figé là ;
- une fois l'action terminée, il change de frame mais ne laisse pas de souche —
  on obtient un arbre entier entouré de feuilles qui volent.

L'animation du personnage, elle, est correcte.

## Attendu (1.29)

Un élément interactif est une machine à états : sa timeline racine porte un
état par frame, chacune avec un `stop()`, et le serveur seul l'avance
(`GDF;<cellule>;<frame>` → `gotoAndStop(frame)`). Pour un arbre :

| frame | état |
| --- | --- |
| 1 | l'arbre sur pied, immobile |
| 2 | idem, réservé le temps de la coupe |
| 3 | la chute joue une fois et rend la main à la frame 4 |
| 4 | la souche, immobile |
| 5 | la repousse joue une fois et rend la main à la frame 1 |

## Cause

L'extraction n'a pas d'AVM : `ExtractTileCommand` parcourait la timeline
racine frame par frame en passant le *même* tick aux clips imbriqués. Les 26
frames publiées pour le gfx 7500 ne correspondaient donc à aucun état — la
frame 1 était un arbre à mi-chute, et la souche, qui n'existe qu'au bout du
clip de chute, n'était dans aucune frame publiée. `applyCellFrame` compensait
avec une arithmétique de frames (`frame + 1`) qui ne pouvait pas retomber sur
une image absente.

## Correctif

- `InteractiveStateResolver` lit la machine à états dans les tags bruts du
  sprite : une frame qui place son clip sous un `onClipEvent` est une image
  fixe (`stop()`, ou `gotoAndStop(n)` — c'est ainsi que la souche est
  conservée), une frame qui le place nu est une transition qui joue.
- L'extraction exporte les états bout à bout et publie leurs bornes dans
  `states` (manifeste → Extras du `.dofasset`), et le comportement de la tuile
  devient `resource` dès qu'elle en a.
- Le client tient l'image fixe, ou joue la transition une fois et s'arrête sur
  sa dernière frame. Un état découvert à l'arrivée sur la carte est pris au
  repos : on ne rejoue pas la chute d'un arbre abattu avant nous.
- 56 tuiles de récolte republiées (`pipeline run|compile|publish tiles.objects
  --ids …`).

## Vérification

- `bun test src/game/scene/battlefield/picking.spec.ts` — la frame 3 joue la
  chute et s'arrête sur la souche, la frame 2 laisse l'arbre debout, une
  ressource déjà épuisée est enregistrée directement sur la souche.
- `bun test src/game/assets/resource-tile-variants.spec.ts` — les 56 tuiles
  gardent un rendu distinct après réextraction.
- En jeu, `dev/dev` : couper un Frêne. L'arbre reste debout pendant la coupe,
  tombe à l'échéance et laisse sa souche jusqu'à la réapparition.
