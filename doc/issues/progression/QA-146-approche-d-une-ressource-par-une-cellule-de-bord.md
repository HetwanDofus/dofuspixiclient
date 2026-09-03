---
id: QA-146
title: L'approche d'une ressource peut se faire par une cellule qui change de carte
severity: P1
domain: progression
type: bug
status: fixed
session: 7
opened: 2026-09-02
closed:
fixed_in:
related: [QA-143]
files:
  - packages/grid/src/edge.ts
  - packages/grid/src/pathfinding.ts
---

## Symptôme

Avec le compte `dev`, cliquer « Couper » sur l'arbre en bas à droite de la
carte fait descendre le personnage sur la carte 7357 : la marche se termine sur
une cellule de bord, le serveur téléporte, et la récolte est abandonnée en
silence.

## Attendu

La cellule d'approche d'une ressource ne doit jamais être une cellule qui
déclenche une transition de carte. Si le personnage se tient déjà sur une telle
cellule, l'action part de là : aucun déplacement n'a lieu, donc aucune
transition non plus.

## Cause

`findAdjacentPath` retenait le plus court chemin vers **n'importe quelle**
voisine praticable de la ressource. Pour un élément posé près du bord, la plus
proche est une cellule de bord, et `MoveAckHandler.maybeCrossEdge` lit toute
cellule des deux rangées ou colonnes extérieures comme une sortie
(`detectExitDirection`, `maps.edge.ts`).

## Correctif

`isMapChangeCell` (packages/grid/src/edge.ts) reprend exactement le test du
serveur, et `findAdjacentPath` écarte ces voisines — sauf la cellule de départ,
qui ne coûte aucun pas.

## Vérification

- `bun test src/pathfinding.spec.ts` dans `packages/grid` — le chemin vers une
  ressource dont les voisines les plus proches sont des cellules de bord se
  termine ailleurs, et un personnage déjà posé sur une cellule de bord ne bouge
  pas.
- En jeu, `dev/dev` : couper l'arbre en bas à droite de la carte ne change plus
  de carte.
