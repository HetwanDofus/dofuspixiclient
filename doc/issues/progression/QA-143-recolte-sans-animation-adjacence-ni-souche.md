---
id: QA-143
title: La récolte se joue sur la ressource, sans animation ni souche, et reste annulable
severity: P1
domain: progression
type: bug
status: fixed
session: 7
opened: 2026-09-01
closed:
fixed_in:
related: [QA-087, QA-123, QA-129]
files:
  - apps/electrobun/src/game/game-client.ts
  - apps/electrobun/src/game/scene/player/renderer.ts
  - apps/electrobun/src/game/scene/battlefield/picking.ts
  - apps/gameserver-ts/src/core/modules/harvest/harvest.service.ts
  - apps/gameserver-ts/src/core/features/game/move/move.handler.ts
  - apps/gameserver-ts/migrations/0059_item_tool_animation.ts
  - packages/grid/src/pathfinding.ts
---

## Symptôme

En coupant un Frêne avec le compte `dev`, quatre défauts sont visibles :

- le personnage ne joue aucune animation de coupe ;
- il marche sur la cellule de l'arbre au lieu de s'arrêter à côté ;
- un clic de déplacement annule le délai de récolte ;
- l'arbre épuisé ne laisse pas sa souche visible.

Le défaut traverse la boucle générique de récolte et concerne donc tous les
métiers qui l'utilisent, pas seulement Bûcheron.

Une reconnexion révèle deux incohérences supplémentaires : le client ne reçoit
plus l'outil équipé et l'état épuisé des ressources de la première carte.

## Attendu (décision projet)

Le placement adjacent est une décision prise après l'essai en jeu. QA-087 et
QA-123 consignaient auparavant la tolérance du client 1.29 pour une arrivée
sur la cellule interactive ; ce projet choisit explicitement de ne pas la
reproduire pour les ressources.

Le personnage atteint une cellule libre adjacente à la ressource, s'oriente
vers elle et boucle l'animation portée par son outil pendant toute la durée
annoncée par le serveur. Aucun déplacement ni nouvelle interaction ne peut
interrompre cette action. À la fin, l'objet interactif affiche sa frame
épuisée — la souche pour un arbre — jusqu'à la réapparition.

## Cause

- Le clic interactif réutilisait le pathfinding de déplacement jusqu'à la
  cellule cible, sans notion de cellule d'approche.
- `GA;501` ne transportait que la durée : l'identifiant d'animation `an` des
  outils 1.29 n'était ni importé ni émis.
- La protection de mouvement annulait explicitement la récolte en cours.
- Les frames `GDF` étaient réduites à un booléen interactif/non interactif et
  l'atlas aplati n'était jamais positionné sur la frame stable de la souche.
- Le chemin d'entrée en jeu ne rejouait ni l'état de l'outil ni les frames
  persistées de la carte initiale.

## Correctif

- Chercher le plus court chemin vers une cellule libre adjacente pour toute
  compétence de récolte, puis orienter le personnage vers la ressource.
- Importer `item.an`, transmettre cette animation dans `GA;501` et la boucler
  exactement pendant la durée serveur pour tous les personnages visibles.
- Refuser mouvements, clics de cellule et nouvelles interactions tant que la
  récolte est active, côté client et côté serveur, sans annuler la réservation.
- Conserver les frames `GDF`, afficher la frame stable d'épuisement et nettoyer
  ce cache à chaque changement de carte.
- Rejouer l'outil équipé et les frames de récolte dès l'entrée en jeu.

## Vérification

- Tests unitaires du chemin adjacent, de l'immobilisation serveur, de
  l'animation `GA;501`, des frames de souche et de la resynchronisation à la
  connexion.
- Parcours automatisé sur `http://localhost:5173/` avec `dev/dev` : le Frêne
  joue l'animation 17 pendant 12 secondes depuis la cellule voisine ; un clic
  lointain est ignoré ; la position reste identique ; une souche remplace
  l'arbre à l'échéance.
- Rejouer le même parcours manette en main avant de passer la fiche à
  `closed`.
