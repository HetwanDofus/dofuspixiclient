---
id: QA-067
title: Le cache de maps ne libère jamais rien
severity: P2
domain: server-runtime
type: bug
status: confirmed
session: 2
opened: 2026-08-23
closed:
fixed_in:
related: [QA-064]
files:
  - apps/gameserver-ts/src/core/modules/maps/maps.cache.service.ts:19
---

## Symptôme

`MapCacheService` détient un `Map<number, CachedMap>` dans lequel on écrit à
chaque chargement et dont **on ne retire jamais rien**. Aucune éviction, aucun
plafond, aucune durée de vie.

## Portée

Le monde compte 9 358 maps, chacune avec ses cellules décodées. Un serveur en
production finit donc par toutes les détenir en mémoire, et la consommation ne
redescend jamais. Ce n'est pas une fuite au sens strict — les entrées sont
utiles — mais c'est une croissance non bornée sur un processus unique et
partagé.

Sans limitation de débit (QA-064), c'est aussi un levier : demander les données
de maps au hasard fait monter la mémoire du core à volonté.

## Correctif

Un plafond de taille avec éviction du moins récemment utilisé. Ne pas évincer
une map qui porte encore des joueurs ou un combat.

## Vérification

Voir le runbook du sprint 01, étape « Limitation de débit ».
