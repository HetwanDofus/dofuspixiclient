---
id: QA-088
title: Les acteurs ignorent le recentrage de la carte — décalés hors du décor sur toute carte non 15x17
severity: P1
domain: world-render
type: bug
status: fixed
session: 2
opened: 2026-08-26
closed:
fixed_in:
related: [QA-084, QA-085]
files:
  - apps/electrobun/src/game/scene/battlefield/world-actors.ts
  - apps/electrobun/src/game/scene/battlefield-scene.ts
  - apps/electrobun/src/game/scene/player/renderer.ts
  - apps/electrobun/src/game/scene/player/movement.ts
  - apps/electrobun/src/game/datacenter/map.ts
---

## Symptôme

En entrant dans une maison d'Astrub (porte 7411:170 → intérieur 7668), le
personnage est peint **sur le mur du fond, à gauche**, hors du plancher. Au clic
il se déplace « à des endroits où il n'a normalement pas accès » : chaque pas est
dessiné ailleurs que là où il est joué.

La pièce, elle, est rendue intégralement — plancher, murs, mobilier. Le décor est
juste, c'est l'acteur qui est ailleurs.

Entrer dans la banque (7411:202 → 10111) ne montre rien d'anormal.

## Cause

`computeMapScale` (`datacenter/map.ts:40`) recentre toute carte qui n'est pas
15x17, et les couches de tuiles intègrent le résultat dans **chaque** position de
sprite (`layer-builder.ts:145`, `286`). Le picking fait de même
(`findCellAtPosition`, `cell.ts:47`).

`PlayerRenderer` place ses acteurs à partir de la position de cellule brute
(`renderer.ts:770`) et n'applique rien. Il expose bien `setOffset` / `setScale` /
`setMapDimensions` — mais les trois ne sont appelés que depuis
`hud/fight/fight-ui.ts`, sur l'instance **séparée** du mode combat. En mode
monde, le renderer d'acteurs ne reçoit jamais la transformation.

Pour une maison 11x13 l'offset vaut **(106, 54)** : le décor part de 106 px vers
la droite et 54 px vers le bas, l'acteur reste en arrière — en haut à gauche, sur
le mur. Exactement ce qu'on observe.

Le défaut est invisible sur 15x17, qui renvoie `{scale: 1, offsetX: 0,
offsetY: 0}`. C'est le cas de la rue d'Astrub *et* de la banque, d'où
l'impression que seules les maisons sont touchées. En réalité **1 980 des 9 358
cartes** ne sont pas 15x17, dont 322 en 19x22 où s'ajoute un `scale` de 0,78.

Second défaut, corrigé par le même appel : `BattlefieldWorldActors.reset()`
reconstruit le renderer avec `currentMapWidth()`, or `map.handler.ts` l'appelle
**avant** `loadMapFromData()`, seul endroit où `currentMapData` est affecté. Le
renderer naissait donc aussi avec la largeur de la carte précédente.

Le pathfinding, lui, est reconstruit avant : le déplacement joué est correct,
seul son rendu est faux.

## Correctif

`projectCellPosition` (`datacenter/map.ts`) applique le `pos * scale + offset`
des tuiles, et `PlayerRenderer` le fait passer par ses deux entonnoirs de
position : le placement (`addPlayer`) et `PlayerMovement.cellPos`, qui sert au
téléport et à chaque franchissement de cellule. Le pas intra-segment est mis à
la même échelle, sa géométrie étant calculée sur des positions brutes.
`BattlefieldWorldActors.applyMapTransform()` pousse largeur et projection,
depuis `loadMapFromData` une fois `currentMapData` affecté.

**Ne pas passer par `setOffset` / `setScale`** : ces deux-là transforment le
conteneur du renderer, et en mode monde ce conteneur *est* le conteneur de
tuiles de layer 2 partagé (`this.container = objectLayer2 ?? new Container()`,
`world-actors.ts:init`). Les décaler emmène tout le mobilier avec eux — essayé,
tous les meubles de la pièce sont partis en diagonale. Le mode combat, lui, a son
propre conteneur et garde légitimement ce mécanisme.

## Vérification

Entrer dans la maison à gauche de la banque d'Astrub : le personnage se tient sur
la tuile de la cellule 203 et chaque déplacement est dessiné là où il est joué.
Refaire l'aller-retour banque (15x17 → 15x17) pour vérifier l'absence de
régression, puis une carte 19x22 pour le cas `scale != 1`.

Les cases sans tuile ne sont pas une anomalie : 7668 en compte 26 sur 45
marchables, mais 7411 — qui s'affiche correctement — en compte 304 sur 372. Et
aucune cellule de 7668 n'est en `movement = 1`, donc QA-087 n'y est pour rien.
