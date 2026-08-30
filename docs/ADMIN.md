# Administration — AGRIM / RIZ BOAGNI

> État réel au 29 août 2026. Décrit ce que fait le code, pas une intention.
> À lire après `ARCHITECTURE.md`, dont ce document applique les règles.

## 1. Où vit l'administration — et pourquoi à deux endroits

La question qui gouverne tout le reste : **faut-il un panneau d'administration
unique ?**

La réponse est non, et ce n'est pas un renoncement. `ARCHITECTURE.md` pose une
règle : *une donnée, un propriétaire, un seul écrivain*. L'administration
suit cette règle plutôt que de la contourner. Un troisième back-office qui
écrirait dans les deux bases recréerait exactement la divergence que le
PROMPT 1 a passé son temps à supprimer.

| Domaine administré | Où | Interface |
| --- | --- | --- |
| Catalogue, gammes, formats, prix, promotions, galerie | **SITE** | back-office web (`frontend/admin.html`) |
| Avis, clients web, factures, documents, sauvegardes, paramètres | **SITE** | idem |
| Notifications SMS/WhatsApp, journal d'audit global | **SITE** | idem |
| Commandes mobiles, file de préparation | **APPLICATION** | espace gestion (Expo) |
| Stock de l'application, mouvements | **APPLICATION** | espace gestion |
| Livraisons, affectation, clôture d'exception | **APPLICATION** | espace gestion |
| Récoltes producteurs | **APPLICATION** | espace gestion |
| Indicateurs consolidés | **APPLICATION** | espace direction |

**Le catalogue ne se modifie que sur le site.** L'API mobile n'expose aucune
route d'écriture de produit — ni `POST`, ni `PUT`, ni `DELETE`. Ce n'est pas
un manque : c'est la garantie qu'un prix ne peut pas diverger. La copie locale
est rafraîchie toutes les 15 minutes et relue au checkout.

Le chemin décrit dans l'énoncé est donc bien respecté, à ceci près que
l'« ADMIN » n'est pas un logiciel unique :

```
ADMIN (site) ──► API FastAPI ──► PostgreSQL du site
                                        │
                                        │  /api/integration/catalogue
                                        ▼
ADMIN (app) ──► API NestJS ──► PostgreSQL de l'app ──► SITE + APPLICATION
```

---

## 2. Le back-office du site

13 vues, servies par `frontend/admin.html` (+ `admin-catalogue.js`,
`admin-avis.js`), branchées sur **48 endpoints réels**.

| Vue | Ce qu'elle fait |
| --- | --- |
| `tableau` | indicateurs, courbe de ventes |
| `produits` | gammes, variantes, prix, images, promotions, import/export |
| `stock` | consultation, ajustement, alertes |
| `commandes` | file, détail, statut, affectation d'un livreur, facture |
| `clients` | fichier client web |
| `equipe` | comptes du personnel et rôles |
| `avis` | modération, mise en avant, suppression |
| `notifications` | journal des envois, renvoi |
| `journal` | audit : acteur, action, IP, date |
| `statistiques` | export mensuel |
| `documents` | pièces (bons de transport, attestations) |
| `maintenance` | sauvegardes, restauration, paramètres |
| `matournee` | tableau du livreur |

**Vérification faite** : chaque endpoint appelé par le panneau existe
réellement côté serveur. La comparaison des 48 chemins appelés avec les 128
routes déclarées ne laisse **aucun appel orphelin**. Pas de bouton mort au
niveau du routage.

L'autorisation repose sur une matrice de 60 permissions nommées
(`backend/app/permissions.py`), dont l'intégrité est vérifiée **au
démarrage** : une permission qui oublierait l'administrateur empêche le
serveur de démarrer. Le panneau cache les boutons auxquels le compte n'a pas
droit, mais chaque route revérifie — cacher un bouton n'est qu'un confort.

---

## 3. L'espace gestion de l'application

`apps/mobile/app/gestion/` — quatre écrans, réservés à `GESTIONNAIRE`,
`ADMIN` et `DG` par `RolesGuard`, côté serveur.

