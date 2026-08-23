---
id: QA-065
title: La vitesse de déplacement n'est pas vérifiée côté serveur
severity: P1
domain: network
type: gap
status: confirmed
session: 2
opened: 2026-08-23
closed:
fixed_in:
related: [QA-064, QA-045]
files:
  - apps/gameserver-ts/src/core/features/game/move/move.handler.ts
  - apps/gameserver-ts/src/core/features/game/move-ack/move-ack.handler.ts
---

## Symptôme

Le serveur valide **où** l'on va, jamais **en combien de temps**.

`MoveHandler` valide le chemin (adjacence, marchabilité) et retient la
destination ; `MoveAckHandler` commite cette destination à réception de
l'accusé. C'est correct et incontournable — un client modifié ne peut pas se
téléporter en mentant sur la case d'arrivée.

Mais **rien ne date le départ**, et rien ne compare l'instant de l'accusé à la
durée théorique du trajet. Un client qui accuse réception immédiatement traverse
donc la map instantanément, case par case légitime.

## Portée

C'est le « speedhack » classique. Il n'existe aujourd'hui aucune trace du
problème parce qu'aucun client modifié ne tourne — mais il est trivial à
exploiter et devient une inégalité de jeu directe dès qu'un joueur y touche.
Combiné à QA-064, il permet aussi de saturer les diffusions de map.

## Correctif

Horodater l'entrée en attente dans `PendingMovesService`, calculer la durée
théorique depuis la longueur du chemin et le mode marche/course — déjà décidé
par `shouldUseRun(pathLength, runLimit)` — et rejeter un accusé arrivé
significativement trop tôt. Prévoir une marge de tolérance pour la latence et la
gigue ; en cas de rejet, renvoyer la position réelle plutôt que de fermer la
session.

## Vérification

Voir le runbook du sprint 01, étape « Vitesse de déplacement ».
