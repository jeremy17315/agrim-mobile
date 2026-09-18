# Livrable 1 — Audit du dépôt existant `agrim-mobile`

> Établi le 18 septembre 2026, par lecture directe du dépôt
> `jeremy17315/agrim-mobile` (commit `c66a973`, « Le site devient
> propriétaire du stock et du tarif de livraison »).
> Objectif : dire ce qu'il faut **conserver**, **refondre** ou **supprimer**
> pour atteindre l'architecture cible (SSOT, API centrale unique, LWS/cPanel,
> mobile Flutter) — sans complaisance et sans estimation non vérifiée.

---

## 1. Méthode et périmètre

Le dépôt a été audité de bout en bout : arborescence, schéma Prisma
(`apps/api/prisma/schema.prisma`), 68 routes NestJS, modules critiques
(`orders`, `payments`, `deliveries`, `catalog-sync`, `reconciliation`,
`common/stock`), application mobile Expo, documentation interne (13 documents)
et chaîne CI. Les chiffres ci-dessous sont recomptés à la date de l'audit.

Le dépôt n'est **pas** l'écosystème complet : il contient l'application mobile
et son API, mais **pas** le site web (FastAPI, dépôt séparé, déployé sur
`https://agrim-zuxe.onrender.com`). L'audit intègre néanmoins le site, car le
code de ce dépôt lui est structurellement couplé.

---

## 2. Inventaire factuel

### 2.1 Ce dépôt (`agrim-mobile`)

| Mesure | Valeur | Détail |
| --- | --- | --- |
| Forme | Monorepo npm (workspaces) | `apps/api`, `apps/mobile`, `packages/contracts` |
| Backend | NestJS 11 · Prisma · PostgreSQL 17 (Neon) | 16 contrôleurs, **68 routes**, 14 migrations |
| Modèles métier | **25 modèles** Prisma | User, Product/Variant, StockMovement, Order, Payment, Delivery, DeliveryOtp, Producer, Farm, Production, Referral, Review… |
| Mobile | **React Native 0.86 / Expo SDK 57** (PAS Flutter) | Expo Router, 33 écrans/routes, TanStack Query, Zustand, Zod |
| Contrats partagés | `@agrim/contracts` | Schémas Zod, énumérations, règles de calcul panier/OTP/livraison |
| Tests | **481 au vert** (243 API, 238 mobile) | Jest + Supertest (2 suites e2e API) · Jest + RNTL |
| CI | GitHub Actions, 2 jobs | `verification` (sans base) + `e2e-api` (PostgreSQL éphémère) |
| Lignes de code | ~11 400 TS (API, hors tests) · ~13 100 TS/TSX (mobile) | |
| Docs | 13 documents français de qualité | ARCHITECTURE, AUDIT-FOUNDATIONS, STATUS-MODEL, VALIDATION-LIVRAISON-OTP, AUTHORIZATION… |

### 2.2 L'écosystème auquel il est couplé

| | Site web | Application mobile (ce dépôt) |
| --- | --- | --- |
| Backend | FastAPI · Python 3.14 | NestJS · TypeScript |
| Base | PostgreSQL (prod), SQLite (dev) | PostgreSQL 17 (Neon) |
| Routes | 145 | 68 |
| Tables | 21 (en français) | 25 (en anglais) |
| Déploiement | Render (offre gratuite) | Railway (`railway.json`) / Render (`render.yaml`) |

**Deux bases, aucune table commune, aucune ligne partagée.** Neuf concepts
métier modélisés deux fois sous deux vocabulaires : compte client
(`clients` / `User`), commande (`commandes` / `Order`), ligne de commande,
catalogue (`produits`·`gammes` / `Product`·`ProductVariant`·`Category`),
stock (`produits.stock`·`mouvements_stock` / `ProductVariant.stock`),
paiement, livraison (`tournees` / `Delivery`·`DeliveryOtp`), avis
(`avis` / `ProductReview`), personnel (`utilisateurs` / `User`).

Le seul lien réel : **trois points d'intégration HTTP** protégés par un jeton
partagé (`RB_SYNC_TOKEN` côté site = `SITE_INTEGRATION_TOKEN` côté app) :

| Endpoint | Sens | Propriété | Fréquence |
| --- | --- | --- | --- |
| `GET /api/integration/catalogue` | site → app | catalogue | 15 min (pull) |
| `POST /api/integration/prix` | site → app | prix + grille livraison | à chaque checkout |
| `POST /api/integration/message` | app → site | messagerie SMS/WhatsApp | à chaque SMS |