| Écran | Endpoints |
| --- | --- |
| `index` — file de travail | `GET /management/dashboard`, `GET /management/orders`, `PATCH /management/orders/:reference/status` |
| `[reference]` — détail | `GET /management/orders/:reference`, `POST /deliveries/orders/:reference/assign`, `POST /deliveries/orders/:reference/close` |
| `stocks` | `GET /management/stock`, `PATCH /management/stock/:variantId`, `GET /management/stock/:variantId/movements` |
| `recoltes` | `GET /producers/productions/review`, `PATCH /producers/productions/:id/review` |

### 3.1 Le tableau de bord

Entièrement agrégé depuis PostgreSQL — **aucune valeur codée en dur**.
Treize indicateurs, dont sept ajoutés à cette étape :

| Indicateur | Source |
| --- | --- |
| Chiffre d'affaires du jour | `SUM(total)` hors commandes annulées |
| Commandes du jour | `COUNT` sur `createdAt ≥ minuit` |
| Répartition par statut (7 valeurs) | **une seule** `groupBy(status)` |
| Livraisons en cours | `COUNT` hors `DELIVERED`/`FAILED`/`UNASSIGNED` |
| Clients | `COUNT` des comptes `CLIENT` actifs |
| Produits | `COUNT` des produits actifs |
| Ruptures / stocks faibles | comparaison au seuil **propre à chaque variante** |
| Livreurs : total / occupés / **disponibles** | charge en cours, par livreur |
| Commandes en attente trop longtemps | `PENDING` de plus de 60 minutes |

Deux partis pris de performance :

- La répartition par statut est **une** agrégation, pas sept comptages.
- Le comptage des stocks faibles se fait en mémoire : Prisma ne sait pas
  comparer deux colonnes entre elles, et le catalogue tient en quelques
  dizaines de lignes. À repasser en SQL brut le jour où il en compterait des
  milliers — c'est écrit dans le code, à l'endroit concerné.

**Compatibilité** : les nouveaux blocs (`orders`, `catalog`, `customers`,
`couriers`) sont **facultatifs** dans le schéma Zod partagé. L'application et
l'API ne se déploient pas à la même seconde, et un champ manquant ne doit pas
faire échouer la validation de tout le tableau : six chiffres sur treize
restent utiles, un écran vide non.

---

## 4. Le stock — journal des mouvements

C'est le manque le plus grave que cette étape corrige.

### 4.1 Ce qui n'allait pas

Le stock était **un simple compteur**. On lisait « 148 » sans pouvoir dire si
c'était 150 moins deux ventes ou 200 moins une erreur de saisie. Un écart
d'inventaire n'était ni explicable ni imputable, et une correction ne laissait
aucune trace.

Pire, `adjustStock` lisait la quantité, vérifiait `stock + delta ≥ 0`, puis
incrémentait **sans revérifier**. Deux retraits simultanés passaient tous deux
le contrôle : le compteur pouvait tomber **sous zéro**. Aucune contrainte
`CHECK` en base ne l'en empêchait.

### 4.2 Le modèle

`StockMovement` — une ligne par variation, sans exception.

| Colonne | Rôle |
| --- | --- |
| `variantId` | la variante (le produit se lit par jointure) |
| `type` | `ENTREE` · `SORTIE` · `AJUSTEMENT` · `COMMANDE` · `ANNULATION` · `RETOUR` |
| `quantity` | variation **signée** : `+50`, `−2`. Jamais zéro |
| `stockBefore` / `stockAfter` | l'état avant et après |
| `reason` | motif libre — **obligatoire** pour un `AJUSTEMENT` |
| `reference` | référence de commande, quand le mouvement en découle |
| `actorId` | auteur, ou `null` pour un mouvement du système |
| `createdAt` | date |

`stockBefore`/`stockAfter` sont conservés bien qu'ils soient recalculables :
ils figent ce que le système **croyait** au moment du geste, et un
enchaînement rompu entre deux lignes signale une écriture qui a échappé au
journal. C'est la propriété qui rend l'historique auditable.

### 4.3 Le point de passage unique

`common/stock/stock-movement.ts` — `applyStockChange()`. Toute variation y
passe. Deux garanties, qui ne valent que prises ensemble :

1. **Le journal ne peut pas diverger du compteur** : les deux écritures
   vivent dans la même fonction et la même transaction.
2. **Le stock ne peut pas devenir négatif** : la condition `stock >= -delta`
   est dans le `WHERE`. C'est PostgreSQL qui arbitre, pas une lecture
   antérieure.

