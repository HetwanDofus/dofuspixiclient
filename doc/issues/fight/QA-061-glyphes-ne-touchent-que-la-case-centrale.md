---
id: QA-061
title: Les glyphes ne touchent que leur case centrale, la zone est ignorée
severity: P1
domain: fight
type: bug
status: in-progress
session: 2
opened: 2026-08-23
closed:
fixed_in:
related: [QA-062]
files:
  - apps/gameserver-ts/src/core/modules/fight/effects/handlers/trap-glyph.handler.ts:110-131
---

## Symptôme

Les glyphes d'un Féca ne déclenchent presque jamais. Constaté manette en main.

## Cause

Dans `handleGlyph`, le test de déclenchement est une **égalité stricte sur la
case centrale** :

```ts
f.cell !== scope.targetCell   // → on ignore ce combattant
```

Or un glyphe a une taille de zone (`scope.effect.areaSize`), correctement
transmise à l'affichage quelques lignes plus bas dans `emitGlyphAdd` — le
client dessine donc le bon disque, mais le serveur ne teste que le centre.

Un ennemi posé sur la couronne du glyphe voit la zone sous ses pieds et ne subit
rien. Sur les glyphes Féca, qui sont des zones de rayon 2 en 1.29, la case
centrale est justement celle qu'on occupe le moins souvent.

## Correctif

Remplacer le test par une appartenance à la zone, en réutilisant le calcul
d'aire canonique de `packages/grid` — le même que celui qui sert à
`emitGlyphAdd`, pour que l'affichage et l'effet ne puissent pas diverger.

**Attention à l'adjacence** : sur cette grille les cases voisines sont à
`±largeur` et `±(largeur−1)`, pas `±1`. Ne pas recalculer l'aire à la main.

## Vérification

Voir le runbook du sprint 01, étape « Glyphes ».
