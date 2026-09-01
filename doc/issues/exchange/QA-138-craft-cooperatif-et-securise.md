---
id: QA-138
title: Ni craft coopératif ni craft sécurisé
severity: P2
domain: exchange
type: feature
status: fixed
session: 6
opened: 2026-08-31
closed:
fixed_in:
related: [QA-102, QA-107, QA-135, QA-139]
files:
  - proto/exchange.proto
  - proto/common.proto
  - apps/gameserver-ts/src/core/modules/exchange
---

## Symptôme

`EXCHANGE_SECURE_CRAFT_CLIENT = 12` et `EXCHANGE_SECURE_CRAFT_ARTISAN = 13`
n'ont pas de flux, et les messages qui les portent — `Er` (mouvement coopératif)
et `Ep` (mouvement de paiement), `ExchangeMovePayItem` / `ExchangeMovePayKama` —
sont typés sans producteur.

## Attendu (1.29)

L'artisan se place à l'atelier, le client dans la salle. Un menu « Inviter à
[métier] » côté artisan, « Demander à [métier] » côté client ; les deux
confirment. Le client dépose les ingrédients, l'artisan fabrique, le paiement
est optionnel. L'objet part dans l'inventaire du **client**, l'expérience va à
l'**artisan**.

## Cause

Rien n'est engagé. Le socle (QA-102) et le patron à deux côtés (QA-107,
`trade.flow.ts` : une file, pas deux verrous) sont en place.

## Correctif

`modules/exchange/secure-craft.flow.ts` : deux sessions, un `lockKey`
partagé — le patron de `TradeFlow` (une file, pas deux verrous), et non celui
de `CraftFlow`, qui est à un seul côté. Les **règles**, en revanche, viennent
de `craft.rules.ts` sans copie : un craft coopératif et un craft solo ne
peuvent pas diverger sur les cases, l'XP ou le tirage.

Trois décisions assumées :

- **`ER` porte la compétence dans `cell_num`.** Le 1.29 le décrit comme un
  numéro de cellule optionnel, aucune demande de craft sécurisé n'en a jamais
  eu besoin, et l'entrée de menu qui l'envoie (« Inviter à Bûcheron ») doit
  bien nommer un métier. Réutiliser le champ libre coûte moins qu'un
  dix-neuvième message d'échange.
- **Seule l'invitation est offerte, pas la demande.** Le client ne peut pas
  savoir quels métiers a l'autre joueur : « Demander à … » serait une liste
  de suppositions que le serveur refuse une par une. L'artisan, lui, connaît
  son métier.
- **Ni la proximité de l'établi ni la distance ne sont vérifiées**, seulement
  la carte — la même règle que `TradeFlow`, et pour la même raison (QA-114).

Ce qui est vérifié à la fabrication et pas seulement à l'invitation : le
métier, son niveau, et **l'outil porté**. Une proposition peut rester à
l'écran aussi longtemps que les deux le veulent.

## Vérification

Prouvé en base sur quatre fabrications : le client perd ses ingrédients et
ses kamas, l'artisan reçoit le paiement et **l'expérience**, les planches vont
**toutes** au client, et un échec consomme et paie comme un craft solo.