Les quatre chemins qui touchent au stock :

| Chemin | Type | Auteur |
| --- | --- | --- |
| `ManagementService.adjustStock` | `ENTREE` / `SORTIE` / `AJUSTEMENT` / `RETOUR` | le gestionnaire, depuis son jeton |
| `OrdersService.create` | `COMMANDE` | aucun — c'est le parcours d'achat |
| `cancelOrderAndReleaseStock` (client) | `ANNULATION` | le client |
| `cancelOrderAndReleaseStock` (bureau / paiement) | `ANNULATION` | le gestionnaire, ou aucun |

**L'auteur vient toujours du jeton, jamais du corps de la requête** : c'est ce
qui rend le journal opposable. Et l'absence d'auteur n'est jamais comblée par
défaut — « système » est la vérité pour une expiration de paiement.

`COMMANDE` et `ANNULATION` sont **refusés** à la saisie manuelle
(`MANUAL_STOCK_MOVEMENT_TYPES`) : les proposer permettrait de maquiller une
démarque en vente.

### 4.4 `RETOUR` n'a pas encore d'appelant automatique

Le type existe et se saisit à la main, mais aucun chemin ne l'écrit seul. Un
échec de livraison ramène aujourd'hui la commande à `READY` **sans** rendre le
stock — ce qui est juste : la marchandise repart au client à la tentative
suivante, elle n'est jamais retournée en rayon. Le jour où un vrai retour
client existera, c'est ici qu'il se branchera.

---

## 5. Commandes et livraisons

Les règles n'ont pas changé à cette étape ; elles étaient déjà correctes.

**Transitions de commande** : la machine à états vit dans
`@agrim/contracts` et le backend la fait respecter. `LIVREE → EN_PREPARATION`
est refusé (`INVALID_ORDER_TRANSITION`). Le gestionnaire pilote jusqu'à
`READY` ; `OUT_FOR_DELIVERY` et `DELIVERED` sont produits par la course
elle-même — les poser à la main ferait mentir le suivi client.

**Double affectation** : impossible. `Delivery.orderId` est `@unique`, et
l'affectation est un `updateMany` filtré sur les statuts réassignables
(`UNASSIGNED`, `ASSIGNED`, `FAILED`). Deux gestionnaires simultanés : un seul
gagne, l'autre reçoit `DELIVERY_ALREADY_STARTED`. La protection est en base,
pas dans l'écran.

**Clôture d'une livraison** : personne ne peut écrire `DELIVERED` à la main.
Le livreur saisit le code dicté par le client, le backend vérifie l'empreinte.
La voie d'exception (`MANAGER_OVERRIDE`) exige un motif, enregistre son
auteur, et est comptée à part.

---

## 6. Rôles et permissions

Voir `AUTHORIZATION.md` pour le détail et la comparaison des deux
plateformes. En résumé côté application :

| Rôle | Espace |
| --- | --- |
| `CLIENT` | ses commandes, ses adresses, ses avis |
| `LIVREUR` | ses livraisons uniquement |
| `PRODUCTEUR` | ses parcelles et ses déclarations |
| `GESTIONNAIRE` | file de travail, stock, affectation |
| `ADMIN` | idem + synchronisation du catalogue |
| `DG` | idem + indicateurs consolidés |

Le garde est **global** : une route sans annotation est protégée, et
l'ouverture est explicite (`@Public`). Un oubli **ferme** l'accès au lieu de
l'ouvrir.

---

## 7. Journal d'audit

L'étape 16 demandait un journal des actions sensibles. Il existe, mais
**réparti par nature** plutôt que dans une table fourre-tout :

| Action sensible | Où elle est tracée |
| --- | --- |
| Changement de statut d'une commande | `OrderEvent` — statut, auteur, commentaire, date |
| Mouvement de stock | `StockMovement` — avant/après, type, motif, auteur |
| Affectation d'une livraison | `Delivery.courierId` + `assignedAt` |
| Clôture d'exception | `Delivery.closedById`, `closureReason`, `closureMode` |
| Échec de livraison | `OrderEvent` (le motif y survit à une réaffectation) |
| Création / modification produit, prix, rôles, comptes | **table `journal` du site** (acteur, action, IP) |

