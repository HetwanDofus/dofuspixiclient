# Sprint 05 — L'artisanat : l'atelier, par-dessus deux socles déjà posés

**Objectif** — rendre les 2 296 recettes du référentiel fabricables, en
posant le dernier type d'échange dont tous les métiers d'équipement dépendent.

**Pourquoi maintenant** — S04 a rempli le référentiel et ouvert le robinet des
ressources : un joueur peut couper du bois et ne peut rien en faire. Les
2 296 recettes et les 33 compétences de craft sont en base depuis la fin de
S04 et **aucune n'est atteignable**, parce que `EXCHANGE_CRAFT = 3` tombe dans
`refuseRequest("unsupported-type")`.

**Pourquoi c'est petit** — les deux moitiés du travail existent déjà. Le socle
d'échange (S02) donne la session, le verrou d'occupation, la sérialisation et
le transfert d'état au redémarrage ; `EMO` et `EK` sont déjà routés et le
client 1.29 fabrique **avec ces deux messages-là** — `Craft.as:379` envoie un
`EK` quand on clique « Créer ». Ce sprint branche un flux de plus à côté de
`StorageFlow` et `TradeFlow`, et écrit la seule chose qui n'existe nulle part :
les cases, le taux et l'XP.

**Fini quand** — le runbook en fin de document passe intégralement.

---

## Hors périmètre — explicitement

- **Le craft coopératif et le craft sécurisé** (QA-138, types 12 et 13). Ils
  supposent deux sessions liées, ce que `TradeFlow` sait faire et ce que ce
  sprint n'a pas besoin de refaire.
- **Le livre des artisans et les options de métier** (QA-139).
- **L'oubli d'un métier** (QA-140) et **le Chasseur** (QA-141).
- **La forgemagie.** Les 15 compétences `f` sont importées et rien ne les lit.
- **Le décrafting** (`Decraft`) et le broyage : autre fenêtre, autre fiche.
- **La recette du hasard.** Le taux d'échec est appliqué, la fabrication d'un
  objet *différent* de celui visé (le « oops », `Ec` code `O`) ne l'est pas :
  1.29 ne la déclenche que sur la forgemagie.

---

## Lot A — La règle

En premier parce que c'est la seule partie du chantier qui n'a **aucune source
amont**, et que le flux et la fenêtre en dépendent tous les deux.

| # | Issue | Ce qui change | Ordre de grandeur |
|---|---|---|---|
| A1 | [QA-136](../issues/progression/QA-136-cases-taux-et-xp-d-artisanat.md) | `craft.rules.ts` : cases, taux, XP par nombre de cases | 1 jour |

**Le point d'attention du lot.** Les scripts Lua de StarLoco, qui ont fourni
toute la table de récolte de S04, sont ici à écarter : leur
`ingredientsForCraftJob` calcule `niveau / 20 + 4`, soit **cinq cases au
niveau 20 là où le 1.29 en donne quatre**. La référence est le tableau des
paliers 10/20/40/60/80/100. C'est la seule règle du chantier métiers écrite
sans source de données, et elle est nommée comme telle dans la fiche et dans
le fichier.

## Lot B — Le flux

| # | Issue | Ce qui change | Ordre de grandeur |
|---|---|---|---|
| B1 | [QA-135](../issues/exchange/QA-135-aucun-atelier.md) | `craft.flow.ts`, ouvert depuis l'objet interactif ; `EMO`, `EK`, `Ec`, la série | 3–4 jours |

**Ce que B1 ne doit pas faire** — inventer un message. Le client 1.29 pose ses
ingrédients avec `EMO`, déclenche la fabrication avec `EK` et lit le résultat
dans `Ec` ; les trois sont typés et deux sont déjà routés. Un flux qui aurait
besoin d'un quatrième message serait un flux qui a mal lu `Craft.as`.

**Les ingrédients sont consommés à chaque tentative, réussite ou échec, et
l'XP est donnée dans les deux cas.** C'est contre-intuitif et c'est le 1.29 ;
le test qui le prouve est ce qui empêchera quelqu'un de « corriger » ça plus
tard.

## Lot C — La fenêtre

| # | Issue | Ce qui change | Ordre de grandeur |
|---|---|---|---|
| C1 | [QA-137](../issues/hud-panels/QA-137-pas-de-fenetre-d-atelier.md) | `CraftWindow.tsx` : deux grilles, la prévisualisation, la série | 2 jours |

Rien à dessiner de neuf : `StorageWindow.tsx` donne la double grille pilotée
par le serveur, `TradeOfferPanel.tsx` la grille à nombre de cases fixe, et
`ItemGrid.tsx` fait les deux. Comme la banque, la fenêtre sort de la rotation
à panneau unique — ouvrir un atelier ne doit pas fermer l'inventaire.

