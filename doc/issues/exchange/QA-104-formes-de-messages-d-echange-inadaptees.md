---
id: QA-104
title: ExchangeList et ExchangeItemMovement ne portent pas un objet sous la forme que le reste du protocole utilise
severity: P2
domain: exchange
type: gap
status: fixed
session: 5
opened: 2026-08-28
closed:
fixed_in:
related: [QA-086, QA-103]
files:
  - proto/exchange.proto
  - proto/common.proto
  - assets/sources/client-code/dofus/managers/CharactersManager.as:480
---

## Symptôme

`ExchangeItemMovement` porte `item_id`, `quantity`, `unic_id`,
`effects_raw: string` et `price` — la transcription littérale de la chaîne 1.29.
Partout ailleurs dans ce protocole (`ItemAdd`, `ItemChange`, `AccountStats`) un
objet voyage en `ItemData`, avec ses effets structurés en `repeated ItemEffect`,
et le client sait déjà rendre cette forme (`inventory-store.ts`,
`ItemDetailPanel.tsx`). Garder `effects_raw` obligerait à écrire un second
chemin de décodage et de rendu côté client pour le même objet.

`ExchangeList` porte `repeated ExchangeListingLine {line_id, item_id, stats,
quantity, price}` : c'est la forme d'une ligne de craft ou d'hôtel de vente, pas
celle du contenu d'un rangement.

## Attendu (1.29)

Le client construit chaque entrée de `EL` par
`CharactersManager.getItemObjectFromData` (`:480-495`), qui produit un
`Item(objectId, templateId, quantity, position, effects)` — c'est-à-dire
exactement les champs de `ItemData`. La forme attendue est donc bien celle d'un
objet d'inventaire, pas celle d'une ligne de vente.

Deux détails du contrat, relevés dans `Exchange.as:997-1051`, à documenter dans
le proto parce qu'ils ne se devinent pas :

- la quantité d'un mouvement `Es` est **absolue**, pas un delta : l'entrée
  existante est remplacée par `updateItem` ;
- l'ajout est un upsert par identifiant d'objet, et la suppression ne lit que
  cet identifiant.

## Correctif

- `ExchangeList` → `repeated ItemData items` + `int64 kamas`.
- `ExchangeItemMovement` → un `ItemData`, `price` conservé pour les boutiques.
- Commenter la sémantique de quantité absolue là où elle s'applique.

Ce projet n'est pas lié à l'encodage 1.29 — il est lié à sa sémantique. Le
proto est déjà un re-typage des chaînes, pas leur copie.

## Vérification

`buf generate` puis `bun run typecheck` des deux côtés.
