---
id: QA-058
title: Le combat est jouable mais non finalisé
severity: P1
domain: fight
type: test-gap
status: in-progress
session: 1
opened: 2026-08-20
closed:
fixed_in:
related: [QA-059, QA-060, QA-061, QA-062, QA-063, QA-069, QA-034, QA-043]
files: []
---

## Historique

Ouverte en session 1 sous le titre « le combat n'a jamais été testé » : à
l'époque `monster_templates` était vide et aucun combat PvM ne pouvait être
déclenché. Le verrou a été levé par `just import-content` (QA-034).

## État au 2026-08-23 — vérifié manette en main

**Le combat fonctionne.** Un combat complet se joue de bout en bout :
animations, lancer de sorts, dégâts, tours, fin de combat. Le moteur, l'IA de
monstre et l'interface de combat tiennent la route.

Vérifié aussi par lecture du code, et sans défaut : le lancer de sorts est
**intégralement validé côté serveur** — tour du joueur, PA disponibles, portée
minimale et maximale, ligne de vue, limite de lancers par tour et par cible,
sort réellement appris. Le timer de tour existe côté serveur.

## Ce qui reste à finaliser

Chaque point a désormais sa propre entrée — cette fiche ne sert plus qu'à les
regrouper :

| | |
|---|---|
| [QA-059](QA-059-aucun-xp-ni-kamas-en-fin-de-combat.md) | Ni XP ni kamas en fin de combat |
| [QA-060](QA-060-aucun-butin-d-objets-en-fin-de-combat.md) | Aucun butin d'objets |
| [QA-061](QA-061-glyphes-ne-touchent-que-la-case-centrale.md) | Glyphes : la zone est ignorée |
| [QA-062](QA-062-glyphes-et-pieges-degats-neutres.md) | Glyphes et pièges : dégâts neutres, mauvais effet |
| [QA-063](../progression/QA-063-aucune-regeneration-de-vie-hors-combat.md) | Pas de régénération de vie hors combat |
| [QA-069](QA-069-combattant-fantome-a-la-deconnexion.md) | Combattant fantôme à la déconnexion |
| [QA-043](QA-043-mode-tactique-sans-declencheur.md) | Mode tactique sans bouton |

## Reste non couvert par les tests

Le second verrou de la session 1 est **toujours intact** : il n'existe ni second
personnage ni commande de debug pour amorcer un combat autrement qu'en cliquant
un groupe de monstres. Le PvP en duel a un gestionnaire côté serveur
(`fight-challenge`) mais n'a jamais été joué.

Non mesuré à ce jour : les FPS sous charge de combat.

## Comment amorcer un combat

```bash
SPAWN_MAP_ID=7448 just db-seed   # Arakne, Bouftou, Tofu, Boufton
SPAWN_MAP_ID=7365 just db-seed   # Pious, niveaux 1-5 — le plus doux
```
