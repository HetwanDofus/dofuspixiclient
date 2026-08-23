---
id: QA-069
title: Une session qui se ferme en plein combat laisse un combattant fantôme
severity: P1
domain: fight
type: bug
status: confirmed
session: 2
opened: 2026-08-23
closed:
fixed_in:
related: [QA-057, QA-066]
files:
  - apps/gameserver-ts/src/core/modules/fight/registry/
  - apps/gameserver-ts/src/core/features/game/fight-leave/
---

## Symptôme

Un combat indexe ses combattants par **session réseau**. `FightLeaveHandler` ne
répond qu'à une demande explicite de quitter, et **rien n'écoute la fermeture
de session côté combat**.

Une coupure réseau, une fermeture d'onglet ou une éjection de compte en plein
combat laissent donc un combattant qui ne jouera plus jamais son tour. Le timer
de tour existe et fera passer le tour, mais le combattant reste dans le combat
et rien ne le déclare vaincu : le combat ne peut pas se terminer normalement.

## Origine

Ce défaut est **antérieur** au correctif d'éjection de compte (QA-057), dont la
note de clôture le signalait déjà comme hors périmètre. Il est consigné ici pour
être suivi comme tel plutôt que de rester enterré dans une note.

Les points d'accroche laissés en place à cette occasion, **à ne pas défaire** :

- `SessionLeaveSaga.onSessionClosed({ session, reason })` reçoit déjà le motif —
  c'est là que se branche le délai de grâce ;
- `FightRegistryService.registerSession()` / `unregisterSession()` et
  `Fighter.sessionId`, mutable, permettent de rebrancher un combattant sur une
  nouvelle session ;
- la reprise devra s'accrocher à la **sélection de personnage**, pas au ticket :
  au moment du ticket on ne connaît que le compte.

## Correctif — le périmètre du sprint s'arrête au fantôme

Écouter `session.closed` côté combat et appliquer la règle 1.29 : le combattant
passe en mode automatique après un court délai de grâce, et le combat continue
sans lui.

La **reprise** de combat après reconnexion est un chantier distinct, à ne pas
embarquer ici : elle suppose que le combat survive au redémarrage du core
(QA-066) et que le client sache reprendre un combat en cours.

## Vérification

Voir le runbook du sprint 01, étape « Déconnexion en combat ».
