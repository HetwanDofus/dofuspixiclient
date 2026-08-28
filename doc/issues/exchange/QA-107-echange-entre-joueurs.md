---
id: QA-107
title: Aucun échange entre joueurs
severity: P1
domain: exchange
type: feature
status: fixed
session: 5
opened: 2026-08-28
closed:
fixed_in:
related: [QA-086, QA-101, QA-102, QA-115, QA-120, QA-121, QA-122]
files:
  - proto/exchange.proto
  - apps/gameserver-ts/src/core/modules/exchange/trade.flow.ts
  - apps/gameserver-ts/src/core/modules/exchange/trade.registry.ts
  - apps/electrobun/src/game/stores/trade-store.ts
  - apps/electrobun/src/hud/exchange/TradeWindow.tsx
  - assets/sources/client-code/dofus/aks/Exchange.as:174
---

## Symptôme

Aucun code, des deux côtés. `GameManager.as:1416` montre que l'entrée de menu
existe côté client de retail (« Échanger » sur un joueur → `startExchange(1, id)`).

## Attendu (1.29)

Le flux le plus exigeant du protocole, et le seul qui ait un vrai rollback :

- `ER1|<cible>` → le serveur pousse `ERK<idA>|<idB>|1` **aux deux** joueurs, qui
  voient une boîte oui/non (`Exchange.as:174-269`) ;
- `EA` accepte, puis `ECK1` ouvre les deux fenêtres ; chacune travaille sur un
  **clone** de l'inventaire (`Exchange.as:379`, `deepClone()`) ;
- `EM` décrit son propre mouvement, `Em` celui de l'autre ;
- `EK<0|1><playerId>` porte les deux états de validation ; **toute modification
  après validation la remet à zéro des deux côtés** ;
- le commit n'a lieu qu'aux deux `EK` à 1, et il est atomique ou il n'a pas lieu ;
- `EV` / `EVa` distinguent l'annulation de la réussite.

Refus normalisés : `EREO` déjà en échange, `EREI` impossible, `EREJ`, `EREo`,
`ERES`.

## Correctif

`TradeFlow`, deuxième implémentation de `ExchangeFlow` et la première à avoir un
`setReady` — dont l'absence chez `StorageFlow` signifiait « commit immédiat ».

Les trois points durs annoncés, et ce qu'ils sont devenus :

- **Deux sessions à verrouiller ensemble.** `ExchangeSession.lockKey` : les deux
  côtés portent l'id de l'échange, donc `ExchangeSerializer` leur donne **une**
  file. Il n'y a pas deux verrous à ordonner, donc pas d'interblocage à éviter.
- **L'offre confrontée à la base seulement au commit.** Elle vit dans
  `TradeRegistryService`, `@HandoffPart()` comme le reste — et comme rien n'est
  écrit avant les deux `EK`, un échange restauré après redémarrage est sûr par
  construction : il n'y a pas d'écriture à moitié faite à réconcilier.
- **La déconnexion pendant le commit.** Le commit est un seul
  `withTransaction` et **tout refus lève** au lieu d'être testé et ignoré : un
  `{ ok: false }` renvoyé de l'intérieur arrive sur une transaction que Postgres
  a déjà avortée, donc poursuivre écrirait dans le vide.

Deux ajouts au contrat côté serveur, tous deux imposés par le client
décompilé et invisibles sans lui :

- **`EC` de type 1 n'est suivi d'aucun `EL`** (`onCreate` case 1 clone
  `Player.Inventory`), d'où `ExchangeFramesService.openTrade` à côté de `open`.
- **Toute modification d'une offre remet les deux validations à zéro.**
  `updateLocalData` ne touche que le bouton, jamais les drapeaux : sans cette
  règle côté serveur, l'échange se conclut sur une offre changée après coup.

Immobilisation : `ExchangeService.blocksMovement`, consulté par `MoveHandler`.
Vrai pour un échange en `phase: "open"` seulement — un rangement ne bloque pas,
et la boîte de proposition non plus. Contrôle de **carte** (pas de distance,
cf. QA-114) à la demande, à l'acceptation et au commit — le blocage du
déplacement ne couvre pas les téléportations.

## Vérification

```bash
cd apps/gameserver-ts
bun test src/core/modules/exchange/trade.flow.spec.ts   # 20 cas
bun run test:integration                                # dont trade-commit.int.spec.ts
cd ../electrobun && bun test src/game/stores/trade-store.spec.ts
```

Le cas qui signe la fiche est `« a refusal partway leaves both inventories
exactly as they were »` : c'est la seule propriété que les tests unitaires ne
peuvent pas prouver, puisqu'ils exécutent `withTransaction` en ligne.

À la main : runbook de `doc/sprints/S03-echange-entre-joueurs.md`, étapes 6 et 7.
