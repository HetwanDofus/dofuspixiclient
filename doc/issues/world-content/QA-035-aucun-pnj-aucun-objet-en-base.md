---
id: QA-035
title: Aucun PNJ, aucun objet en base
severity: P0
domain: world-content
type: data
status: in-progress
session: 1
opened: 2026-08-20
closed:
fixed_in:
related: [QA-034, QA-013, QA-027]
files: [apps/gameserver-ts/scripts/import-starloco-content.ts]
---

## Symptôme

`npc_templates` = 0, `scripted_npcs` = 0, `item_templates` = 0. Le monde n'a ni
marchand, ni dialogue, ni butin, ni équipement possible. L'inventaire ne peut
structurellement rien contenir, et la commande d'échange / boutique du menu
contextuel n'a aucun support.

## Cause

Ces trois tables (avec `monster_templates`) sont les seules données de contenu
manquantes : `maps` = 9 358 lignes et `spell_levels` = 10 632 sont bien
peuplées. Il manque donc une étape d'import, pas un schéma.

## Correctif — partiel

Le même `just import-content` peuple `item_templates` (11 415, dont 9 357 avec
effets), `item_sets` (178), `npc_templates` (763) et `scripted_npcs` (803
placements).

**Attention : aucun service serveur ne lit encore ces trois dernières tables.**
Rien n'ajoute un PNJ à la liste de sprites d'`enter-game`, rien n'équipe un
`item_template`. Le monde reste donc visuellement sans marchand et l'inventaire
vide tant que ce câblage n'existe pas ; ce n'est plus un manque de données.

Deux champs 1.29 n'ont pas de colonne où atterrir et ne sont pas importés : les
caractéristiques d'arme (PA / portée / CC) et la liste de vente d'un PNJ — voir
[data-seeding.md](../../data-seeding.md).

## Reste à faire

Le câblage serveur : PNJ dans `enter-game`, équipement depuis `item_templates`,
et les deux colonnes manquantes.
