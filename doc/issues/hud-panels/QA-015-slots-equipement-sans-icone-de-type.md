---
id: QA-015
title: Slots d'équipement sans icône de type
severity: P3
domain: hud-panels
type: bug
status: wontfix
session: 1
opened: 2026-08-20
closed: 2026-08-23
fixed_in:
related: [QA-014, QA-076, QA-078]
files: [apps/electrobun/src/hud/inventory/EquipmentPanel.tsx]
---

## Symptôme

Les emplacements sont de simples carrés gris de tailles inégales et mal
alignés.

## Attendu (1.29)

À l'ouverture du ticket : « chaque slot grise l'icône du type qu'il
accepte : amulette, anneau, coiffe, cape, ceinture, bottes, familier,
dofus… ». Cet attendu se fondait sur une lecture superficielle de la
capture — un examen plus attentif de `screenshot-ui/inventaire.png`
(session 4) montre qu'un slot vide en 1.29 est une case grise **nue** :
ni libellé, ni icône grisée du type. C'est ce que confirme aussi le
dossier `panels/inventory/` du pipeline d'assets, qui ne contient aucun
jeu d'icônes par position.

## Correctif

QA-076 a corrigé la table de positions sous-jacente, et QA-078 (session 4)
a remplacé les slots vides par `equip-slot-fill.svg` (le vrai fond 1.29)
sans aucun libellé texte — `EQUIP_SLOT_LABELS` est supprimé. « tailles
inégales et mal alignés » était déjà réglé par `EQUIP_SLOT_BOXES`. Il n'y
a donc rien à corriger de plus : l'écart avec l'attendu initial vient de
l'attendu, pas du code.

## Vérification

Comparaison directe avec `screenshot-ui/inventaire.png` le 2026-08-23 : un
slot vide y est un simple carré gris, sans texte ni icône — ce que le
client produit maintenant.
