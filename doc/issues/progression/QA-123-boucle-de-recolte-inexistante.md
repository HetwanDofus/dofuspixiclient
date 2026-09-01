---
id: QA-123
title: La boucle de récolte n'existe pas de bout en bout
severity: P1
domain: progression
type: gap
status: fixed
session: 5
opened: 2026-08-28
closed:
fixed_in:
related: [QA-085, QA-129, QA-130, QA-131, QA-132, QA-133, QA-134]
files:
  - apps/gameserver-ts/migrations/0011_progression.ts
  - apps/gameserver-ts/src/core/modules/interactive-objects/interactive-objects.service.ts
  - apps/gameserver-ts/src/core/modules/interactive-objects/interactive-objects.constants.ts
  - apps/electrobun/src/game/types/interactive.ts
  - apps/electrobun/src/game/scene/battlefield/picking.ts
  - packages/dofus-lang/src/schemas/extended.ts
  - proto/game.proto
  - proto/misc.proto
---

## Symptôme

Un personnage placé devant une ressource ne peut pas la récolter.

- Le menu client désactive toute compétence interactive autre que `84`
  (entrer), `104` (ouvrir un stockage) et `114` (utiliser un zaap).
- Si une compétence de récolte parvient tout de même au serveur,
  `InteractiveObjectsService.use` écrit
  `interactive-use: skill=<id> ... not implemented` puis ne produit aucun
  résultat.
- Les tables `jobs`, `player_jobs`, `job_skills` et
  `job_gatherable_cells` existent depuis la migration 0011, mais aucune
  commande d'import ni aucun service applicatif ne les alimente ou ne les
  consomme.
- Les messages `JobSkills`, `JobXP` et `JobLevel` existent dans le protobuf,
  mais aucun producteur du serveur ne les émet.

Les données publiques déjà livrées au client contiennent **39 métiers**,
**147 compétences**, **62 modèles d'objets interactifs de type ressource** et
**53 compétences de récolte** reliant un métier à une ressource. Par exemple,
la compétence 6 relie Bûcheron, Frêne et l'objet 303 « Bois de Frêne ». Le
contenu nécessaire existe donc, mais il n'est pas transformé en boucle de jeu.

## Attendu (1.29)

Un personnage possédant le métier, le niveau et l'outil requis peut demander la
récolte d'une ressource visible sur sa carte. Le serveur reste l'autorité :
il valide la demande, réserve la ressource, attend la durée d'action, crédite
l'inventaire et l'expérience métier dans une transaction, rend la ressource
indisponible pour tous, puis la fait réapparaître après son délai.

Deux personnages ne peuvent jamais obtenir la même occurrence. Un déplacement,
une déconnexion, un changement de carte, une entrée en combat ou une capacité
de pods insuffisante interrompt ou refuse l'action sans récompense partielle.

## Cause

QA-085 a introduit le transport générique
`GA;500;<cellId>;<skillId>` et la validation du modèle interactif, mais seuls
les portes, zaaps et stockages ont une branche métier. La migration 0011 et le
protocole des métiers sont des squelettes non raccordés.

Le référentiel est par ailleurs dispersé entre :

- `jobs.json` pour les métiers ;
- `skills.json` pour le lien compétence → métier → objet interactif → objet
  récolté ;
- `interactiveobjects.json` pour le type, les compétences et les durées ;
- les cellules décodées de `maps.cells` pour les occurrences placées.

## Correctif

### 1. Importer un référentiel idempotent

Ajouter une étape à `just import-world` qui remplit ou remplace de façon
idempotente :

- `jobs` depuis le bundle des métiers ;
- `job_skills` depuis les compétences dont le métier et l'objet interactif
  désignent une récolte ;
- `job_gatherable_cells` depuis les cellules dont le second calque est
  interactif et référence un modèle de type `Resource`.

L'import doit résoudre et vérifier explicitement l'identifiant de l'objet
gagné, le niveau minimal, l'outil, les quantités, la durée et le délai de
réapparition. Quand la source 1.29 ne permet pas de déduire une valeur, la règle
de repli doit être nommée, documentée et testée : aucune constante silencieuse
dans le service d'exécution.

### 2. Modéliser l'état d'une occurrence

Conserver pour chaque `(map_id, cell_id)` au minimum son instant de prochaine
disponibilité et l'éventuelle réservation en cours. La prise de réservation
doit être atomique dans PostgreSQL afin de rester correcte avec plusieurs
processus serveur.

Une réservation abandonnée doit expirer. Un redémarrage du serveur ne doit ni
dupliquer une récompense ni rendre définitivement la ressource indisponible.

> **Divergence assumée avec le §1.** L'état ne vit pas dans
> `job_gatherable_cells` mais dans une table `gatherable_cell_states` séparée,
> de même clé. `job_gatherable_cells` est un référentiel *importé* : le
> confondre avec l'état vivant ferait qu'un ré-import effacerait les
> réapparitions en cours. La prise de réservation est un seul
> `UPDATE … RETURNING` filtrant sur `available_at <= now()`, ce qui est
> l'atomicité demandée ici.

### 3. Implémenter l'action serveur

