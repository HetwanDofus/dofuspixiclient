---
id: QA-034
title: Aucun monstre ne se pose sur aucune map
severity: P0
domain: world-content
type: data
status: fixed
session: 1
opened: 2026-08-20
closed:
fixed_in:
related: [QA-035, QA-058]
files: [apps/gameserver-ts/scripts/import-starloco-content.ts]
---

## Symptôme

Cinq maps traversées (7365 → 7448 → 7464 → 7612 → 8600 → 8599), zéro groupe. Le
serveur logge à chaque entrée
`[MapMonsterService] spawned 0 monster groups`.

## Cause

La table `monster_templates` est **vide** (0 ligne). Les maps, elles, ont bien
leur configuration — `maps.numgroup = 3`, `mob_size_min/max = 3/8`,
`monsters_raw = '|52,1|101,3|134,1|98,3|149,1'` sur 7448 par exemple.

`MapMonsterService.ensureSpawned` parse donc un pool valide, puis `buildMembers`
ne résout aucun template et retourne une liste vide, si bien qu'aucun groupe
n'est enregistré.

C'est **la première des trois causes racines** de la session : les données de
contenu ne sont pas importées.

## Correctif

`just import-content <game.sql>` (`scripts/import-starloco-content.ts`, sur le
modèle de `import-maps`) peuple `monster_templates` (1 388), `monster_levels`
(6 004) et `monster_drops` (4 562).

Les 114 367 entrées de pool des 4 717 maps concernées résolvent toutes un
template, 113 907 résolvent aussi un niveau.

## Vérification

Vérifié en session : `[MapMonsterService] spawned 3 monster groups on map=7448`,
puis `sending GM: self=1 cell=289 … + 3 monster groups`, les groupes arrivant au
client avec noms, niveaux et gfx (`Bouftou(lvl3,gfx1566)`, `Arakne(lvl1,…)`).

**Reste à jouer un combat réel pour clore** — voir QA-058.
