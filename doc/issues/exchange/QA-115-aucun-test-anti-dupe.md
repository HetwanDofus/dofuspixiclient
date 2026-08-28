---
id: QA-115
title: Aucun test ne couvre la duplication d'objets ni les courses sur un solde
severity: P1
domain: exchange
type: test-gap
status: fixed
session: 5
opened: 2026-08-28
closed:
fixed_in:
related: [QA-101, QA-102, QA-077, QA-045, QA-064]
files:
  - apps/gameserver-ts/test/integration/
---

## Symptôme

`test/integration/` contient sept fichiers — `exchange-ticket`, `login`, `maps`,
`scripted-cells`, `spell-details`, `spell-upgrade`, `harness` — et **aucun ne
concerne les objets ni les kamas**. Rien ne couvre la duplication.

Le contexte rend le trou concret plutôt que théorique :

- `GatewayFrameService.onFrame` appelle `WsRouter.dispatch` sans `await`, donc
  deux trames du même client s'entrelacent ;
- rien ne limite le débit ni ne dédoublonne (QA-064, QA-045), donc un
  double-clic produit vraiment deux requêtes ;
- `InventoryRepository.insertItem:92` est un lire-puis-écrire assumé.

## Attendu

Le harnais a déjà tout ce qu'il faut et le précédent existe :
`exchange-ticket.repository.int.spec.ts` contient
« concurrent redeems race but only one succeeds ». Le pool est à `max: 10` et
`withTransaction` passe par CLS, donc deux appels dans un `Promise.all` ouvrent
bien deux transactions distinctes.

## Correctif

Cinq cas, à écrire avec QA-101 :

1. Deux `transfer` concurrents de la **même pile entière** → un seul réussit, la
   quantité totale est conservée.
2. Deux retraits de 5 sur une pile de 8 → un seul passe.
3. Deux dépôts simultanés d'objets identiques → **une** ligne, pas deux
   (c'est l'index unique partiel qui est testé ici).
4. Deux mouvements de kamas concurrents sur un solde qui n'en couvre qu'un → un
   refus.
5. Fermeture de session pendant un transfert → ni doublon ni perte.

## Vérification

`bun run test:integration`.
