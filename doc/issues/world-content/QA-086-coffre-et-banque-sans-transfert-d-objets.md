---
id: QA-086
title: Coffre et banque s'ouvrent mais ne transfèrent aucun objet
severity: P2
domain: world-content
type: gap
status: fixed
session: 2
opened: 2026-08-25
closed:
fixed_in:
related: [QA-085, QA-101, QA-102, QA-103, QA-104, QA-105, QA-115]
files:
  - apps/gameserver-ts/src/core/modules/interactive-objects/interactive-objects.service.ts
  - proto/exchange.proto
  - proto/world.proto
---

## Symptôme

Cliquer « Ouvrir » sur un coffre déclenche bien l'action et le serveur répond
`StorageInformations` (`sI`) avec la taille du rangement, mais aucune fenêtre ne
s'ouvre côté client et aucun objet ne peut être déplacé.

## Attendu (1.29)

`sI` n'est que l'annonce de la taille. Le contenu et les déplacements passent
par le protocole d'échange : `EC` (ouverture), `EL` (contenu), `EMO` / `EMG`
(objet / kamas), `EV` (fermeture).

Relevé depuis le client décompilé du dépôt : **pas de `EK`** pour le type 5 —
`onCreate` case 5 ne construit jamais `datacenter.Exchange`, donc un `EK`
déréférencerait `undefined`. Un rangement n'a pas de phase de validation, chaque
mouvement s'engage seul.

## Cause

QA-085 a câblé la compétence 104 jusqu'au bon rangement — `house_storage_items`
quand la carte appartient à une maison, `account_bank_items` sinon — et s'est
arrêté là. Le protocole d'échange n'est implémenté par aucun handler serveur
(`grep ExchangeCreate apps/gameserver-ts/src` ne renvoie rien) et le client n'a
ni handler entrant ni fenêtre de coffre.

C'est une fonctionnalité à part entière, pas un oubli de câblage : elle
supposerait le protocole d'échange complet, réutilisé plus tard par le commerce
entre joueurs et les hôtels de vente.

## Correctif

Le protocole d'échange est implémenté de bout en bout pour le type 5, et il
est posé comme un socle plutôt que comme une fonctionnalité isolée — les dix-huit
autres types réutilisent tout ce qui suit.

**Modèle** (QA-101) — `player_items` devient `items`, avec un propriétaire
polymorphe (`owner_kind`, `owner_id`). La banque est `owner_kind = Bank`, clé
compte ; le coffre de maison sera `House`. Un index unique partiel
`(owner_kind, owner_id, template_id, effects_hash) WHERE position = -1` rend
deux piles identiques dans un même contenant non représentables, ce qui remplace
le lire-puis-écrire de `insertItem` par un `ON CONFLICT DO UPDATE`. Contraintes
ajoutées : `quantity > 0`, `kamas >= 0` des deux côtés, clé étrangère sur le
gabarit. Journal `item_ledger` écrit dans la transaction du déplacement.

**Déplacement** (`ItemTransferService`) — deux chemins. Une pile entière vers un
contenant qui n'a rien d'identique est un seul `UPDATE` et **garde son
identifiant** ; le reste est un `take` puis un `give`. Aucun verrou : chaque
écriture porte son prédicat et rend le nombre de lignes touchées, l'idiome de
`spendKamas` (QA-077).

**Session** (QA-102) — `ExchangeRegistryService` est `@HandoffPart()`, donc une
banque ouverte survit à un redémarrage du core au lieu de laisser une fenêtre
morte à l'écran comme le font aujourd'hui les dialogues PNJ (QA-113).
`ExchangeSerializer` sérialise les opérations d'une même session, parce que
`WsRouter.dispatch` n'est pas `await`é et qu'un double-clic arrive vraiment en
double (QA-045, QA-064).

**Ouverture** — `InteractiveObjectsService.openStorage` émet toujours `sI`, puis
ouvre l'échange : `EC` **puis `EL`**. L'ordre n'est pas cosmétique —
`dofus.datacenter.Storage` n'alloue son tableau d'inventaire que dans `onList`,
donc tout `Es` envoyé avant l'`EL` est perdu en silence. Le client n'émet jamais
`ER` pour un rangement, d'où l'absence de handler `ExchangeRequestSend`.

**Protocole** (QA-103, QA-104) — `ExchangeType` réaligné sur le client du dépôt
(la banque est le **5**, pas le 6) ; `ExchangeList` et `ExchangeItemMovement`
portent un `ItemData`.

**Client** — `exchange-store` sur le modèle de `npc-dialog-store`, un handler
`EC`/`EL`/`Es`/`EV`, et une fenêtre `StorageWindow` faite de deux `ItemGrid`
extraits de `BagPanel` (qui passe de 455 à 65 lignes). Rendue hors de la
rotation `activePanel` : ouvrir la banque ne ferme pas l'inventaire.

## Vérification

`bun test src/` (441), `bun run test:integration` (39, dont les cinq cas
anti-dupe de QA-115) et les deux `typecheck` sont verts. Le core démarre :
36 handlers pour 31 types, et `exchange.sessions` apparaît parmi les six parties
du transfert d'état.

Reste à rejouer manette en main — c'est le runbook de
[S02](../../sprints/S02-echange-socle-et-banque.md), et c'est ce qui fera passer
la fiche de `fixed` à `closed`.
