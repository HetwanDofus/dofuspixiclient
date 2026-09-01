# Sprints

Un sprint est une **passe cohérente sur le jeu**, avec un objectif énoncé, un
ordre d'exécution justifié, et un runbook de recette rédigé pour être exécuté à
la main par un humain.

Un sprint ne décrit **jamais** un défaut : il ordonne des entrées de
[../issues/](../issues/) et dit pourquoi dans cet ordre. Le symptôme, la cause et
le correctif vivent dans la fiche de l'issue, à un seul endroit. Un sprint ne
porte que ce que la fiche ne peut pas porter : la séquence, les dépendances
entre lots, le hors-périmètre, et la recette.

| Sprint | Objectif | État |
|---|---|---|
| [S01](S01-noyau-jouable-securise-scalable.md) | Le noyau : jouable, sécurisé, scalable | à démarrer |
| [S02](S02-echange-socle-et-banque.md) | L'échange : le socle, prouvé par la banque | à démarrer |
| [S03](S03-echange-entre-joueurs.md) | L'échange entre joueurs : deux offres, deux validations, un rollback | à démarrer |
| [S04](S04-metiers-recolte.md) | Les métiers : le référentiel, prouvé par la récolte | terminé |
| [S05](S05-metiers-artisanat.md) | L'artisanat : l'atelier, par-dessus deux socles déjà posés | terminé |
| [S06](S06-metiers-cooperation-et-cycle.md) | Les métiers : la coopération, et fermer le cycle | terminé |

## Écrire un sprint

1. Choisir les issues, les ordonner par dépendance réelle, pas par gravité.
2. Écrire le hors-périmètre **avant** le périmètre — c'est ce qui tient le sprint.
3. Rédiger le runbook en dernier, en couvrant chaque lot par au moins une étape.
   Une tâche du sprint sans étape de recette est une tâche qu'on ne saura pas
   déclarer finie.
4. Le runbook s'adresse à quelqu'un qui n'a pas écrit le code : gestes exacts,
   commandes copiables, et pour chaque étape ce qu'on doit voir — et ce qui
   signe l'échec.
