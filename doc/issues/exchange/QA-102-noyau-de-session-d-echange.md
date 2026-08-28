---
id: QA-102
title: Aucun noyau de session d'échange — ni état, ni verrou d'occupation, ni survie au redémarrage
severity: P1
domain: exchange
type: feature
status: fixed
session: 5
opened: 2026-08-28
closed:
fixed_in:
related: [QA-086, QA-101, QA-112, QA-113]
files:
  - apps/gameserver-ts/src/core/modules/exchange/
  - apps/gameserver-ts/src/core/shared/gateway-adapter/ws-router.ts
  - apps/gameserver-ts/src/core/shared/handoff/handoff.coordinator.ts
---

## Symptôme

Rien ne tient l'état d'un échange en cours. `SessionRegistry.Session` ne porte
que `sessionId, accountId, characterId, remoteAddr, openedAt` ; il n'existe
aucune notion d'occupation exclusive. Les trois états d'interaction existants
sont trois `Map` ad hoc, indépendantes et sans contrat commun :
`FightRegistryService.bySession`, `NpcDialogSessionService.bySession`,
`PendingMovesService.bySession`.

`FightRegistryService.isInFight` n'est consulté que par quatre appelants
(`fight-challenge`, `fight-join`, `npc-dialog`, `fight-start`). `item-move`,
`item-use`, `interactive-use` et `waypoint-use` ne le consultent pas.

`players.restrictions` (`schema.ts:121`) et le bit `CANNOT_EXCHANGE = 4`
(`proto/common.proto:161`) existent tous les deux et ne sont lus nulle part.

Deux aggravants relevés dans le chemin d'entrée :

- `GatewayFrameService.onFrame` appelle `WsRouter.dispatch` **sans `await`**.
  Deux trames du même client ne sont donc pas sérialisées : leurs `await`
  s'entrelacent.
- Rien ne limite ni ne dédoublonne le débit entrant (QA-064, QA-045), donc un
  double-clic produit vraiment deux mouvements concurrents.

## Attendu (1.29)

Le client refuse une seconde ouverture avec `EREO` (`ALREADY_EXCHANGE`,
`dofus/aks/Exchange.as:245-267`). L'occupation est donc une notion du
protocole, pas seulement une précaution serveur.

## Correctif

Module `src/core/modules/exchange/` :

- `ExchangeRegistryService` — `Map<sessionId, ExchangeSession>`, **décoré
  `@HandoffPart()` et `implements Serializable`** (`name = "exchange.sessions"`).
  C'est la différence délibérée avec `FightRegistryService` et
  `NpcDialogSessionService`, qui ne le sont pas : un redémarrage du core perd
  aujourd'hui combats et dialogues en silence (QA-113). L'état d'une session
  d'échange est du JSON pur, le coût est nul. À défaut de restauration propre,
  fermer la fenêtre par un `EV` dans `onResume`.
- `exchange.lock.ts` — `claim(sessionId, kind)` refuse si `isInFight` ou si une
  session est déjà ouverte. Point d'entrée unique vers lequel le combat et le
  dialogue migreront (QA-112).
- `exchange.serializer.ts` — une **chaîne de promesses par session** :
  `runExclusive(sessionId, fn)`. C'est la ceinture, puisque `dispatch` n'est pas
  `await`é ; les `UPDATE` conditionnels de QA-101 sont les bretelles.
- `ExchangeFlow` — une interface par type d'échange (`open`, `moveItem`,
  `moveKamas`, `setReady?`, `close`). `setReady` absent vaut politique de commit
  immédiate, ce que le client impose pour le type 5. Chaque type futur est un
  `ExchangeFlow` de plus, pas un sous-système de plus.

## Vérification

Test unitaire : deux `ExchangeMoveItem` lancés sans `await` sur la même session
produisent un seul mouvement. Test manuel : double-cliquer vite sur le même
objet ne le dépose qu'une fois.
