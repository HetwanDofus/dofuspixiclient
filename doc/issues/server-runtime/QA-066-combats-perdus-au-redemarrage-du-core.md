---
id: QA-066
title: Combats et groupes de monstres sont perdus à chaque redémarrage du core
severity: P1
domain: server-runtime
type: gap
status: confirmed
session: 2
opened: 2026-08-23
closed:
fixed_in:
related: [QA-069, QA-046, QA-048]
files:
  - apps/gameserver-ts/src/core/modules/fight/registry/
  - apps/gameserver-ts/src/core/modules/monsters/map-monster.service.ts
  - apps/gameserver-ts/src/core/shared/handoff/
---

## Symptôme

Le mécanisme de transfert bleu/vert ne connaît que **quatre** morceaux d'état :

```
sessions · scheduler.jobs · player-presence.players · player-presence.pending-moves
```

Ni le registre des combats, ni les groupes de monstres posés sur les maps ne
sont déclarés. Un redémarrage du core — y compris un simple rechargement en
mode watch pendant le développement — détruit donc **tous les combats en
cours**, et repose les groupes de monstres à neuf.

## Portée

Deux effets très différents :

- **En production**, c'est une perte de progression joueur au moindre
  déploiement, alors que le découpage gateway / core existe précisément pour
  déployer sans coupure. La promesse d'architecture n'est pas tenue pour le
  système le plus long du jeu.
- **En développement**, c'est un frein quotidien : `just gamed` tourne en mode
  watch, donc toute modification de fichier pendant un test de combat annule le
  combat. Cela rend le combat pénible à mettre au point, ce qui est
  précisément ce qu'on cherche à faire en ce moment.

## Correctif

Déclarer les deux services comme morceaux de transfert, sur le modèle de
`PlayerPresenceService` (`readonly name`, `serialize()`, `restore()`).

Le combat est le cas difficile : un `Fight` porte des fonctions de rappel
(`onTurnStart`, `onArrival` des pièges et glyphes) qui ne se sérialisent pas.
Il faut sérialiser l'**état** — combattants, PV, PA/PM, buffs, objets posés,
tour courant — et reconstruire les rappels au chargement depuis les
identifiants de sorts. À traiter comme un vrai chantier, pas comme un ajout de
décorateur.

## Vérification

Voir le runbook du sprint 01, étape « Survie au redémarrage ».
