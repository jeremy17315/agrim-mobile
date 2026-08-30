# Audit des fondations techniques — AGRIM / RIZ BOAGNI

> Établi le 28 août 2026, par lecture directe du code des **deux** dépôts.
> Aucun chiffre de ce document n'est estimé : chacun est vérifiable par la
> commande ou le fichier cité.

## Ce qu'il faut savoir avant de lire

Le mot « projet » recouvre ici **deux applications complètes**, dans deux
dépôts séparés, avec **deux bases de données distinctes** :

| | Dépôt | Pile | Base |
| --- | --- | --- | --- |
| **SITE** | `E:\riz-boigni` | FastAPI · Python 3.14 | PostgreSQL en production, **SQLite en développement** |
| **APPLICATION** | `E:\agrim-mobile` | NestJS 11 · Prisma 7 · Expo | PostgreSQL (Neon) |

Ce dépôt-ci (`agrim-mobile`) ne contient **aucune ligne de Python** :

```
$ find . -name "*.py" -not -path "*/node_modules/*" | wc -l
0
```

Le site n'est donc pas « une couche de ce projet » : c'est un autre logiciel,
déployé ailleurs (`https://agrim-zuxe.onrender.com`), que cette API contacte
par HTTP.

---

## 1. État initial

### 1.1 L'application (ce dépôt)

| Mesure | Valeur | Source |
| --- | --- | --- |
| Contrôleurs NestJS | 16 | `apps/api/src/**/*.controller.ts` |
| Routes HTTP | 67 | `@Get/@Post/@Patch/@Put/@Delete` |
| Modèles Prisma | 24 | `prisma/schema.prisma` |
| Migrations | 13 | `prisma/migrations/` |
| Transactions `$transaction` | 14 | code hors tests |
| Suites de tests | 20 | `*.spec.ts` |

Qualité générale : **bonne**. Machines à états vérifiées côté serveur,
validation de livraison par code chiffré, rôles contrôlés à chaque requête,
journal d'audit des transitions (`OrderEvent`), idempotence des commandes
(`idempotencyKey`), réconciliation des paiements abandonnés.

### 1.2 Le site

| Mesure | Valeur | Source |
| --- | --- | --- |
| Lignes de Python | ~15 970 | `backend/app/*.py` |
| Routes HTTP | 145 | `backend/app/main.py` |
| Tables SQL | 21 | `SCHEMA` dans `backend/app/db.py` |
| Suites de tests | 8 | `backend/tests/` |

Le site détient **les vraies données** : le catalogue réel, les vrais clients,
les vraies commandes web, un back office complet (catalogue, promotions,
galerie, avis, factures PDF, journal, sauvegardes, messagerie SMS/WhatsApp).

### 1.3 Le lien existant entre les deux

Trois points d'entrée, protégés par un jeton partagé comparé en temps
constant (`main.py:_verifier_jeton_synchronisation`) :

| Endpoint | Sens | Rôle |
| --- | --- | --- |
| `GET /api/integration/catalogue` | site → app | le catalogue, dont le site est propriétaire |
| `POST /api/integration/prix` | site → app | prix effectifs relus au checkout |
| `POST /api/integration/message` | app → site | relais SMS / WhatsApp mutualisé |

Côté application, `CatalogSyncService` en tient une **copie locale** et la
rafraîchit toutes les 15 minutes.

---

## 2. Les problèmes trouvés

Classés par gravité réelle, pas par facilité de correction.

### P0 — Le stock pouvait être rendu deux fois (CORRIGÉ)

Le stock est décrémenté **une seule fois**, à la création de la commande, par
un décrément conditionnel correct (`stock: { gte: quantité }`). Il était en
revanche **rendu depuis trois endroits** qui peuvent s'exécuter en même temps
sur la même commande :

1. `OrdersService.cancel` — le client annule ;
2. `ManagementService.cancelOrder` — le bureau annule ;
3. `PaymentsService.settle` — le paiement échoue ou expire. Ce chemin est
   déclenché par **deux appelants indépendants** : le webhook du fournisseur
   et le balayage `ReconciliationService`.