Introduire un service de récolte appelé par
`InteractiveObjectsService.use` pour les compétences importées. Il doit :

1. recalculer la carte, la cellule, le modèle et la compétence depuis l'état
   serveur ;
2. vérifier proximité, disponibilité, métier appris, niveau, outil équipé,
   état du personnage et pods disponibles ;
3. réserver atomiquement l'occurrence ;
4. annoncer le début et la durée de l'action ;
5. annuler proprement sur interruption ;
6. à l'échéance, ajouter les objets, ajouter l'XP métier et éventuel niveau,
   puis fermer l'action dans une transaction ;
7. diffuser les changements d'inventaire, de métier et de frame interactive ;
8. programmer et diffuser la réapparition.

Tout refus doit terminer l'action et produire une raison exploitable par le
client ; aucune branche ne doit rester silencieuse.

### 4. Raccorder le client joueur

À l'entrée en jeu, envoyer les compétences et l'XP des métiers du personnage.
Le menu d'un objet ressource doit afficher ses compétences et n'activer que
celles autorisées par l'état joueur reçu. Une récolte affiche son action en
cours, la disparition de la ressource, les gains d'inventaire et sa
réapparition à partir des messages serveur ; le client ne simule jamais
localement la réussite.

L'acquisition d'un métier auprès d'un PNJ et l'artisanat restent hors de cette
fiche. Le parcours est validable avec un `player_jobs` existant, créé par une
fixture de test explicite.

## Vérification

- L'import exécuté deux fois produit les mêmes lignes et signale ses comptes
  par source, import, rejet et raison.
- Un test de service couvre succès, ressource occupée, métier absent, niveau
  insuffisant, outil absent, pods pleins et chaque interruption.
- Un test concurrent lance deux récoltes sur la même occurrence : une seule
  transaction crédite une récompense.
- Un test d'intégration websocket observe, dans l'ordre, début d'action,
  indisponibilité, inventaire/XP, fin d'action puis réapparition.
- Après redémarrage pendant le délai de réapparition, la ressource respecte
  encore l'instant persisté.
- En jeu, un personnage Bûcheron récolte un Frêne ; un second personnage voit
  la ressource disparaître puis revenir et ne peut pas la récolter entre-temps.

La fiche ne passe à `closed` qu'après ce dernier parcours manette en main.

## Trouvé en jeu, session 7 — la récolte était invisible

Le premier essai manette en main a donné : le personnage marche jusqu'au
frêne, s'arrête… et rien. La boucle tournait pourtant — `gatherable_cell_states`
portait les réservations prises par le joueur — mais **rien à l'écran ne le
disait**.

Deux manques, tous deux dans cette fiche et tous deux corrigés :

1. **Aucune jauge, aucune animation.** `GA;501` arrivait avec sa durée, le
   store la retenait, et aucun composant ne la dessinait. Douze secondes
   d'immobilité muette, puis du bois qui apparaît sans un mot. `HarvestGauge`
   dessine désormais le décompte au-dessus du personnage, à partir de la durée
   du serveur — jamais recalculée côté client.
2. **Les refus étaient silencieux.** Le §3 de cette fiche l'exigeait
   pourtant : « tout refus doit terminer l'action et produire une raison
   exploitable par le client ; aucune branche ne doit rester silencieuse ».
   Les onze refus partent maintenant en `Im` (`InfoMessage`, typé et sans
   producteur jusqu'ici) et s'affichent dans le chat — « Vous devez équiper
   l'outil du métier », « Vous êtes trop chargé », etc.

**Ce qui n'était pas un défaut** : marcher *sur* la case du frêne plutôt qu'à
côté est le comportement 1.29. `Pathfinding.as:154` n'ouvre une cellule
`movement == 1` que si elle est la case d'arrivée, et une ressource est
précisément une cellule `movement = 1` — voir QA-087, qui note déjà que « le
trajet vers un élément se termine dessus ».

## Trouvé en jeu, session 7 — les puits

Les 41 puits du monde étaient **tous refusés**, chez tous les personnages.
`SK[102]` « Puiser » appartient au métier **1, `-Base-`** — qui n'est pas un
métier : il porte les actions que n'importe qui peut faire, et personne ne
possède jamais de ligne `player_jobs` pour lui. Le service exigeait le métier,
le niveau et l'outil comme pour une ressource ordinaire, et le client grisait
l'entrée pour la même raison.

Corrigé des deux côtés : une compétence de `-Base-` ne demande ni métier, ni
niveau, ni outil — mais toujours de l'énergie et des pods. Côté client, le
serveur envoie désormais les compétences de `-Base-` **à côté** de la liste des
métiers dans `JS` ; c'est la seule façon pour un client de savoir qu'un puits
est utilisable, et les trois compétences sans source (`42` Ramasser, `150`
Jouer, `152` Pêcher KoinKoin) restent grises simplement en n'y figurant pas.
`-Base-` ne rentre pas dans la liste des métiers du joueur : il apparaîtrait
dans le panneau Métiers et compterait pour un emplacement.

Aucune cellule placée n'offre les trois compétences sans source — l'import ne
retient que les modèles dont une compétence est exécutable —, donc rien de
visible dans le monde n'en dépend.
