---
id: QA-074
title: Les pièges ne se déclenchent que sur leur case centrale
severity: P2
domain: fight
type: bug
status: in-progress
session: 2
opened: 2026-08-23
closed:
fixed_in:
related: [QA-061]
files:
  - apps/gameserver-ts/src/core/modules/fight/map/fight.map.ts
  - apps/gameserver-ts/src/core/modules/fight/map/fight.object.ts:35
---

## Symptôme

Le même défaut de zone que QA-061, par un autre chemin : un monstre traverse la
zone dessinée d'un piège sans rien déclencher.

## Cause

`FightMap.fireArrivalTriggers` sélectionnait les objets avec
`ObjectRegistry.atCell(cell)`, une égalité stricte sur la case de l'objet. La
taille de zone du piège, correctement transmise à l'affichage, n'était consultée
nulle part.

Le type `FightObject` déclarait pourtant déjà `cellEligible?: (cell) => boolean`
— un champ que **rien ne lisait** dans tout le dépôt.

## Correctif

Les objets déclarent les cases qu'ils couvrent via `cellEligible`, calculées à la
pose avec `cellsInArea`. L'égalité de case reste le repli pour un objet qui ne
déclare pas de zone.

## Vérification

Voir le runbook du sprint 01, étape « Glyphes », dernier paragraphe sur les
pièges. Couvert par `trap-glyph.handler.spec.ts`.
