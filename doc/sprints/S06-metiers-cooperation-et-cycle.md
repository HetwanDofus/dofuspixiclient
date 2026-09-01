# Sprint 06 — Les métiers : la coopération, et fermer le cycle

**Objectif** — rendre un métier réversible, ouvrir l'artisanat aux autres
joueurs, et clore le chantier commencé en S04.

**Pourquoi maintenant** — la récolte tourne (S04) et l'atelier fabrique (S05).
Ce qui manque n'est plus une boucle, c'est ce qui rend les deux vivables : un
métier appris ne peut pas être rendu, donc les trois emplacements se ferment au
premier essai, et un artisan ne peut travailler que pour lui-même — la moitié
de l'intérêt d'un métier d'équipement en 1.29.

**Pourquoi l'oubli d'abord** — c'est la fiche la plus petite et celle qui
débloque la recette de toutes les autres. Tant qu'on ne peut pas oublier un
métier, chaque essai des règles d'emplacement consomme un personnage.

**Fini quand** — le runbook en fin de document passe intégralement.

---

## Hors périmètre — explicitement

- **La forgemagie.** Les 15 compétences `f` sont importées depuis S04 et rien
  ne les lit. C'est un chantier à part entière : runes, jets, taux, et une
  fenêtre qui n'est pas celle de l'atelier.
- **Le décrafting et le broyage.**
- **Les métiers mage** en tant que tels. La règle des emplacements les compte
  déjà (`jobs.rules.ts`) ; ce qu'ils *font* est le chantier forgemagie.

---

## Lot A — Rendre un métier

| # | Issue | Ce qui change | Ordre de grandeur |
|---|---|---|---|
| A1 | [QA-140](../issues/progression/QA-140-on-ne-peut-pas-oublier-un-metier.md) | `JobsService.forget`, la potion d'oubli, `JR` | 1 jour |

**Le point d'attention du lot.** L'oubli et les pods se recettent d'un même
geste : le total maximum doit redescendre exactement de ce que le métier avait
donné (QA-133). Un oubli qui laisse les pods derrière lui est une fuite qui ne
se voit qu'au bout de trois métiers.

## Lot B — Travailler pour les autres

| # | Issue | Ce qui change | Ordre de grandeur |
|---|---|---|---|
| B1 | [QA-138](../issues/exchange/QA-138-craft-cooperatif-et-securise.md) | Les types 12 et 13 : deux sessions, un atelier, un paiement | 3–4 jours |
| B2 | [QA-139](../issues/exchange/QA-139-livre-des-artisans-et-options-metier.md) | Les options de métier (`JO`) et le livre des artisans (type 14) | 2 jours |

**B1 réutilise le patron de QA-107, pas celui de QA-135.** Un craft coopératif
est un échange à deux côtés — une file, pas deux verrous — posé au-dessus du
`CraftFlow` livré en S05 pour la partie fabrication. Ce qui est nouveau est la
double confirmation, le paiement, et la règle qui fait tout l'intérêt du
mécanisme : **l'objet va au client, l'expérience va à l'artisan.**

**B2 après B1** : le livre des artisans ne sert à rien tant qu'on ne peut pas
travailler pour quelqu'un, et ses options (payant, gratuit si échec, fournit
les ressources) décrivent précisément le flux de B1.

## Lot C — Le Chasseur

| # | Issue | Ce qui change | Ordre de grandeur |
|---|---|---|---|
| C1 | [QA-141](../issues/progression/QA-141-le-metier-de-chasseur-n-existe-pas.md) | La table sourcée des 30 paliers et le butin de chasse en fin de combat | 1 jour |

**C1 était le seul lot du chantier métiers sans donnée amont complète.**
`game.sql` portait déjà les 170 couples monstre → viande et leur taux ; le
guide historique DofuX 1.29 a permis de transcrire et sourcer les 30 paliers
restants. Le barème d'expérience et la progression du taux, propres au contrat
de ce projet, restent nommés et testés comme règles dérivées.

---

## Runbook

### 1 · Oublier un métier — A1

**Gestes** — apprendre Bûcheron, le monter de deux ou trois niveaux, relever
les pods maximum, puis boire la potion d'oubli.

**Attendu** — le panneau Métiers ne l'affiche plus, les pods maximum
redescendent **exactement** de `5 × niveau`, et un quatrième métier redevient
possible.

**Échec si** — les pods restent. C'est la fuite décrite plus haut.

### 2 · La règle des trois, jouée pour de bon — A1

**Gestes** — apprendre trois métiers, en tenter un quatrième (refusé), oublier
l'un des trois, retenter le quatrième.

**Attendu** — refusé, puis accepté.

### 3 · Craft coopératif — B1

**Préparation** — deux clients connectés, l'un devant un atelier de son métier.

**Gestes** — l'artisan clique sur le client, « Inviter à Bûcheron » ; le client
accepte ; le client dépose ses ingrédients ; l'artisan fabrique.

**Attendu** — l'objet entre dans l'inventaire du **client**, l'expérience va à
l'**artisan**.

**Échec si** — c'est l'inverse, ou l'un des deux reçoit les deux.

### 4 · Interruptions à deux — B1

**Gestes** — au milieu d'un craft coopératif : l'un des deux ferme brutalement
son onglet.

**Attendu** — les deux côtés se libèrent, aucun objet ne disparaît, et les
ingrédients non consommés restent chez leur propriétaire.

### 5 · Les options et le livre — B2

**Gestes** — activer le mode public, se déconnecter, se reconnecter. Retirer
l'outil.

**Attendu** — le mode retombe dans les deux cas. Un second joueur voit
l'artisan dans la liste de son métier tant qu'il est actif, et plus après.

### 6 · Non-régression avant clôture

Les runbooks de S04 et S05 en entier, puis :

```bash
cd apps/gameserver-ts && bun test src/ && bun run test:integration && bun run typecheck && bun run lint
cd ../electrobun     && bun test && bun run check-types && bun run lint
cd ../..             && just issues-check
```

## À faire à la clôture

QA-138 à QA-141 sont `fixed`. QA-142, découverte pendant la recette des maîtres
de métier, filtre le graphe 1.39 contre les textes 1.29 et rend les 19 métiers
joignables. Le chantier métiers est clos, à l'exception de la forgemagie, qui
a toujours été hors de son périmètre.
