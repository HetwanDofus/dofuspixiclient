---
id: QA-096
title: Les couleurs des monstres sont lues en décimal alors que le dump les écrit en hexadécimal
severity: P1
domain: world-content
type: data
status: fixed
session: 3
opened: 2026-08-28
closed:
fixed_in:
related: [QA-034, QA-094]
files:
  - apps/gameserver-ts/scripts/import-starloco-content.ts
---

## Symptôme

Dans le champ de pious d'Astrub (7365), **cinq des six variétés s'affichent en
bleu** alors que le panneau de survol les nomme correctement « Piou Jaune »,
« Piou Rouge », « Piou Rose »… Le sprite ne correspond presque jamais au nom.

En base : `select count(*) from monster_templates where color1 <> -1 or color2
<> -1 or color3 <> -1` renvoyait **8** sur 1 388.

## Attendu (1.29)

Les six pious sont **le même dessin**. Les `.dofasset` 1212 et 9202..9206 ne
diffèrent que d'un octet — l'id dans l'en-tête (`cmp -l 9202.dofasset
9205.dofasset` → 1 octet). La variante est donc portée entièrement par le
triplet `color1/2/3`, que le client applique par zone : `-1` laisse la zone à la
palette du dessin (`GlobalSpriteHandler.applyColor`).

## Cause

`monsters.colors` du dump StarLoco est un triplet **hexadécimal** —
`'448051,f9f9a5,-1'` pour Piou Vert — exactement l'encodage que le paquet GM
canonique transporte et que le client relit avec `Number("0x" + v)`
(`CharactersManager.as:281-283`).

L'importeur le lisait avec `num()`, un `Number()` décimal
(`import-starloco-content.ts:366`) : `Number("f9f9a5")` vaut `NaN` et retombait
sur `-1`, tandis qu'un triplet tout en chiffres était conservé tel quel —
`448051` au lieu de `0x448051` = 4 489 297.

**61 monstres portent une vraie couleur dans le dump et les 61 étaient
détruits** : 59 aplatis à `-1`, le reste relu comme du décimal.

`num()` reste correct pour les PNJ : `npc_template.color1/2/3` sont réellement
des entiers décimaux dans le même dump. L'encodage hexa est propre à
`monsters.colors`.

## Correctif

Un `hexColor()` dédié, en base 16, préservant `-1`, appliqué au seul
`monsters.colors`. Puis `just import-content game.sql`.

Aucun changement côté client : `buildColorsArg`
(`character-sprite.ts:502-517`) convertit `-1` en `0`, et `0` est déjà le
sentinelle « zone intacte » côté Rust
(`vello-dofasset-format/packages/renderer/src/color.rs:93-94`,
`if player_color == 0 { continue; }`) — c'est-à-dire le comportement canonique.

## Vérification

```sql
select count(*) from monster_templates where color1<>-1 or color2<>-1 or color3<>-1;
-- 8 avant, 61 après
select id, name, color1 from monster_templates where id = 490;
-- Piou Vert | 4489297   (0x448051), et non 448051
```