---

## 3. Ce que fait bien le code existant (actifs à préserver)

Le problème de ce dépôt **n'est pas la qualité du code : elle est bonne**.
Machines à états vérifiées, sécurité réfléchie, tests massifs, documentation
d'exception. Voici les actifs que la refonte **récupère** :

### 3.1 Le domaine métier modélisé (25 modèles, 14 migrations)
Concepts complets et éprouvés : catalogue à deux niveaux (produit → variantes),
journal `StockMovement`, machine à états de commande avec audit `OrderEvent`,
paiements multi-fournisseurs, livraisons avec traçabilité GPS, OTP, réessai
après échec, parrainage, avis producteurs, sociétés/paramètres, compteurs de
numérotation. C'est la **spécification fonctionnelle vivante** du métier.

### 3.2 La machine RBAC cible, déjà exacte
`enum Role { CLIENT, LIVREUR, PRODUCTEUR, GESTIONNAIRE, ADMIN, DG }` — les six
rôles exigés par la mission, appliqués par un `RolesGuard` global côté serveur.
Rien à changer au vocabulaire.

### 3.3 Le design OTP de livraison (conforme à la lettre à la cible)
Code à 4 chiffres généré par `crypto.randomInt` côté serveur, persisté en
SHA-256, TTL 60 min, 5 tentatives, renvois plafonnés, usage unique, un seul
code actif, chiffrement au repos séparé des clés JWT, clôture d'exception
réservée à la gestion (le livreur ne peut **jamais** clôturer sans code).
C'est exactement la règle « le livreur ne connaît pas l'OTP à l'avance ».

### 3.4 L'isolation des fournisseurs de paiement
`PaymentProvider` abstrait avec trois implémentations : `CinetPayProvider`
(portage fidèle de `paiement.py` du site, avec les corrections de production
« payées » documentées — dont l'ordre exact des 16 champs signés HMAC),
`PaydunyaProvider` (secours) et `SimulationProvider` (tests). Vérification
systématique du statut réel auprès de l'agrégateur (`/v2/payment/check`),
jamais confiance au retour client. La cible « module CinetPay isolé » est
déjà dessinée.

### 3.5 L'hygiène de sécurité serveur
- Auth JWT access + refresh **avec rotation** et révocation, argon2, secrets
  distincts, refus de démarrer en prod sur des secrets faibles
  (`env.validation`).
- **Idempotence des commandes** : `Order.idempotencyKey @unique` consommé dans
  la transaction.
- Décrément de stock conditionnel (`stock: { gte: qty }`) et restitution de
  stock par **transition de statut conditionnelle** (le `UPDATE ... WHERE
  status IN (...)` est le jeton d'exclusion — motif `P0` corrigé fin août,
  documenté dans `AUDIT-FOUNDATIONS.md` §2).
- Rate limiting global (throttler), CORS minimal, Swagger coupé en prod,
  preuves de livraison jamais servies en statique.

### 3.6 Les 481 tests comme spécification
Chaque règle métier a son test. La logique testée (prix serveur, transitions
interdites, arbitrage d'annulation concurrente, OTP) survit intégralement au
changement de stack ; seuls les harnais React Native devront être réécrits.

### 3.7 La documentation métier
13 documents français décrivant « ce que fait le code, pas une intention »,
dont la table de correspondance des statuts entre les deux plateformes et les
règles d'audit. Ils constituent la base des livrables 4 à 7 de la refonte.

---

## 4. Ce qui doit disparaître (incompatibilités structurelles avec la cible)

### 4.1 L'architecture à deux systèmes elle-même — cause racine des maux décrits
C'est le cœur de l'audit. La refonte n'est pas motivée par du code mauvais,
mais par une **décision d'architecture désormais invalide** : la trajectoire
documentée dans `docs/ARCHITECTURE.md` (« le site possède le catalogue, le
stock et la messagerie ; l'application possède commandes et paiements ; jamais
de base partagée ») organise précisément ce que la mission interdit :

| Problème constaté | Conséquence métier | Verdict |
| --- | --- | --- |
| Catalogue copié par pull toutes les 15 min | Prix/promotions incohérents jusqu'à 15 min | Supprimer |
| Relais du prix au checkout par HTTP inter-systèmes (`POST /api/integration/prix`) | Latence + dépendance croisée à chaque commande | Supprimer |
| **Stock réservé à distance** (réserver → transaction locale → confirmer, compensation si échec, expiration 30 min) | Saga distribuée complexe pour compenser l'absence de SSOT ; double vente possible si le site n'est pas à jour | Supprimer |
| Comptes clients séparés | Un client du site ne peut pas se connecter à l'app ; historique fragmenté | Supprimer |
| Commandes vivant dans deux bases | Statuts contradictoires vus par le support | Supprimer |
| Vocabulaire de statuts divergent (6 valeurs côté site vs 7 côté app, noms différents) | Incompréhension opérationnelle (documentée dans `STATUS-MODEL.md`) | Supprimer |
| Messagerie SMS/WhatsApp relayée par le site | Couplage accidentel app ↔ site pour une fonction annexe | Supprimer |

**Point de vigilance assumé** : `docs/ARCHITECTURE.md` avait raison de rejeter
la « base partagée entre deux applications hétérogènes » — deux écrivains sans
propriétaire unique des règles est un piège réel. La cible n'est **pas** cette
option rejetée : c'est **une seule application backend** (un seul propriétaire
des règles, un seul jeu de migrations versionnées) dont le site, le back-office
et le mobile sont trois clients. La condition qui rend la base unique sûre est
réunie, et elle ne l'était pas.

### 4.2 Le mobile React Native/Expo → réécriture Flutter
La contrainte de mission impose **Flutter/Dart**. `apps/mobile` (33 écrans,
TanStack Query, Zustand, Expo Router, expo-notifications, react-native-maps)
est donc condamné en tant que code — mais pas en tant que savoir :

- **Conserver en référence** : parcours clients/livreurs/producteurs/gestion/
  direction, hiérarchie d'espaces `(tabs)`, machine à états écran ↔ statut,
  logique panier (`src/store/cart.ts`), couche réseau unique (`src/api/`).
- **Réécrire** : tout, en Dart. Offline (SQLite/Hive/Drift), FCM natif
  (remplace `expo-notifications`/Expo Push), `flutter_secure_storage`,
  idempotency key générée client-side mais **jamais de prix calculé client**.
- Les 238 tests RNTL ne se portent pas ; les scénarios qu'ils couvrent
  deviennent la checklist de conformité Flutter.

### 4.3 Les ordonnanceurs in-process → Cron cPanel
`CatalogSyncModule` et `ReconciliationModule` tournent sur `setInterval`
dans le process Node (15 min et 10 min), avec un passage de rattrapage au
démarrage — un aveu documenté que « sur un hébergement dont l'instance
s'endort, le minuteur ne tourne pas ». Sur LWS/cPanel via Passenger, un
processus long n'est pas une base supportable (redémarrages, limites
mémoire, multi-instances). **Toutes** les tâches périodiques deviennent des
Cron Jobs cPanel appelant des endpoints internes authentifiés et idempotents.
Bonne nouvelle : la réconciliation est déjà idempotente par conception.

