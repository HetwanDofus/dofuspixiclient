---
id: QA-092
title: Un clic pendant un déplacement est ignoré au lieu d'interrompre la marche
severity: P2
domain: input
type: gap
status: fixed
session: 6
opened: 2026-08-27
closed:
fixed_in:
related: [QA-089]
files:
  - apps/electrobun/src/game/game-client.ts
  - apps/electrobun/src/game/network/handlers/map.handler.ts
  - apps/electrobun/src/game/scene/player/movement.ts
  - apps/gameserver-ts/src/core/features/game/move-ack/move-ack.landing.ts
  - apps/gameserver-ts/src/core/features/game/move-ack/move-ack.handler.ts
---

## Symptôme

Le personnage traverse la place d'Astrub ; on clique ailleurs en cours de
route. Rien ne se passe. Il faut attendre la fin de la marche pour que le
clic suivant soit pris en compte — et c'est vrai aussi pour une porte, un
élément interactif ou un groupe de monstres cliqué pendant le trajet.

## Attendu (1.29)

Un clic pendant une marche la coupe : le personnage termine le pas engagé,
s'arrête sur cette case, et repart aussitôt vers la nouvelle destination — ou
y déclenche l'action demandée.

## Cause

Le client refusait le clic, littéralement :
`handleCellClick` sortait sur `isCharacterMoving()`, avec la même garde dans
`useInteractive`. La garde était justifiée : chaque action se calcule depuis la
case où l'on est, et pendant une marche cette case est périmée — le serveur
valide un chemin depuis la position qu'il a **committée**, pas depuis celle où
le sprite est en train de passer.

Et il n'y avait aucun moyen de lui dire qu'on s'était arrêté en route. Le
serveur garde un déplacement en attente par session (`PendingMovesService`) et
ne committe la case d'arrivée qu'à l'acquittement ; le client n'envoyait que
`GKK` (« arrivé »), donc s'arrêter avant la fin l'aurait fait mentir. Le
message pour le dire existe pourtant dans le protocole depuis le début, jamais
émis ni écouté : `GKE`, l'annulation, avec la case réellement atteinte en
paramètre.

## Correctif

Client — `PlayerMovement.interrupt` tronque le chemin au segment en cours : le
sprite finit le pas engagé et s'arrête sur cette case. C'est le seul point
d'arrêt que le protocole sache exprimer, une position étant un identifiant de
case. L'acquittement devient alors `GKE<actionId>|<case>` au lieu de `GKK`, et
l'action demandée (clic sur une case, sur un élément) est rejouée dans le hook
de fin de marche, depuis la case d'arrêt.

Serveur — `resolveMoveLanding` (module pur, testé) décide de la case
d'arrivée : la destination validée pour un `GKK`, la case annoncée pour un
`GKE` **à condition qu'elle soit un des pas du chemin autorisé** — chacun a
déjà été vérifié adjacent et marchable à la validation, donc le committer est
toujours légal, alors qu'accepter n'importe quelle case ferait de l'annulation
un téléport gratuit. Tout le reste de l'acquittement est inchangé : la case
d'arrivée alimente les mêmes déclencheurs (cellule scriptée, groupe de
monstres, bord de carte), donc s'arrêter pile sur un groupe déclenche bien le
combat.

Deux effets de bord traités dans la foulée :

- Un déplacement appartient au personnage **jusqu'à son acquittement**, pas
  seulement pendant l'animation. Le serveur ne garde qu'un déplacement en
  attente et apparie l'acquittement par identifiant : une seconde requête
  envoyée avant l'acquittement de la première l'orpheline, et la position
  qu'elle devait committer est perdue — le personnage se retrouve bloqué, tout
  chemin suivant partant d'une case que le serveur ne lui reconnaît pas. La
  fenêtre était étroite (requête → écho) mais c'est exactement celle qu'un
  joueur qui clique vite traverse. Le client suit donc l'aller-retour complet
  (`isSelfMoveInFlight`, avec expiration au cas où le serveur refuse le chemin
  sans répondre) et interrompt aussi une marche dont l'écho n'est pas encore
  revenu, en tronquant le chemin à son premier pas à l'arrivée.
- `PlayerMovement.start` accepte maintenant de remplacer un chemin en cours :
  le conteneur est recalé sur la case d'ancrage avant de mesurer le premier
  segment, sinon les pixels restants du segment abandonné décalent tout le
  reste de la marche.

Limite connue : les autres clients n'apprennent l'interruption qu'au
déplacement suivant du personnage (il n'y a pas de trame « untel s'est arrêté
là » dans ce protocole), et leur sprite finit donc l'ancien chemin avant de se
recaler. Le serveur, lui, est juste dès l'annulation.

## Vérification

`bun test src/core/features/game/move-ack/` (5 cas, dont le refus d'une case
hors chemin) et `bun test src/game/scene/player/movement.spec.ts` (4 cas sur la
troncature).

En jeu : lancer une longue marche et cliquer ailleurs en cours de route — le
personnage s'arrête au pas suivant et repart vers la nouvelle case ; refaire
l'essai en cliquant une porte, puis un groupe de monstres.
