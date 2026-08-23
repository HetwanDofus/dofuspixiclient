---
id: QA-073
title: La durée d'un glyphe est décomptée par tour et non par round
severity: P3
domain: fight
type: bug
status: in-progress
session: 2
opened: 2026-08-23
closed:
fixed_in:
related: [QA-072]
files:
  - apps/gameserver-ts/src/core/modules/fight/engine/fight.runner.ts
---

## Symptôme

Un glyphe disparaît beaucoup plus tôt que sa durée annoncée.

## Attendu (1.29)

La durée d'un objet posé se compte en **rounds**, comme celle d'un buff.

## Cause

`objects.tickDown()` était appelé à chaque `endTurn()`, donc une fois par
combattant et non une fois par round. Dans un combat à quatre, une durée de 3
était consommée en moins d'un round complet.

## Correctif

Décompter au changement de round. `turnList.advance()` le signalait déjà par son
drapeau `rounded`, qui n'était pas lu.

## Vérification

Poser un glyphe de durée 3 dans un combat à au moins trois combattants et
compter les rounds jusqu'à sa disparition.
