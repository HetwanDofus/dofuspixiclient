---
id: QA-046
title: "Session zombie après un redémarrage du core : aucun retour utilisateur"
severity: P1
domain: session
type: bug
status: fixed
session: 1
opened: 2026-08-20
closed:
fixed_in: 114ef43db6
related: [QA-048, QA-057, QA-004]
files:
  - apps/gameserver-ts/src/gateway/upstream.ts
  - apps/gameserver-ts/src/gateway/close-codes.ts
  - apps/electrobun/src/game/network/close-codes.ts
  - apps/electrobun/src/game/game-client.ts
  - apps/electrobun/src/window/mainview/MapRenderer.tsx
---

## Symptôme

`docker restart` sur `gamed`, client laissé ouvert :

- le gateway conserve la socket (`/health` → `sessions:1`) et le nouveau core
  démarre proprement (`WsRouter registered 21 message handler(s)`,
  `GatewayFrameService gateway connected`) ;
- le client continue d'afficher le badge vert **« Connected »** ;
- mais **plus aucune réponse serveur** : trois clics de déplacement successifs
  émettent bien `Moving: 324 → 238`, `324 → 260`, sans jamais recevoir
  `gameActionsStart` / `gameActionsFinish` ni `gameMapData`. Le personnage reste
  figé sur la cellule 324, et les logs `gamed` ne montrent aucun `enter-game` de
  restauration.

## Cause

Le `HandoffCoordinator` annonce pourtant `discovered 4 handoff parts: sessions,
scheduler.jobs, player-presence.players, player-presence.pending-moves` — le
mécanisme suppose un déploiement orchestré (nouveau core démarré avant l'arrêt
de l'ancien), ce qu'un restart brutal ne fait pas.

Le défaut à corriger n'est pas le handoff lui-même mais **l'absence totale de
détection** : le client doit repérer que ses ordres restent sans acquittement et
le dire au joueur. Le 1.29 affiche une boîte de dialogue de perte de connexion.
Ici l'interface **ment activement** en affichant « Connected ».

## Correctif — 2026-08-20

**La détection a été placée au gateway, pas au client.** Le rapport proposait un
timeout d'acquittement côté client ; c'est le seul endroit qui ne sait *rien*.
Le gateway, lui, voit le lien UDS du core tomber puis revenir hors handoff : à
cet instant précis l'état de session du core est prouvablement perdu. Il ferme
donc les WebSockets qu'il tenait pour ce core, avec le code applicatif
**4001 / `core_gone`**. Aucune heuristique, aucun délai à régler, aucun faux
positif sous latence.

Portée de la fermeture, dans `apps/gameserver-ts/src/gateway/upstream.ts` :

- seules les sessions **du rôle concerné** partent — un `gamed` qui redémarre ne
  touche pas aux sessions `authd` en cours de login ;
- seules les sessions **existant à l'instant de la coupure** partent. Un client
  qui se connecte *pendant* l'indisponibilité est annoncé au nouveau core depuis
  le buffer et reste parfaitement valide : c'est exactement ce que QA-048 rend
  possible, et la correction ici ne devait pas le reprendre ;
- un **handoff ne ferme personne** : le lien qui meurt n'est plus l'actif, et son
  état a déjà été transféré.

Côté client, trois défauts s'ajoutaient à l'absence de détection :

- `setOnConnected` / `setOnDisconnected` (`game/game-client.ts`) existaient et
  n'étaient **appelés par personne** ;
- le badge « Connected » de `MapRenderer.tsx` était un `useState` renseigné
  **une seule fois au montage**. Il mentait donc aussi sur une coupure réseau
  franche, pas seulement sur une session zombie (voir QA-004) ;
- `Connection.scheduleReconnect` abandonnait **en silence** une fois les
  tentatives épuisées : l'appelant recevait un `disconnected`, puis plus rien —
  indistinguable d'un lien sain et inactif.

Ce qui a été fait : un `connectionStore` porte l'état réel (`connecting` /
`connected` / `reconnecting` / `lost`), le badge et `hudStore.connected` le
lisent en direct, `Connection` émet un événement `failed` quand il renonce, ne
retente plus rien sur 4001 (une socket neuve vers un serveur qui nous a oubliés
ne répare rien), et une modale « Connexion au serveur perdue » s'affiche
au-dessus de l'auth comme du jeu, avec un seul bouton : retour à l'écran de
connexion.

Ce retour est un rechargement complet, assumé — l'état d'une session est réparti
entre des acteurs xstate de portée module, le battlefield Pixi, l'audio et une
demi-douzaine de stores, dont aucun n'a de chemin de démontage aujourd'hui.

**Duplication assumée** : le code 4001 est défini deux fois, dans
`apps/gameserver-ts/src/gateway/close-codes.ts` et
`apps/electrobun/src/game/network/close-codes.ts`. Les deux applications sont
des déployables distincts sans paquet runtime commun ; chaque fichier renvoie
explicitement à l'autre.

## Vérification

- 3 tests gateway sur vraies sockets UDS (fermeture ciblée par rôle, survie d'un
  client arrivé pendant la coupure, handoff qui ne ferme personne), 4 tests sur
  la politique de retry de `Connection`, 6 tests sur le câblage client → état
  affiché. Tous vérifiés rouges sans le correctif.
- Docker : `docker restart dofuspixiclient-gamed-1`, la session ouverte avant la
  coupure reçoit `close code=4001 reason="core_gone"` en **62 ms** ; un client
  connecté pendant l'indisponibilité reste ouvert et survit au retour du core ;
  les sessions `authd` ne bougent pas.

**Reste à repasser le parcours joueur complet manette en main pour clore.**

## Hors périmètre

La reprise de session elle-même. Un joueur déconnecté par un redémarrage de core
doit se reconnecter et perd sa progression non enregistrée. Le rendre transparent
suppose un handoff orchestré à chaque redémarrage, ou une restauration d'état
côté core à partir de la base — deux chantiers d'une autre taille. Voir QA-057
pour les points d'accroche déjà en place.
