---
id: QA-130
title: Aucun PNJ n'enseigne de métier — l'action de réponse 6 n'a pas de branche
severity: P1
domain: world-content
type: gap
status: fixed
session: 6
opened: 2026-08-31
closed: 2026-09-01
fixed_in:
related: [QA-097, QA-123, QA-129]
files:
  - apps/gameserver-ts/scripts/import-starloco-content.ts
  - apps/gameserver-ts/src/core/features/game/npc-dialog/npc-dialog.handler.ts
---

## Symptôme

Un personnage ne peut acquérir aucun métier. Le graphe de dialogue PNJ est
importé (QA-097) et `npc_reponses_actions` contient **40 lignes de type 6**,
toutes libellées « Apprendre le métier de … », avec l'identifiant du métier en
tête des arguments :

```
(271, 6, '28,524,335,336',    'Apprendre le métier de Paysan')
(280, 6, '2,898,335,1489',    'Apprendre le métier de Bûcheron')
(322, 6, '24,7599,2390,1489', 'Apprendre le métier de Mineur')
(58 → 6, '58,7596,1185,1489', 'Devenir poissonnier')
```

La tranche de dialogue dispatche les autres types d'action ; le 6 ne mène nulle
part.

## Attendu (1.29)

Parler au maître de métier et choisir « Apprendre le métier de X » inscrit le
métier au niveau 1, envoie `JS` et `JX`, et le fait apparaître dans le panneau
Métiers. L'outil n'est pas exigé à l'apprentissage : il s'achète et s'équipe
séparément.

Trois métiers non spécialisés et trois spécialisations au maximum, et un
nouveau n'est possible que si **tous** les métiers et mages déjà appris sont au
moins niveau 30.

## Cause

`npc_reponses_actions` est importée mais son type 6 n'a jamais eu de
destinataire, faute de service métier.

## Correctif

Branche `6` dans la tranche `features/game/npc-dialog/` →
`JobsService.learn(playerId, jobId)`, `jobId` étant le premier argument. La
règle des slots vit dans `jobs.service.ts`, pure et testée ;
`jobs.specialization_of` (= `J.s` du bundle) sépare les deux familles.

## Quels PNJ sont réellement atteignables

Une réponse doit passer **deux** filtres pour être cliquable, et le second
avait été oublié dans une première version de ce relevé :

1. toutes ses actions doivent être implémentées, sinon le serveur la grise
   (`NpcDialogService.classify`) ;
2. elle et sa question doivent avoir un texte dans le bundle 1.29, sinon le
   client la jette (« has no bundle text — dropping it ») ou affiche une
   bulle vide — c'est QA-142.

Relevé en marchant l'arbre de chaque PNJ sous ces deux contraintes :

| Métier | PNJ le plus proche | Position |
|---|---|---|
| Bijoutier | Shani Sings | [5,-16] |
| Boucher | Saketsu | [0,-15] |
| Boulanger | Sam Croa | [2,-16] |
| Bûcheron | Agrid Shakoku | [4,8] |
| Cordonnier | Grobid Le Vétéran Kerubim | [3,3] |
| Forgeur d'Epées | Deudoiné | [6,-18] |
| Forgeur de Boucliers | Bouwada | [26,-35] |
| Forgeur de Dagues | Deudoiné | [6,-18] |
| Forgeur de Haches | Deudoiné | [6,-18] |
| Forgeur de Marteaux | Deudoiné | [6,-18] |
| Forgeur de Pelles | Deudoiné | [6,-18] |
| Mineur | Chipo Atufe | [9,-23] |
| Paysan | Farle Ingalsse | [5,6] |
| Poissonnier | Bish Fone | [2,-17] |
| Sculpteur d'Arcs | Abely Bobeule | [3,12] |
| Sculpteur de Baguettes | Otomaï | [-55,15] |
| Sculpteur de Bâtons | Abely Bobeule | [3,12] |

**Alchimiste et Pêcheur n'ont aucun maître joignable** — deux métiers de
récolte. Voir QA-142 : leur question d'apprentissage est orpheline.

**Le piège de la recette.** À l'atelier paysan d'Astrub se tiennent deux PNJ
qui n'enseignent pas : **Louse Degraine** [5,-23], dont l'unique réponse lance
une quête (action 40) et que le serveur grise à juste titre, et **Emia
Elliesol** [7,-25], dont la branche d'apprentissage mène à une question que le
client 1.29 ne sait pas afficher. Un testeur qui s'arrête devant l'un des deux
conclura que l'apprentissage est cassé : la recette doit nommer un PNJ de la
table ci-dessus, et pour Paysan c'est **Farle Ingalsse [5,6]**.

## Vérification

Un test de service couvre : apprentissage nominal, métier déjà connu,
quatrième métier refusé, quatrième métier accepté quand les trois précédents
sont au niveau 30, et la même règle pour les spécialisations.

En jeu : parler à **Oli Venders [2,-21]**, choisir « Apprendre le métier de
Bûcheron », le panneau Métiers l'affiche au niveau 1. **Pas** Louse Degraine
[5,-23], qui donne une quête et reste grisée.