---

## Runbook

À exécuter à la main, dans l'ordre, par quelqu'un qui n'a pas écrit le code.

### Préparation

```bash
just db && just import-world game.sql
SPAWN_MAP_ID=7365 just db-seed
just dev
```

Se connecter (`dev` / `dev`). Apprendre le métier de **Bûcheron** auprès d'un
maître (S04, étape 3) et récolter jusqu'au niveau 1 minimum — la scie a besoin
du métier, pas d'un niveau.

---

### 1 · La règle tient — A1

```bash
cd apps/gameserver-ts && bun test src/core/modules/jobs/
```

**Attendu** — chaque palier de cases (2 à 1, 3 à 10, 4 à 20, 5 à 40, 6 à 60,
7 à 80, 8 à 100), chaque valeur d'XP (1/10/25/50/100/250/500/1000), la
frontière `max_cases - 3` avec son cas gris à zéro, et le taux à ses deux
bouts (50 sous 10, 99 au 100).

**Échec si** — le niveau 20 donne cinq cases. C'est la valeur de StarLoco, et
elle n'est pas celle du 1.29.

---

### 2 · Ouvrir l'atelier — B1

**Gestes** — aller devant une scie de Bûcheron (un objet interactif de type 2),
cliquer, choisir « Scier ».

**Attendu** — une fenêtre s'ouvre : l'inventaire d'un côté, les cases de la
recette de l'autre, le nombre de cases correspondant au niveau du métier.

**Échec si** — rien ne s'ouvre. C'est l'état actuel : la compétence arrive au
serveur et `InteractiveObjectsService` la journalise comme non implémentée.

**Le cas à ne pas oublier** — ouvrir l'inventaire (`i`) **avant** l'atelier.
L'inventaire ne doit pas se fermer.

---

### 3 · Fabriquer — B1

**Gestes** — poser les ingrédients d'une recette connue, cliquer « Créer ».

**Attendu** — les ingrédients disparaissent, l'objet apparaît, la jauge du
métier monte. Recommencer jusqu'à un échec.

**Attendu à l'échec** — les ingrédients disparaissent **quand même**, l'objet
n'apparaît pas, et la jauge monte **quand même**. C'est le 1.29.

**Échec si** — un échec rend les ingrédients. Ce serait plus gentil et ce
serait faux.

---

### 4 · Les couleurs — A1, C1

**Gestes** — regarder la liste des recettes d'un métier au niveau 1, puis au
niveau 40.

**Attendu** — une recette à `max_cases - 2` cases ou moins s'affiche à 99 % ;
une à moins de `max_cases - 3` est grise et ne rapporte rien.

**Le relevé qui compte** — fabriquer une recette grise et vérifier en base que
`player_jobs.experience` n'a pas bougé.

---

### 5 · Le palier ne bouge pas fenêtre ouverte — A1, B1

**Gestes** — atelier ouvert, monter le métier d'un palier (40, par exemple) en
fabriquant. Sans fermer la fenêtre, regarder le nombre de cases.

**Attendu** — il ne change pas. Fermer, rouvrir : il a changé.

**Échec si** — une case apparaît en cours de session. C'est le comportement
1.29 que ce sprint s'engage à reproduire, et la raison de l'astuce de pile
(enchaîner les crafts 2 cases juste avant 60).

---

### 6 · La série — B1

**Gestes** — lancer une fabrication en série de dix, puis l'interrompre.

**Attendu** — elle s'arrête, et le compte fabriqué correspond à ce qui est
entré en inventaire. Elle s'arrête toute seule quand les ingrédients manquent.

---

### 7 · Le double-clic et la déconnexion — B1

**Gestes** — double-cliquer « Créer » aussi vite que possible. Puis, atelier
ouvert, fermer brutalement l'onglet et se reconnecter.

**Attendu** — une seule fabrication par clic ; à la reconnexion, l'atelier est
libéré et se rouvre du premier coup.

**La vérification en base** — aucune ligne de `items` avec `quantity <= 0`.

---

### 8 · Non-régression avant clôture

1. La liste complète du runbook de S04, étapes 1 à 11.
2. Banque, échange entre joueurs, hôtel de vente : les trois autres types
   d'échange passent par le même socle et ce sprint y touche.

```bash
cd apps/gameserver-ts && bun test src/ && bun run test:integration && bun run typecheck && bun run lint
cd ../electrobun     && bun test && bun run check-types && bun run lint
cd ../..             && just issues-check
```

## À faire à la clôture

Passer QA-135, QA-136 et QA-137 en `fixed`, renseigner leur `fixed_in`, puis
`just issues`.

Le sprint suivant est S06 : QA-138 (coopération), QA-139 (livre des artisans),
QA-140 (oubli) et QA-141 (Chasseur).
