---
id: QA-141
title: Le métier de Chasseur n'existe pas — et ses données non plus
severity: P3
domain: progression
type: feature
status: confirmed
session: 6
opened: 2026-08-31
closed:
fixed_in:
related: [QA-059, QA-060, QA-129]
files:
  - apps/gameserver-ts/src/core/modules/fight
  - apps/gameserver-ts/src/core/modules/jobs
---

## Symptôme

Le Chasseur est le seul métier de récolte sans objet interactif : sa récolte est
un butin de fin de combat. Rien n'existe côté serveur.

**Ce que l'enquête a trouvé, et qui contredit l'hypothèse de départ.** Le
tableau monstre → viande n'est pas absent : il est déjà en base, dans
`monster_drops`, importé avec le reste du contenu.

```sql
select count(*), count(distinct monster_id), count(distinct item_template_id)
  from monster_drops d join item_templates t on t.id = d.item_template_id
 where t.type = 63;   -- 170 | 166 | 30
```

**170 lignes relient 166 monstres à 30 viandes crues**, avec leur taux et leur
quantité. Le métier lui-même est là aussi : `jobs.json` porte le 41
« Chasseur », et `jobs_data` lui donne son outil (l'objet 1934). Un « monstre
animal » se définit donc sans rien inventer : c'est un monstre qui a une ligne
de butin de type 63.

**Ce qui manque vraiment**, et c'est plus étroit que la fiche ne le supposait :

- le **niveau de métier** requis par palier de viande ;
- l'**expérience** gagnée.

Aucune des deux ne se dérive des données. Le niveau de l'objet ne fait pas
l'affaire : sur les 53 compétences de récolte importées, `min_level` et le
niveau de l'objet récolté divergent largement (une compétence de niveau 50
rend un objet de niveau 100). L'approximation `10 + niveau/2`, qui décrit bien
les bois et les minerais, ne tient pas sur les poissons. Et contrairement à la
récolte, il n'existe **aucune implémentation amont à transcrire** : les scripts
Lua de StarLoco ne définissent que cinq métiers de récolte, Chasseur exclu.

## Attendu (1.29)

Arme de chasse équipée — une arme native, ou une arme portant une rune de chasse
posée par un mage —, un combat gagné contre un monstre « animal » autorisé pour
le palier, et le personnage reçoit de la viande crue et de l'expérience de
métier. Le taux dépend du niveau de chasseur face au palier de la viande, sans
atelier.

## Cause

Rien n'est engagé, et la donnée manque.

## Correctif

Deux tiers du travail sont désormais du câblage :

1. « animal » = a une ligne `monster_drops` de type 63 ; la viande, sa
   quantité et son taux sont ceux de cette ligne ;
2. l'accroche se pose dans la distribution de fin de combat, à côté du butin
   (QA-060), et l'outil de chasse se vérifie comme celui de la récolte.

Reste le tiers qui n'a pas de source : **les paliers de niveau et
l'expérience**. Ils demandent une table écrite à la main, committée et
documentée quant à sa provenance — le traitement de
`data/starloco-job-skills.json` (QA-129) — ou une règle dérivée nommée et
testée. La fiche reste ouverte sur ce point précis plutôt que d'expédier des
nombres inventés sous couvert de fidélité.

Le `wontfix` envisagé n'a plus lieu d'être : la donnée qu'on croyait absente
est là, et ce qui manque est identifié.

## Vérification

Un test couvre : sans arme de chasse pas de viande, monstre non animal pas de
viande, et le taux qui varie avec l'écart de niveau. En jeu, gagner un combat
contre un Bouftou avec une arme de chasse donne de la viande et de l'expérience.