Les trois lisaient le statut **avant** d'ouvrir la transaction, puis
incrémentaient sans revérifier. Sous PostgreSQL en `READ COMMITTED` —
l'isolation par défaut, celle qu'emploie Prisma — deux de ces chemins peuvent
lire `PENDING` tous les deux et rendre le stock tous les deux.

Un double-tap sur « Annuler » suffisait. Le webhook arrivant pendant la
réconciliation aussi. **Le rayon gagnait des sacs qui n'existent pas**, et la
survente suivante était garantie.

Le commentaire de `settle()` affirmait l'idempotence (« la relecture du statut
se fait à l'intérieur de la transaction ») : c'est faux en `READ COMMITTED`,
où relire ne verrouille rien.

**Corrigé** — voir §3.1.

### P0 — Le même sac peut être vendu deux fois (STRUCTUREL, non corrigé)

Chaque plateforme tient **son propre compteur de stock**. Le site vend son
dernier sac de Diététique Violet 25 kg pendant que l'application, qui croit en
avoir quarante, en vend aussi. Aucun des deux ne le saura avant la préparation.

Ce n'est pas un oubli : `CatalogSyncService` **refuse délibérément** de
recopier les stocks (règle 1 en tête du fichier), parce que recopier l'un sur
l'autre effacerait des ventes réelles. Le défaut est en amont — il n'y a pas
de propriétaire unique du stock.

Aucune correction n'est possible dans ce seul dépôt : il faut un point
d'entrée de **réservation** côté site. Voir `ARCHITECTURE.md`, phase 2.

### P1 — Une rupture déclarée ne franchissait pas la frontière (CORRIGÉ)

Le back office du site distingue deux refus de vente :

- le **retrait du catalogue** (`actif = 0`) ;
- la **rupture déclarée** (`disponibilite = 'rupture'`) — « il en reste en
  magasin, mais on n'en vend plus » : lot réservé, qualité à vérifier, arrêt
  temporaire. La référence reste active, son stock reste juste.

La boutique du site respecte la seconde : `metier.calculer_panier` refuse la
commande **avant même** de regarder le stock. Mais trois définitions de la
disponibilité coexistaient :

| Endroit | Règle | Verdict |
| --- | --- | --- |
| `metier._enrichir` (référence) | `stock > 0 et non rupture` | correcte |
| `catalogue.catalogue_pour_synchronisation` | `actif et stock > 0` | **ignore la rupture** |
| `catalog-sync.service.ts` | `isAvailable = actif` | **ignore la rupture** |

Conséquence : une référence explicitement retirée de la vente restait vendable
dans l'application. Le site disait non, l'application disait oui.

**Corrigé** — voir §3.2.

### P1 — Course à l'affectation d'une livraison (CORRIGÉ)

`DeliveriesService.assign` vérifiait le statut réassignable **hors
transaction**, puis écrivait sans condition. Deux gestionnaires affectant la
même commande au même instant passaient tous deux le contrôle ; le second
écrasait le premier, et un livreur voyait la course disparaître de sa tournée
sans explication.

**Corrigé** — voir §3.1.

### P1 — Les frais de livraison et les remises divergent

> **Frais de livraison : TRANCHÉ le 29 août 2026 — la grille du SITE fait
> foi.** Décision du propriétaire, prolongeant celle du 24 août sur la grille
> produits. L'application n'a plus aucun tarif en dur : elle lit
> `GET /api/integration/livraison`. Voir `API-CONTRACT.md`.
>
> **Remises volume et grossiste : TOUJOURS EN ATTENTE de validation AGRIM.**
> `A-VALIDER-AVEC-AGRIM.md` liste « Conditions de remise sur volume » parmi
> les cases non cochées. Rien n'a été harmonisé, et c'est délibéré : inventer
> une règle commerciale serait pire que de documenter l'écart. Le site
> applique ses remises (2 sacs de 22,5 kg → −1 000/sac ; 5 cartons de 5 kg →
> −250/sac ; −3 % au-delà de 200 000 F), l'application n'en applique aucune.

