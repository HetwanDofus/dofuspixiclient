---
id: QA-103
title: L'énumération ExchangeType diverge du client décompilé sur 11 valeurs sur 19
severity: P2
domain: exchange
type: bug
status: fixed
session: 5
opened: 2026-08-28
closed:
fixed_in:
related: [QA-086, QA-104]
files:
  - proto/common.proto:171
  - assets/sources/client-code/dofus/aks/Exchange.as:355
  - assets/sources/client-code/dofus/datacenter/NonPlayableCharacter.as:76
---

## Symptôme

`proto/common.proto:171` déclare `enum ExchangeType` avec 19 valeurs. Comparée
au `switch` de `onExchangeCreate` du client 1.29 décompilé présent au dépôt
(`assets/sources/client-code/dofus/aks/Exchange.as:355`), **11 valeurs sur 19
désignent autre chose que ce que le client ouvre**.

| ID | Composant chargé par le client | Nom dans l'énumération | |
|---|---|---|---|
| 0 | `NpcShop` | `EXCHANGE_SHOP` | ✅ |
| 1 | `Exchange` (joueur-joueur) | `EXCHANGE_PLAYER` | ✅ |
| 2 | `Exchange` (PNJ) | `EXCHANGE_NPC_SHOP` | ⚠️ mal nommé |
| 3 | `Craft` / `ForgemagusCraft` / `Decraft` | `EXCHANGE_CRAFT_PLAYER` | ⚠️ mal nommé |
| 4 | `PlayerShop` | `EXCHANGE_CRAFT_CLIENT` | ❌ |
| 5 | **`Storage`** — banque et coffre | `EXCHANGE_PLAYER_SHOP` | ❌ |
| 6 | `PlayerShopModifier` | `EXCHANGE_STORAGE` | ❌ |
| 7 | *aucun `case` — tombe en `default: return`* | `EXCHANGE_SHOP_MODIFIER` | ❌ |
| 8 | `TaxCollectorStorage` | `EXCHANGE_TAX_COLLECTOR` | ✅ |
| 9 | `Exchange` (PNJ, action `N.a` = 4) | `EXCHANGE_SECURE_STORAGE` | ❌ |
| 10 | `BigStoreSell` | `EXCHANGE_BIGSTORE_SELL` | ✅ |
| 11 | `BigStoreBuy` | `EXCHANGE_BIGSTORE_BUY` | ✅ |
| 12 / 13 | `SecureCraft` | `SECURE_CRAFT_*` | ✅ |
| 14 | `CrafterList` | `EXCHANGE_MOUNT_PARK` | ❌ |
| 15 | `Storage{isMount:true}` — inventaire monture | `EXCHANGE_NPC_RESURECTION` | ❌ |
| 16 | `MountStorage` — étable et enclos | `EXCHANGE_NPC_RESURECTION_PET` | ❌ |
| 17 | `Exchange` (PNJ, action `N.a` = 7) | `EXCHANGE_MOUNT_CERTIFICATE` | ❌ |
| 18 | `Exchange` (PNJ, action `N.a` = 8) | `EXCHANGE_RUNE_TRADE` | ❌ |

**La banque est le type 5, pas le 6.** L'énumération actuelle est celle des
constantes de StarLoco, pas celle du client.

## Attendu (1.29)

Le client du dépôt fait foi. Le décalage commence à 4 et ne se rattrape qu'à 8,
puis repart à 14.

## Cause

L'énumération a été transcrite depuis l'émulateur au lieu du client. Rien ne la
consommait jusqu'ici, donc l'écart n'avait aucune conséquence observable.

## Correctif

Réaligner `proto/common.proto:171` sur `Exchange.as:355`, puis `buf generate`.
Aucun consommateur aujourd'hui — `grep ExchangeType` ne renvoie que la
déclaration —, donc le coût est nul maintenant et croissant à chaque type livré.

## Vérification

`bun run typecheck` des deux côtés. Relecture croisée de chaque valeur contre
son `case` dans `Exchange.as`.
