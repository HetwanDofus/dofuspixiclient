---
id: QA-108
title: Hôtel de vente — les vendeurs sont posés, la table des lots ne correspond pas au protocole et n'est jamais alimentée
severity: P1
domain: exchange
type: feature
status: fixed
session: 5
opened: 2026-08-28
closed:
fixed_in: S04
related: [QA-086, QA-100, QA-101, QA-102, QA-127, QA-128]
files:
  - apps/gameserver-ts/migrations/0056_big_store_listings.ts
  - apps/gameserver-ts/src/core/modules/exchange/big-store.flow.ts
  - apps/electrobun/src/hud/bigstore/
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

## Correctif

**La table est refondue** (`0056_big_store_listings.ts`) : une ligne est **un
lot**, `lot_size ∈ {1,10,100}` sous contrainte, `price > 0`, un `hdv_id`, le
vendeur en personnage *et* en compte, et une échéance. Elle ne porte ni
`sold`, ni `buyer_id`, ni copie d'effets : la marchandise est une vraie ligne
`items` appartenant à `(OwnerKind.BigStore, id de l'annonce)`, et `item_ledger`
est le registre de ce qui lui est arrivé.

`hdv_templates` est alimentée par `just import-content` depuis `hdvs` du dump —
56 halls, 2 écartés faute de map importée. Un hall est **une map**, le vendeur
n'est que la porte : 55 des 56 placements de vendeurs tombent sur une map qui
porte une ligne `hdvs`.

Trois messages ajoutés au protocole, tous serveur → client : `ExchangeBigStoreParams`
(les paramètres d'ouverture, que 1.29 entasse dans `EC`), `ExchangeBigStoreOwnList`
et `ExchangeBigStoreOwnMovement` (« Stock en magasin », qu'`EL` ne sait pas
décrire faute de prix et de taille de lot). Rien de neuf côté client → serveur :
`ExchangeMoveItem` porte déjà les deux gestes.

`BigStoreFlow` rejoint `StorageFlow` et `TradeFlow`. La taxe est prélevée à la
mise en vente et perdue, les kamas d'une vente et les invendus vont au **coffre
de banque** du vendeur, on ne peut pas racheter ses propres lots, et
l'expiration passe par `SchedulerService`.

**`EHm` n'est pas émis.** La ligne d'un objet générique est un *groupe* nommé
d'après le lot le moins cher qu'il contient ; cet id change dès que ce lot est
acheté ou sous-coté, et un upsert sur cet id laissait la ligne périmée à côté
de la nouvelle — deux lignes de Blé, dont une dont l'achat était refusé. Le
`EHl` complet est renvoyé à la place.

## Vérification

Recette en jeu sur l'hôtel de vente Paysan d'Astrub (map 7397, catégorie
Céréale) : ouverture par la bulle du vendeur dans les deux modes, catégorie
sélectionnée d'office, fiche d'objet, grille x1/x10/x100 en une seule ligne
pour une ressource, achat (kamas débités, lot reçu, coffre du vendeur crédité),
mise en vente avec taxe prévisualisée au kama près, retrait, et « Filtrer pour
cet HDV ».

```bash
cd apps/gameserver-ts && bun test src/ && bun run typecheck
cd ../electrobun     && bun test && bun run check-types
```

## Reste à faire

- Pierres d'âme (`EHM`), hors périmètre : une liste de monstres, pas d'objets.
- La recherche narrowit la catégorie affichée, là où 1.29 interroge tout le
  hall — le serveur ne tient pas d'index par nom.
- Fenêtres déplaçables : aucune fenêtre du projet ne l'est. Le mode vente se
  met à l'échelle pour tenir dans la zone de jeu, faute de pouvoir se
  chevaucher comme le retail.