Le constat d'origine, conservé pour mémoire — il porte sur l'argent que paie
le client.

| Règle | Site | Application |
| --- | --- | --- |
| Frais de livraison | **par zone** : Yamoussoukro 1 000, Abidjan 3 500, Bouaké 3 000, autre 5 000 | **forfait 1 000** partout |
| Retrait sur place | gratuit, 4 points de retrait | **n'existe pas** |
| Livraison offerte | au **poids** (paramètre `livraison_offerte_seuil_kg`) | au **montant** (25 000 XOF) |
| Remise volume | 2 sacs de 22,5 kg → −1 000/sac ; 5 cartons de 5 kg → −250/sac | **aucune** |
| Remise grossiste | −3 % au-delà de 200 000 XOF | **aucune** |

Sources : `backend/app/config.py` (`ZONES_LIVRAISON`, `REMISES_VOLUME`,
`SEUIL_REMISE_GROSSISTE`) et `packages/contracts/src/company.ts`
(`PROVISIONAL_DELIVERY`), dont le commentaire dit lui-même :
« **PROVISOIRE — règles de livraison non communiquées** ».

Un client d'Abidjan paie **1 000 dans l'application et 3 500 sur le site**
pour la même livraison. Un client qui commande 250 000 XOF perd 7 500 XOF de
remise en passant par l'application.

**Pourquoi ce n'est pas corrigé ici** : aligner l'application sur le site
change le montant réellement encaissé auprès des clients. C'est une décision
commerciale, pas une décision technique — et elle demande en outre de savoir
rattacher une `Address` (champs `city`, `commune`, texte libre) à une zone
tarifaire. Un défaut de rattachement ferait passer un client de 1 000 à
5 000 XOF. Voir §7, décision nº 1.

### P1 — Statuts, rôles et identités ne se recouvrent pas

Voir `STATUS-MODEL.md` et `AUTHORIZATION.md` pour le détail. En résumé :

- **Statuts de commande** : 6 côté site (`en_attente_paiement`, `a_preparer`,
  `en_preparation`, `en_livraison`, `livree`, `annulee`) contre 7 côté
  application (`PENDING`, `CONFIRMED`, `PREPARING`, `READY`,
  `OUT_FOR_DELIVERY`, `DELIVERED`, `CANCELLED`). Aucune valeur commune.
- **Rôles** : 4 côté site (`admin`, `gestionnaire`, `livreur`, `client`, en
  minuscules) contre 6 côté application (`CLIENT`, `LIVREUR`, `PRODUCTEUR`,
  `GESTIONNAIRE`, `ADMIN`, `DG`, en majuscules). `PRODUCTEUR` et `DG`
  n'existent pas côté site.
- **Comptes** : un client inscrit sur le site **ne peut pas** se connecter à
  l'application, et réciproquement. Deux tables (`clients` / `User`), deux
  mécanismes d'authentification, aucun rapprochement — alors que le
  **téléphone est déjà l'identifiant unique des deux côtés**.

### P2 — Le site n'a pas d'idempotence à la création de commande

`POST /api/commandes` (site) crée une commande et décrémente le stock sans
clé d'idempotence. Un rejeu — réseau coupé, client qui retape — crée une
**seconde commande** et décrémente le stock une seconde fois.
L'application, elle, s'en protège (`Order.idempotencyKey @unique`), et son
test `test_commande_et_idempotence` côté site ne couvre que l'unicité de la
référence, pas le rejeu du POST.

### P2 — Le site développe sur SQLite et produit sur PostgreSQL

