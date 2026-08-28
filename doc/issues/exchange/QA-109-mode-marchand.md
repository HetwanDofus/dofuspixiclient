---
id: QA-109
title: Aucun mode marchand
severity: P2
domain: exchange
type: feature
status: open
session: 5
opened: 2026-08-28
closed:
fixed_in:
related: [QA-101, QA-102, QA-108]
files:
  - assets/sources/client-code/dofus/aks/Exchange.as:434
---

## Symptôme

Aucun code. Aucun contenant. Aucun état marchand sur le personnage.

## Attendu (1.29)

Deux types distincts :

- **6** — `PlayerShopModifier`, « organiser ma boutique »
  (`GameManager.as:1335`, `startExchange(6)` sans cible) : le joueur garnit son
  étal et fixe ses prix. Le stock du vendeur est **distinct de l'inventaire
  vivant** : un objet mis en étal en sort.
- **4** — `PlayerShop`, ce qu'un acheteur voit en cliquant sur un marchand posé
  (`DofusBattlefield.as:729,743`, `startExchange(4, id, cellNum)`).

Le marchand reste en jeu hors connexion, c'est tout l'intérêt du mode ; ce qui
suppose un sprite persistant sur la carte et un contenant qui vit sans session.

## Correctif

`owner_kind = Merchant`. Deux `ExchangeFlow`. Le drapeau
`RestrictionFlag.CANNOT_EXCHANGE` (`proto/common.proto:161`), aujourd'hui jamais
lu, trouve ici son premier usage.

## Reste à faire

Non engagé.
