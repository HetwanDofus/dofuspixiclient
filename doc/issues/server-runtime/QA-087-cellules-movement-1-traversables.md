---
id: QA-087
title: Les cellules `movement = 1` sont traversables au lieu d'être des cases d'arrivée
severity: P2
domain: server-runtime
type: bug
status: open
session: 2
opened: 2026-08-25
closed:
fixed_in:
related: [QA-085]
files:
  - apps/gameserver-ts/src/core/modules/maps/maps.cells-codec.ts:137
  - apps/gameserver-ts/src/core/modules/maps/maps.validate-path.ts
---

## Symptôme

Le personnage traverse une porte, un zaap ou une ressource au lieu de s'y
arrêter : ces cellules acceptent d'être un pas intermédiaire d'un trajet.

## Attendu (1.29)

`Pathfinding.as:154-157` n'ouvre une cellule `movement == 1` que si elle est la
**case d'arrivée** du trajet :

```as
_loc30_ = (_loc32_ == nCellEnd && _loc33_.movement == 1);
if (!(!_loc35_ || (!_loc33_.active || _loc33_.movement == 1 && !_loc30_)))
```

`Cell.isTargetable` dit la même chose : `movement != 0 && movement != 1 && active`.
C'est exactement ce qui fait qu'on « monte sur » une porte plutôt que de passer
au travers.

## Cause

`maps.cells-codec.ts:137` dérive `walkable = movement !== 0`, ce qui range les
cellules `movement = 1` avec les cellules libres. Le drapeau part tel quel dans
`MapCell`, donc le pathfinding client et `validatePath` côté serveur héritent
tous deux de l'erreur. À noter que `resolveLandingCell` exige `active &&
walkable` alors que `validatePath` ne regarde que `walkable` : les deux côtés
ne sont déjà pas tout à fait d'accord.

## Correctif

Non engagé — repéré en travaillant sur QA-085, qui n'en dépend pas : le trajet
vers un élément se termine dessus, donc le cas « case d'arrivée » fonctionne
déjà. Un correctif touche le pathfinding des deux côtés et mérite son propre
passage.
