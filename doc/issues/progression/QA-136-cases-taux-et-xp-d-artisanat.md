---
id: QA-136
title: Cases de craft, taux de réussite et expérience d'artisanat n'existent pas
severity: P1
domain: progression
type: gap
status: fixed
session: 6
opened: 2026-08-31
closed:
fixed_in:
related: [QA-129, QA-135, QA-137]
files:
  - apps/gameserver-ts/src/core/modules/jobs
  - proto/misc.proto
---

## Symptôme

Rien ne dit combien de cases un artisan possède, quelle est sa chance de
réussite, ni combien d'expérience une fabrication rapporte. `JobSkillEntry`
transporte pourtant déjà la valeur que le client attend
(`param1`, le nombre de cases — voir QA-131), et le client s'en sert :
`Job.initialize` filtre les recettes sur `craft.itemsCount <= skill.param1` et
`Craft.difficulty` en dérive la couleur de la ligne.

## Attendu (1.29)

Le nombre de cases n'augmente pas d'une par dizaine, mais aux paliers 10, 20,
40, 60, 80 et 100 :

| Niveau métier | 1 | 10 | 20 | 40 | 60 | 80 | 100 |
|---|---|---|---|---|---|---|---|
| Cases max | 2 | 3 | 4 | 5 | 6 | 7 | 8 |

L'expérience dépend du nombre de cases de la recette, pas du niveau :
1 case → 1, 2 → 10, 3 → 25, 4 → 50, 5 → 100, 6 → 250, 7 → 500, 8 → 1 000. Et
**on ne gagne d'expérience que si `nb_cases >= max_cases - 3`** : en dessous, la
recette est grise et ne rapporte rien.

Une recette de `max_cases - 2` cases ou moins réussit toujours (affichée 99 %).
Au-dessus, le taux de base va de 50 % au niveau 1 à 99 % au niveau 100. Les
ingrédients sont consommés à chaque tentative et **l'expérience est donnée même
en cas d'échec**.

Un passage de niveau en cours de session ne change ni les cases ni le taux tant
que la fenêtre n'a pas été fermée et rouverte.

Exceptions nommées : le décorticage du Paysan réussit toujours ; le polissage du
Mineur se débloque au niveau 40.

## Cause

Aucune implémentation. Les scripts Lua de StarLoco donnent bien un
`ingredientsForCraftJob` mais il calcule `niveau/20 + 4`, soit 5 cases au
niveau 20 là où le 1.29 en donne 4 : ce n'est pas la règle canonique et il ne
sert pas de source.

## Correctif

`modules/jobs/craft.rules.ts`, pur, et son `.spec.ts`. Les tableaux ci-dessus y
sont écrits une fois, documentés comme venant de la référence 1.29 et non du
dump — c'est la seule règle du chantier métiers qui n'a pas de source amont, et
elle est nommée comme telle.

Le taux de base reprend en revanche la formule de StarLoco, qui est cohérente
avec le 1.29 : `50` sous le niveau 10, `99` au niveau 100, sinon
`54 + (niveau / 10 - 1) × 5`.

## Vérification

Le `.spec.ts` couvre chaque palier de cases, chaque valeur d'expérience, la
frontière `max_cases - 3` (dont le cas gris à zéro), le plancher et le plafond
du taux, et les deux exceptions. Le taux et les cases sont figés à l'ouverture
de la fenêtre : un test le prouve en montant le niveau entre deux fabrications.
