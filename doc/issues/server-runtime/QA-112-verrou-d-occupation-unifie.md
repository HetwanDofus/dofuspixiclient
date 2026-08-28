---
id: QA-112
title: Trois états d'interaction exclusifs, trois Map indépendantes, aucun contrat commun
severity: P2
domain: server-runtime
type: gap
status: open
session: 5
opened: 2026-08-28
closed:
fixed_in:
related: [QA-102, QA-113]
files:
  - apps/gameserver-ts/src/core/modules/fight/registry/fight.registry.ts
  - apps/gameserver-ts/src/core/modules/npcs/npc-dialog.session.ts
  - apps/gameserver-ts/src/core/modules/exchange/exchange.lock.ts
---

## Symptôme

« Le joueur est occupé » n'existe nulle part comme notion. Il existe trois
`Map<sessionId, …>` sans rapport entre elles : `FightRegistryService.bySession`,
`NpcDialogSessionService.bySession`, et — depuis QA-102 —
`ExchangeRegistryService`.

`FightRegistryService.isInFight` n'est consulté que par `fight-challenge`,
`fight-join`, `npc-dialog` et `fight-start`. `item-move`, `item-use`,
`interactive-use` et `waypoint-use` ne le consultent pas : on peut équiper un
objet ou emprunter un zaap en plein combat.

`NpcDialogSessionService.open()` ferme silencieusement le dialogue précédent au
lieu de refuser le second — il n'existe aucun chemin de rejet.

`players.restrictions` (`schema.ts:121`) et `RestrictionFlag`
(`proto/common.proto:154`) ne sont lus par aucun code.

## Attendu (1.29)

Le client attend des refus explicites : `EREO` `ALREADY_EXCHANGE` quand une
autre interaction est en cours (`Exchange.as:245`). Le serveur doit savoir dire
non, pas remplacer en silence.

## Correctif

`exchange.lock.ts` (QA-102) est écrit comme point d'entrée unique. Faire migrer
le combat et le dialogue derrière la même interface, et brancher enfin la
lecture de `players.restrictions`.

## Reste à faire

Non engagé. À faire après QA-086, quand le verrou aura fait ses preuves sur un
flux.
