---
id: QA-071
title: Un glyphe se déclenche au début du tour de chaque combattant
severity: P2
domain: fight
type: bug
status: in-progress
session: 2
opened: 2026-08-23
closed:
fixed_in:
related: [QA-061, QA-062]
files:
  - apps/gameserver-ts/src/core/modules/fight/map/fight.map.ts:44-52
  - apps/gameserver-ts/src/core/modules/fight/effects/handlers/trap-glyph.handler.ts
---

## Symptôme

Trouvé en lisant le moteur pour QA-061. Un glyphe inflige ses dégâts bien plus
souvent qu'il ne devrait.

## Attendu (1.29)

Un glyphe frappe le combattant **dont le tour commence**, s'il se trouve dans la
zone, une fois par round.

## Cause

`FightMap.fireTurnStartTriggers(fight, owner)` est appelé au début du tour de
**chaque** combattant, ce qui est correct — mais le handler ignorait son
paramètre `owner` et balayait tout le roster. Un glyphe frappait donc chaque
ennemi posé dessus une fois par tour de chaque combattant, soit N fois par round
dans un combat à N participants.

Ce défaut compensait partiellement QA-061 : la zone était ignorée, mais la
fréquence était multipliée. Corriger l'un sans l'autre aurait donné un glyphe
franchement trop fort.

## Correctif

Ne tester que `owner` : sa case dans la zone, son camp opposé à celui du
lanceur, et vivant.

## Vérification

Voir le runbook du sprint 01, étape « Glyphes ». Couvert aussi par
`trap-glyph.handler.spec.ts` : « it fires for the fighter whose turn begins ».