### 4.4 Les manifestes de déploiement Railway/Render/Neon
`railway.json`, `render.yaml` et la dépendance Neon/Render sont exclus par les
contraintes (pas de Railway, Render, Supabase). Le document `render.yaml`
documente lui-même les pièges (instance qui s'endort, disque éphémère perdant
les signatures manuscrites). À supprimer au profit de la procédure
cPanel/Passenger (livrable 8). La CI GitHub Actions, elle, **reste** (elle ne
dépend d'aucune de ces plateformes).

### 4.5 Le couplage `SITE_INTEGRATION_*`
Variables `SITE_INTEGRATION_URL/TOKEN`, `CATALOG_SYNC_INTERVAL_MINUTES`, le
module `catalog-sync` entier (copie de catalogue, requote de prix, grille de
livraison distante) et le relais SMS via le site disparaissent. Le stock de
prix, stock, promotions, grille de livraison et messagerie revient **dans**
l'API centrale.

---

## 5. Ce qu'il faut refondre (l'esprit conservé, l'implémentation changée)

| Élément existant | Verdict | Cible |
| --- | --- | --- |
| API NestJS (68 routes) | **Refondre en élargissant** | Elle devient **l'API centrale unique** : elle absorbe catalogue (écriture, pas copie), promotions, stock (avec verrouillage PG), comptes web, avis, facturation, messagerie sortante. Le squelette NestJS, les guards, les machines à états, Prisma et le pattern de modules sont conservés. |
| Prisma (25 modèles) | **Refondre** | Le modèle reste la base de l'ERD cible (livrable 4), unifié avec les 21 tables du site ; verrouillage pessimiste (`SELECT … FOR UPDATE`) là où le motif actuel suffit à peine. |
| Auth | **Conserver le design, élargir** | Un seul annuaire d'utilisateurs (clients web = clients mobile) ; JWT + rotation inchangés ; liaison optionnelle des comptes historiques du site lors de la migration (livrable 9). |
| Stockage fichiers (pilote local) | **Conserver** | Disque persistant sous cPanel, toujours derrière l'interface `StorageProvider`, jamais servi statiquement. |
| Contrats Zod (`@agrim/contracts`) | **Refondre** | Restent la loi côté API/back-office (TypeScript). Côté Flutter, le contrat est réexprimé en Dart (génération OpenAPI ou duplication testée) — un contrat n'est pas « partagé » exécutablement entre TS et Dart. |
| Notifications (Expo Push + relais SMS site) | **Refondre** | Service de notifications découplé : FCM (firebase-admin), WhatsApp Business/agrégateur direct, SMTP — abstraits derrière une interface, souscription par événement métier (livrable 3). |
| Back-office | **Refondre** | Le back-office du site (`frontend/admin.html`, gestion catalogue/promotions) et les espaces « gestion/direction » de l'app convergent vers **un back-office web unique** client de l'API centrale. Les espaces livreur/producteur restent mobiles. |

---

## 6. Synthèse du tri

| Décision | Contenu |
| --- | --- |
| **Conserver** | Domaine métier (25 modèles), RBAC 6 rôles, design OTP, isolation fournisseurs de paiement, idempotence commandes, journal d'audit, décrément conditionnel, CI, discipline de tests, documentation métier |
| **Refondre** | L'API NestJS → API centrale unique (absorbe catalogue/stock/comptes/avis/messagerie) · Prisma (unification + verrouillage) · ordonnanceurs → cron cPanel · notifications → service découplé (FCM/WhatsApp/SMTP) · contrats (TS + Dart) |
| **Supprimer** | `apps/mobile` (RN/Expo) → Flutter · `catalog-sync` et tout couplage `SITE_INTEGRATION_*` · `railway.json` / `render.yaml` / dépendance Neon · `setInterval` in-process · le site FastAPI **en tant que backend autonome** (ses 145 routes sont réabsorbées par l'API centrale ; son front devient client) |

---

## 7. Risques et zones d'attention identifiés pour la conception

1. **Prisma sur Passenger (cPanel)** : le query engine est un binaire natif ;
   à valider tôt sur l'environnement LWS réel (chemins, mémoire, cold start).
   Plan de repli évalué au livrable 3 si bloquant (SQLAlchemy/FastAPI via
   Passenger WSGI), mais Node/Passenger reste la voie la mieux supportée par
   cPanel « Setup Node.js App ».
2. **PostgreSQL mutualisé LWS** : quotas de connexions faibles → pool Prisma
   réduit et timeouts raisonnables ; accès souvent restreint au même hébergeur
   (sans conséquence : API et base co-localisées).
3. **Cron cPanel à la minute** : cadence plancher ~1 min ; les endpoints de
   jobs doivent être idempotents et tolérer le chevauchement (verrou
   applicatif en base).
4. **Perte apparente des 238 tests mobiles** : compensée par la réécriture des
   scénarios en tests Flutter (livrable 10).
5. **Migration des données site (livrable 9)** : SQLite en dev / PostgreSQL en
   prod côté site, vocabulaires de statuts différents, comptes à dédupliquer
   par téléphone — c'est le chantier le plus sensible, il est planifié après
   la mise en place de l'API centrale, avec bascule par écrans de
   compatibilité si nécessaire.
6. **CinetPay** : le portage existant est de qualité ; la refonte doit surtout
   garantir l'**idempotence du webhook**, l'**authentification de la
   signature** et la **re-vérification systématique** (livrable 6), tout en
   réabsorbant les commandes web dans le même pipeline de paiement.

---

## 8. Conclusion

Le dépôt n'est pas un chantier de correction : c'est une **mine de
spécification fonctionnelle et de règles de sécurité déjà payées** (OTP,
idempotence, arbitrage concurrentiel, audit), portée par un code de qualité —
mais encastré dans une architecture à deux systèmes dont la trajectoire
documentée (« le site possède le stock, jamais de base partagée ») est
l'inverse exact de la cible imposée. La refonte conserve l'essentiel de la
**substance** (domaine, règles, machines à états, patterns serveur) et
remplace la **forme** : une seule base, une seule API, trois clients
(Flutter, Web, Back-Office), zéro synchronisation, infrastructure
LWS/cPanel.

La suite : livrable 2 — le diagramme d'architecture globale (`01-architecture-cible.md`).