`backend/app/db.py` porte un schéma écrit **en dialecte SQLite** (`PRAGMA
journal_mode = WAL`, `INTEGER PRIMARY KEY AUTOINCREMENT`, `datetime('now')`,
`actif INTEGER CHECK (actif IN (0,1))`), traduit à la volée par
`dialecte.traduire()` — une conversion **par expressions régulières**, sur
235 requêtes.

Ce choix est explicitement assumé et documenté (réversibilité), et il est
couvert par `test_migration_postgres.py`. Il reste que **le moteur testé en
développement n'est pas celui qui sert les clients**. Toute requête ajoutée
sans passer par les tests PostgreSQL est un risque de panne en production
seulement. `INSERT OR REPLACE` n'a d'ailleurs pas d'équivalent : il est
traduit en `ON CONFLICT DO NOTHING` avec un simple avertissement journalisé.

Non corrigé : réécrire 235 requêtes contre du code qui fonctionne serait
exactement ce que l'étape 14 interdit.

### P2 — Le jeton de session du site est stocké en clair

`securite.py:234` insère `secrets.token_urlsafe(32)` **tel quel** dans
`sessions.token`. Une lecture de la base donne des sessions immédiatement
rejouables. L'application, elle, ne stocke que des empreintes
(`RefreshToken.tokenHash`) et pratique la rotation. Asymétrie de sécurité à
corriger côté site (hachage SHA-256 au repos, comparaison sur l'empreinte).

### P3 — Tables mortes dans le schéma de l'application

`Cart` et `CartItem` sont modélisées, migrées, indexées… et **jamais lues ni
écrites** : le panier vit dans le store Zustand du mobile. Seule occurrence
dans tout le code :

```
auth.service.ts:226:  this.prisma.db.cart.deleteMany({ where: { userId } })
```

Non supprimées : un `DROP TABLE` est irréversible et sans bénéfice immédiat.
Signalées pour que personne ne les croie en service.

### P2 — Quatre fichiers de ce poste sont remplis d'octets nuls

Ce n'est pas un défaut du projet, mais il faut le savoir avant de faire
confiance à ce qui traîne sur ce disque. Quatre fichiers ne contiennent
**que des zéros** sur toute leur longueur (`od -c` → `\0`) :

| Fichier | Ce que c'était |
| --- | --- |
| `apps/api/site-analyse.mjs` | script d'exploration jetable |
| `apps/api/mobile-data.mjs` | idem |
| `apps/mobile/.expo/types/router.d.ts` | types générés par Expo |
| `riz-boigni/backend/app/catalogue.py.bak-audit` | **une sauvegarde de `catalogue.py`** |

Tous ont été écrits juste avant l'arrêt brutal de la session précédente : le
symptôme classique d'un fichier alloué mais jamais vidé sur disque.

**Le dernier est le seul qui compte, et il est piégeux** : c'est une
« sauvegarde » de `catalogue.py` qui ne contient rien. Restaurer depuis ce
fichier détruirait le module du catalogue du site. **À supprimer** — le vrai
filet de sécurité est `git`, pas ce `.bak`.

Vérification faite : **aucun fichier versionné n'est atteint**, dans aucun des
deux dépôts. Le code est intact.

Conséquence secondaire : `tsc --noEmit` côté mobile échoue sur
`.expo/types/router.d.ts` — et **uniquement** sur lui. Zéro erreur dans le
code source. Le fichier se régénère au prochain démarrage d'Expo.

### Ce qui, en revanche, est sain

L'audit doit aussi dire ce qu'il ne faut pas toucher :

- **Création de commande** (`OrdersService.create`) : idempotence, fusion des
  lignes en double, prix relus en base et jamais reçus du client, compteur
  annuel atomique, décrément conditionnel. Rien à reprendre.
- **Validation de livraison par OTP** : code jamais stocké en clair (empreinte
  + chiffré AES-256-GCM pour que son propriétaire le relise), consommation
  atomique (`verifiedAt: null` dans le filtre), tentatives plafonnées,
  invalidation du code précédent à la régénération, livreur qui ne voit jamais
  le code. Exemplaire.
- **Schéma Prisma ↔ migrations** : cohérence vérifiée modèle par modèle et
  colonne par colonne (§4). Zéro écart.
- **Garde-fous de la synchronisation** : ni catalogue vide ni synchronisation
  partielle ne peuvent vider la boutique. Correctement testés.

---

## 3. Les corrections effectuées

### 3.1 Restitution de stock et affectation : un seul gagnant

Nouveau point de passage unique — `apps/api/src/common/stock/order-stock.ts` :

```ts
const claimed = await tx.order.updateMany({
  where: { id: orderId, status: { in: [...STOCK_HELD_STATUSES] } },
  data: { status: 'CANCELLED' },
});
if (claimed.count === 0) return { released: false };
// … le stock n'est rendu QUE par le gagnant
```

La correction ne consiste pas à verrouiller plus fort, mais à faire de la
**transition de statut elle-même le jeton d'exclusion**. C'est le raisonnement
déjà employé par le décrément à la commande et par la consommation d'OTP :
une seule écriture décide, personne ne relit.

Les trois appelants passent désormais par cette fonction. `PaymentsService.settle`
revendique en outre le **paiement** par une bascule conditionnelle distincte :
gagner sur le paiement ne dit rien de la commande, qu'un client a pu annuler
entre-temps.

`DeliveriesService.assign` applique le même principe : `updateMany` filtré sur
les statuts réassignables, `count === 0` → `DELIVERY_ALREADY_STARTED`.

### 3.2 Une seule définition de « en vente »

Le site expose désormais la **décision** plutôt qu'un calcul :

```python
# backend/app/catalogue.py
"vendable": bool(v["actif"]) and (v.get("disponibilite") or "auto") != "rupture",
"disponibilite": v.get("disponibilite") or "auto",
"disponible": bool(v["actif"]) and bool(v.get("disponible")),  # règle de metier._enrichir
```

`vendable` est **indépendant du stock**, et c'est délibéré : tant que chaque
plateforme tient son propre compteur, transmettre une disponibilité qui dépend
du stock **du site** fermerait ici un rayon peut-être encore garni. Ce qui
franchit la frontière, c'est l'autorisation de vendre, jamais la quantité.

Côté application, une fonction unique — `estVendable()` — sert à la fois la
synchronisation et l'audit `diff()`, avec repli sur `actif` si le site n'est
pas encore redéployé. Et `OrdersService.create` refuse désormais une référence
que la cotation au checkout déclare retirée de la vente, **uniquement** sur
réponse explicite : site injoignable ⇒ la vente passe, une panne du site ne
doit pas fermer la boutique.

### 3.3 Ce que ces corrections ne font pas

Elles ne rapprochent **pas** les stocks, ni les comptes, ni les tarifs. Elles
ferment des trous par lesquels l'application vendait ce qui n'était pas à
vendre, ou inventait du stock. La cohérence complète relève de
`ARCHITECTURE.md`.

---

## 4. Vérification PostgreSQL / Prisma

**Modèles ↔ tables migrées** : correspondance exacte, aucun orphelin des deux
côtés (24 ↔ 24).

**Colonnes** : chaque champ scalaire du schéma apparaît dans l'historique des
migrations. Aucune colonne inventée par Prisma, aucune colonne oubliée.

**Ce qui n'a PAS pu être vérifié** : l'état réel de la base de production.
Le `DATABASE_URL` d'`apps/api/.env` est **périmé** —

```
error: password authentication failed for user 'neondb_owner' (code 28P01)
```

Trois conséquences, toutes importantes :

1. `prisma migrate status` ne peut pas confirmer que les 13 migrations sont
   effectivement appliquées en production ;
2. les contraintes, index et types réellement en base ne peuvent pas être
   comparés au schéma ;
3. **la majorité de la suite de tests de l'API ne peut pas s'exécuter ici**
   (voir §6).

Il n'y a par ailleurs **ni PostgreSQL local ni Docker** sur ce poste : rien
ne permet de recréer une base de secours sans intervention.

**Action requise du propriétaire** : renouveler l'URL Neon dans
`apps/api/.env`, puis relancer `npx prisma migrate status`.

---

## 5. Fichiers modifiés

### Dépôt `agrim-mobile`

| Fichier | Nature |
| --- | --- |
| `apps/api/src/common/stock/order-stock.ts` | **nouveau** — point de passage unique |
| `apps/api/src/common/stock/order-stock.spec.ts` | **nouveau** — 6 tests |
| `apps/api/src/orders/orders.service.ts` | annulation guardée + refus d'une référence retirée au checkout |
| `apps/api/src/management/management.service.ts` | annulation guardée |
| `apps/api/src/payments/payments.service.ts` | règlement guardé, restitution par le point unique |
| `apps/api/src/deliveries/deliveries.service.ts` | affectation guardée |
| `apps/api/src/catalog-sync/catalog-sync.service.ts` | `estVendable()`, `vendable` dans la cotation |
| `apps/api/src/payments/payments.reconcile.spec.ts` | harnais reconstruit + 1 test de course |
| `apps/api/src/catalog-sync/catalog-sync.service.spec.ts` | +6 tests |
| `docs/*.md` | les six documents de cette étape |

### Dépôt `riz-boigni`

| Fichier | Nature |
| --- | --- |
| `backend/app/catalogue.py` | `vendable` + `disponibilite`, `disponible` aligné sur la règle de référence |
| `backend/app/main.py` | `vendable` dans `/api/integration/prix` |
| `backend/tests/test_integration.py` | +1 test de contrat |

> ⚠️ Le site tourne sur Render depuis son propre dépôt Git : ces deux
> modifications **ne prennent effet qu'après déploiement**. L'application les
> tolère entre-temps (repli sur `actif`).

---

## 6. Migrations

**Aucune migration créée.** C'est un résultat, pas un manque : toutes les
corrections portent sur la **manière d'écrire** (bascule conditionnelle), pas
sur la forme des données. Le schéma PostgreSQL est inchangé, donc rien à
déployer côté base, donc aucun risque de migration.

---

## 7. Tests

### Exécutés et au vert

| Suite | Tests | Base requise |
| --- | --- | --- |
| API — 7 suites hors base, dont : | **86 ✅** | non |
| &nbsp;&nbsp;`order-stock.spec.ts` (**nouveau**) | 6 ✅ | non |
| &nbsp;&nbsp;`payments.reconcile.spec.ts` (**reconstruit**) | 6 ✅ | non |
| &nbsp;&nbsp;`catalog-sync.service.spec.ts` (**+6**) | 30 ✅ | non |
| &nbsp;&nbsp;`delivery-otp`, `order-logic`, `env.validation`, `secret-box` | 44 ✅ | non |
| `@agrim/contracts` | **9 ✅** | non |
| Mobile (24 suites) | **247 ✅** | non |
| Site : `pytest backend/tests` | **152 ✅** (dont 1 nouveau) | non (SQLite) |
| `tsc --noEmit` (API) | ✅ | non |
| `eslint --max-warnings 0` (API) | ✅ | non |

**Total exécuté : 494 tests, tous au vert.** Aucun échec.

**Régression trouvée et réparée** : `payments.reconcile.spec.ts` était **déjà
en échec** (4 tests) avant toute intervention de ma part. Le correctif de
concurrence était présent dans l'arbre de travail sans que son harnais de test
ait suivi : le faux `tx` n'exposait pas `updateMany`, l'appel partait en
`TypeError`, et la boucle de réconciliation l'avalait silencieusement. Le
harnais a été reconstruit avec un **état** plutôt que des retours figés — sans
quoi il ne prouverait rien d'une course.

### Non exécutables sur ce poste

Treize suites e2e (`*.e2e.spec.ts`, `flows`, `security`, `deliveries`,
`management`, `orders`, `auth`, `producers`, `notifications`, `tracking`,
`addresses`, `analytics`, `throttling`) ouvrent une vraie connexion
PostgreSQL. Avec un `DATABASE_URL` périmé, elles **restent bloquées sur des
tentatives de connexion de 60 secondes** — c'est ce qui a fait paraître la
suite « lente » plutôt qu'en échec.

Le README annonce « 481 tests au vert (243 API, 238 mobile) ». **Ce chiffre
n'a pas pu être reproduit ici**, faute d'accès à la base. Il ne doit pas être
considéré comme vérifié tant que §4 n'est pas réglé.

---

## 8. Décisions qui appartiennent au propriétaire

1. **Tarifs et remises** (§2, P1). Faut-il aligner l'application sur les zones
   du site — Abidjan à 3 500 au lieu de 1 000 — et y porter le retrait sur
   place, les remises volume et la remise grossiste ? Tant que la réponse
   n'est pas donnée, deux clients paient deux prix différents pour le même
   riz livré au même endroit. **C'est le point le plus urgent de cette liste.**
2. **Propriété du stock** (§2, P0 structurel). Le site possède déjà le
   catalogue ; qu'il possède aussi le stock, avec un point d'entrée de
   réservation appelé par l'application à la commande et de libération à
   l'annulation. Sans cela, la double vente est certaine dès que les deux
   canaux vendent en même temps.
3. **Identité client unique**. Le téléphone est déjà la clé des deux côtés.
4. **Accès à la base** (§4). Sans URL valide, aucune vérification en
   conditions réelles n'est possible — ni tests e2e, ni état des migrations.

---

## 9. Ce qui reste à faire

| # | Sujet | Où | Effort |
| --- | --- | --- | --- |
| 1 | Renouveler `DATABASE_URL`, rejouer les 13 suites e2e | app | minutes |
| 2 | Déployer le site (champ `vendable`) | site | minutes |
| 3 | Trancher les tarifs, puis unifier la règle dans `@agrim/contracts` | les deux | jours |
| 4 | Réservation de stock côté site | site | ~2 semaines |
| 5 | Idempotence de `POST /api/commandes` côté site | site | heures |
| 6 | Hacher `sessions.token` côté site | site | heures |
| 7 | Compte client unifié | les deux | ~1 mois |
| 8 | Retirer `Cart` / `CartItem` ou les mettre en service | app | à décider |
| 9 | Supprimer les 4 fichiers remplis de zéros, dont le faux `.bak` du site | les deux | minutes |
| 10 | Trancher `OUT_FOR_DELIVERY` dans `STOCK_HELD_STATUSES` (voir ci-dessous) | app | minutes |

**Sur le point nº 10.** `STOCK_HELD_STATUSES` inclut `OUT_FOR_DELIVERY`, si
bien qu'une annulation à ce stade rendrait le stock — alors que la marchandise
est partie avec le livreur. Aucun appelant ne peut l'atteindre aujourd'hui :
le client et le gestionnaire s'arrêtent à `READY`, et le balayage des
paiements ne traite que les `AWAITING_CONFIRMATION`, statut incompatible avec
une commande déjà confirmée et partie. Le paiement à la livraison reste en
`PENDING` et n'est jamais balayé. La branche est donc **inerte**, mais elle
repose sur une coïncidence entre trois modules plutôt que sur une règle
écrite. À expliciter — soit en retirant `OUT_FOR_DELIVERY` de l'ensemble,
soit en documentant que l'annulation à ce stade suppose le retour en entrepôt.

---

## Documents liés

- `ARCHITECTURE.md` — l'architecture réelle et la cible, avec justification
- `DATABASE.md` — les deux schémas, table par table
- `API-CONTRACT.md` — les endpoints et les formes de données
- `AUTHORIZATION.md` — rôles et permissions des deux côtés
- `STATUS-MODEL.md` — le vocabulaire officiel des statuts
