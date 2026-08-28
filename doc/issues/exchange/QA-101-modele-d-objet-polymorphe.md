---
id: QA-101
title: Un objet change d'identité à chaque déplacement — quatre tables de contenants, quatre séquences
severity: P1
domain: exchange
type: feature
status: fixed
session: 5
opened: 2026-08-28
closed:
fixed_in:
related: [QA-086, QA-077, QA-102, QA-115]
files:
  - apps/gameserver-ts/migrations/0053_items_polymorphic_owner.ts
  - apps/gameserver-ts/src/core/modules/items/
  - apps/gameserver-ts/src/core/modules/inventory/inventory.repository.ts
  - apps/gameserver-ts/scripts/dev-seed.ts
---

## Symptôme

Un échange, quel que soit son type, est « déplacer une pile d'un contenant vers
un autre ». Le dépôt a quatre tables de contenants de forme identique
(`owner`, `template_id`, `quantity`, `effects`) et **quatre `bigserial`
distincts** : `player_items`, `account_bank_items`, `house_storage_items`,
`big_store_listings`.

Relevé en base le 2026-08-28 : `player_items` = 54 lignes, les trois autres = 0.
Seules deux requêtes hors `schema.ts` les touchent, et ce sont deux `COUNT(*)`
(`InteractiveObjectsRepository.countHouseStorage:56`, `.countAccountBank:66`).

Conséquences mesurables :

- Déposer un objet en banque = `DELETE` dans une table + `INSERT` dans une
  autre. L'identifiant d'instance est perdu et un neuf est alloué. Il n'existe
  aucune identité d'objet stable à travers un déplacement, donc rien à tracer
  dans un journal d'audit.
- `InventoryRepository.insertItem:92` fait un lire-puis-écrire dont son propre
  commentaire (`:89-90`) dit qu'il n'est pas atomique. En `READ COMMITTED` —
  le défaut, aucun niveau d'isolation n'est réglé nulle part — deux
  transactions concurrentes lisent la même absence de pile et insèrent chacune
  une ligne.
- Aucune contrainte : `player_items.quantity` est `integer DEFAULT 1` sans
  `NOT NULL` ni `CHECK > 0` (`0001_initial.ts:185`), `template_id` sans clé
  étrangère, `players.kamas` sans `CHECK >= 0` (`0001_initial.ts:111`).

## Attendu (1.29)

Aucun attendu protocolaire : c'est une décision de modèle interne. Le protocole
1.29 ne connaît qu'un `objectId` par objet et suppose qu'il est stable tant que
l'objet existe (`dofus/aks/Exchange.as:1013`, `findFirstItem("ID", …)`).

## Correctif

Une table `items` unique à propriétaire polymorphe :

    items(id, owner_kind, owner_id, template_id, quantity, effects, position)
    effects_hash = md5(effects::text) GENERATED STORED
    UNIQUE (owner_kind, owner_id, template_id, effects_hash) WHERE position = -1
    CHECK (quantity > 0)

`OwnerKind` : `Player = 1, Bank = 2, House = 3, BigStore = 4, Merchant = 5,
TaxCollector = 6, Mount = 7, Paddock = 8`. Chaque futur type d'échange est un
`owner_kind` de plus, pas une table de plus.

L'index unique partiel remplace le lire-puis-écrire par un
`ON CONFLICT DO UPDATE`. Le déplacement reprend l'idiome maison — le prédicat
dans l'`UPDATE`, `numUpdatedRows` à zéro vaut refus — établi par
`PlayersRepository.spendKamas:246` (QA-077), sans introduire de `SELECT FOR
UPDATE`, dont le dépôt ne contient aujourd'hui aucune occurrence.

Le guid n'est réellement préservé que sur le chemin rapide (pile entière, pas
de fusion à destination) ; un `split` crée forcément une identité. Le gain
n'est donc pas « le guid ne change jamais » mais : un `UPDATE` atomique, un
seul jeu de contraintes, un seul journal, zéro adaptateur par contenant.

`big_store_listings` n'est pas reprise ici — elle porte prix et expiration et
son schéma diverge du protocole. Voir QA-108.

Journal d'audit `item_ledger` écrit dans la même transaction :
`at, tx_id, actor_character_id, item_id, template_id, quantity, from_kind,
from_id, to_kind, to_id, exchange_kind, exchange_session_id`.

## Vérification

`bun test src/` et `bun run test:integration` verts, dont les cas anti-dupe de
QA-115. Non-régression manuelle : équiper, déséquiper, utiliser une potion,
poser un objet dans la barre de raccourcis, gagner du butin en fin de combat.
