---
id: QA-050
title: 194 objets interactifs chargés sur la map, aucun n'est cliquable
severity: P1
domain: world-render
type: gap
status: fixed
session: 1
opened: 2026-08-20
closed:
fixed_in:
related: [QA-049, QA-085]
files:
  - apps/electrobun/src/game/scene/battlefield-scene.ts
  - apps/electrobun/src/game/scene/battlefield/picking.ts
---

## Symptôme

Relevé en session sur la map courante :

- `battlefield.interactiveObjectsData.size` → **194**
- `pickingSystem.getPickableObjects().length` → **1** (le personnage seul)

## Cause

Les portes, zaaps, ressources et éléments de décor interactifs sont décodés et
stockés, mais jamais enregistrés auprès du système de picking.

## Portée

Rien dans le monde n'est actionnable.

## Correctif

`battlefield-scene.ts` enregistre au picking les sprites de layer 2 dont la
cellule porte le bit `layerObject2Interactive` — la liste blanche de gfx ne
suffisait pas, un arbre décoratif et un arbre récoltable partagent le même gfx
et seul le bit les sépare (voir QA-085 pour la remontée du bit depuis le
serveur). `registerTile` conserve le `cellId`, sans quoi le clic n'a rien à
nommer au serveur, et `onObjectClick` ouvre le menu 1.29 construit depuis la
table `IO`.

## Vérification

Sur une carte d'Astrub, `pickingSystem.getPickableObjects().length` compte les
éléments interactifs de la carte et non plus le seul personnage. Cliquer la
porte d'une maison ouvre le menu « Porte » ; survoler un arbre décoratif ne
change pas le curseur et le clic fait marcher le personnage.