**Aucune table d'audit générique n'a été créée côté application**, et c'est
délibéré : les actions que l'API mobile sait faire sont toutes déjà tracées
là où elles ont un sens. Une table de plus, qu'aucun chemin n'écrirait,
donnerait l'illusion d'un audit sans en fournir un.

Ce qui manque réellement : l'adresse IP n'est pas conservée côté application
(le site, lui, la garde). À trancher — c'est une donnée personnelle.

---

## 8. Données de démonstration

Le seed (`prisma/seed.ts`) crée six comptes de développement, mot de passe
commun, et un catalogue d'amorçage. **Ils ne doivent jamais être seedés en
production** — le README le dit déjà.

Le catalogue d'amorçage est neutralisé par la synchronisation : toute
variante sans `sourceRef` que le site ne confirme pas est **désactivée** au
premier passage (`catalog-sync.service.ts`, étape 3). C'est ce qui a fait
disparaître les onze références fantômes relevées au PROMPT 1.

Aucune statistique du tableau de bord n'est simulée.

---

## 9. Tests

| Suite | Ce qu'elle garde | Tests |
| --- | --- | --- |
| `common/stock/stock-movement.spec.ts` | apports, retraits, refus, **stock jamais négatif sous concurrence**, enchaînement des lignes | 9 |
| `common/stock/order-stock.spec.ts` | restitution unique, journal de l'annulation, auteur | 8 |
| `management/adjust-stock.spec.ts` | journal avec auteur, motif obligatoire, refus, **deux retraits simultanés** | 9 |
| `payments/payments.reconcile.spec.ts` | restitution par expiration, sans double compte | 7 |
| `catalog-sync.service.spec.ts` | catalogue du site, garde-fous, disponibilité | 30 |
| `__tests__/stocks.screen.test.tsx` (mobile) | apport, retrait, correction avec motif, refus | 14 |

Le faux Prisma est **partagé** (`common/stock/stock-tx.fake.ts`) : il évalue
réellement les clauses `WHERE` et tient les quantités à jour. Des `jest.fn()`
à retour figé ne prouveraient rien d'une course — ils prouveraient seulement
qu'on les a appelés.

---

## 10. Procédures sensibles

1. **Corriger un prix** → back-office du site, jamais dans l'application. La
   synchronisation suivante propage.
2. **Retirer un produit de la vente sans toucher au stock** → `disponibilité :
   rupture` sur le site. L'application le respecte depuis le PROMPT 1.
3. **Corriger un inventaire** → espace gestion, « Correction », motif
   obligatoire. La ligne reste au journal avec le nom du gestionnaire.
4. **Annuler une commande partie en livraison** → impossible depuis un écran.
   La sortie se fait par le terrain : le livreur clôt la course en échec.
5. **Migration de schéma** → `prisma migrate`, jamais d'écriture directe.

---

## 11. Ce qui n'est PAS fait

Dit clairement, pour que personne ne le découvre en production.

| # | Sujet | État |
| --- | --- | --- |
| 1 | **Vérification de bout en bout en base réelle** | **NON FAIT** — `DATABASE_URL` périmé, ni PostgreSQL local ni Docker sur ce poste. La migration `20260829000000_stock_movement_journal` est **écrite et validée hors ligne, jamais appliquée**. |
| 2 | Les 13 suites e2e de l'API | **NON EXÉCUTÉES** — même cause. |
| 3 | Consultation de l'historique de stock dans l'écran mobile | **PARTIEL** — l'endpoint et le hook `useStockMovements` existent et sont typés ; aucun écran ne les affiche encore. |
| 4 | Gestion des livreurs (création, modification, désactivation) | **ABSENT** de l'API mobile. Les comptes se gèrent dans la vue `equipe` du site. |
| 5 | Fiche client dans l'application | **ABSENT** — `GET /management/orders` montre nom et téléphone ; il n'y a pas d'écran client. Le fichier client web est sur le site. |
| 6 | Adresse IP dans le journal | **ABSENT** côté application. |
| 7 | `RETOUR` automatique | Aucun appelant (voir §4.4). |
| 8 | Contraintes `CHECK` en base côté application | **ABSENT** — l'intégrité du stock repose sur `applyStockChange`. Le site, lui, a des `CHECK`. À ajouter dans une migration ultérieure. |
