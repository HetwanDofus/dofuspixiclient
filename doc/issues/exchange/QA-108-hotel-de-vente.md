---
id: QA-108
title: Hôtel de vente — les vendeurs sont posés, la table des lots ne correspond pas au protocole et n'est jamais alimentée
severity: P1
domain: exchange
type: feature
status: open
session: 5
opened: 2026-08-28
closed:
fixed_in:
related: [QA-086, QA-100, QA-101, QA-102]
files:
  - apps/gameserver-ts/migrations/0008_exchange.ts:27
  - apps/gameserver-ts/migrations/0014_starloco_parity.ts:105
  - proto/exchange.proto
---

## Symptôme

Les 55 placements du gfx 9073 — tous les vendeurs d'hôtel de vente du jeu — sont
en base et visibles depuis QA-100. Rien derrière.

Deux défauts de données distincts :

- **`big_store_listings` ne peut pas représenter un lot 1.29.** Elle porte un
  `price` et une `quantity` uniques (`0008_exchange.ts:27-40`), alors que
  `BigStoreListingLine` du proto exige `price_qty1`, `price_qty10` et
  `price_qty100` **sur une même ligne** — c'est ce que `EHl` envoie et ce que
  `BigStoreBuy` affiche. Aucune contrainte non plus : `quantity` et `price` sont
  nullables, sans `CHECK`, sans unicité.
- **`hdv_templates` compte 0 ligne.** La migration `0014_starloco_parity.ts:105`
  crée la table (taxe, niveau maximum, nombre d'objets par compte, durée de
  vente) et aucun script ne l'alimente, alors que `game.sql:8960` porte 100
  lignes `hdvs`.

Manquent aussi : pas de `sold_at`, pas de `buyer_id`, aucun drapeau « en vente »
sur l'objet — donc rien n'empêcherait de vendre par ailleurs un objet déjà listé.

## Attendu (1.29)

Types 10 (`BigStoreSell`) et 11 (`BigStoreBuy`). `ECK10`/`ECK11` portent
`<q1,q2,q3>;<types>;<taxe>;<niveauMax>;<objetsMax>;<npcId>;<duréeMax>`. Vente par
lots de 1, 10 ou 100 ; taxe prélevée à la mise en vente ; expiration qui renvoie
l'invendu **au coffre en banque** (le dialogue PNJ 2349 du dump le dit
explicitement) ; interdiction de racheter ses propres lots.

## Décision à prendre

Refondre `big_store_listings` en lots 1/10/100 conformes au protocole, ou
conserver la forme actuelle et adapter le protocole. La première option est la
seule compatible avec le client de retail.

## Reste à faire

Non engagé. Dépend de QA-101 et QA-102.
