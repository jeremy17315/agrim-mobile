# AGRIM-Mobile

Plateforme mobile **AGRIM** — marque **RIZ BOAGNI**, _Pur riz local de luxe_.
Monorepo : application mobile (React Native / Expo) + API (NestJS / PostgreSQL).

> **État actuel : parcours complet fonctionnel, phases 0 à 20 livrées.**
> Application mobile et API opérationnelles : catalogue, panier, commande,
> livraison avec validation par code, espaces livreur, producteur,
> gestionnaire et direction. **481 tests au vert** (243 API, 238 mobile).
> Restent les phases 21 à 25 : performance, finitions, builds et publication.

|         |                                                                          |
| ------- | ------------------------------------------------------------------------ |
| Mobile  | React Native 0.86 · Expo SDK 57 · Expo Router · TanStack Query · Zustand |
| API     | NestJS · Prisma · PostgreSQL 17 · JWT + refresh avec rotation            |
| Partagé | `@agrim/contracts` — schémas Zod, énumérations, règles métier            |
| Tests   | Jest + RNTL (mobile) · Jest + Supertest (API, e2e inclus)                |

---

## Démarrage rapide

### Prérequis

- Node.js ≥ 20.19
- PostgreSQL 17 (local ou distant)
- Pour un APK : un compte [Expo](https://expo.dev) et `eas-cli`
  (voir [docs/APK-DE-TEST.md](docs/APK-DE-TEST.md))

### Installation

```bash
npm install
cp .env.example apps/api/.env   # puis renseigner les valeurs
```

### Base de données

```bash
# Démarrer PostgreSQL (si installé localement via apt)
sudo pg_ctlcluster 17 main start

# Créer le rôle et la base
sudo -u postgres psql <<'SQL'
CREATE ROLE agrim WITH LOGIN PASSWORD 'votre_mot_de_passe' CREATEDB;
CREATE DATABASE agrim_dev OWNER agrim;
SQL

# Migrations + données initiales AGRIM
cd apps/api
npx prisma migrate dev
npm run db:seed
```

### Lancer l'API

```bash
cd apps/api
npm run start:dev
```

- API : http://localhost:3000/api/v1
- Documentation Swagger : http://localhost:3000/api/v1/docs

### Lancer l'application mobile

```bash
cd apps/mobile
npx expo start
```

Sans téléphone, dans le navigateur (depuis la racine) :

```bash
npm run mobile:web
```

Si Metro affiche `expo-modules-core` / `src/index.ts` introuvable (fréquent
sous Windows) :

```bash
node scripts/reparer-metro.mjs --reinstaller
npm run mobile:web
```

Sur un appareil physique, l'API doit être joignable par le réseau : `localhost`
désigne le téléphone lui-même. Depuis la racine, `npm run apk:adresse` affiche
l'adresse à utiliser.

---

## Comptes de développement

Créés par le seed. Mot de passe commun : `Agrim2026!`

| Rôle         | Téléphone  |
| ------------ | ---------- |
| CLIENT       | 0700000001 |
| LIVREUR      | 0700000002 |
| PRODUCTEUR   | 0700000003 |
| GESTIONNAIRE | 0700000004 |
| ADMIN        | 0700000005 |
| DG           | 0700000006 |

> Ces comptes n'existent qu'en développement. Ne jamais les seeder en production.

---

## Structure

```
agrim-mobile/
├── apps/
│   ├── api/                    # Backend NestJS
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   ├── migrations/
│   │   │   └── seed.ts         # Données AGRIM
│   │   └── src/
│   │       ├── auth/           # JWT + refresh avec rotation
│   │       ├── products/       categories/    orders/
│   │       ├── addresses/      deliveries/    notifications/
│   │       ├── producers/      management/    analytics/
│   │       ├── common/         # Guards, filtres, chiffrement
│   │       ├── config/         # Validation d'environnement
│   │       └── bootstrap.ts    # Config HTTP centralisée (helmet, CORS…)
│   └── mobile/                 # Application Expo
│       ├── app/                # Routes (Expo Router)
│       │   ├── (auth)/         (tabs)/        commande/
│       │   ├── commandes/      tournee/       exploitation/
│       │   └── gestion/        direction/
│       ├── src/
│       │   ├── api/            # Hooks TanStack Query — seul accès réseau
│       │   ├── components/     # UI, carte, états
│       │   ├── store/          # Zustand (panier, session)
│       │   └── theme/          # Design system
│       └── eas.json            # Profils de build
├── packages/
│   └── contracts/              # Schémas Zod + enums + règles métier
├── scripts/
└── docs/
```

### `@agrim/contracts` — le contrat de données

Source de vérité **unique et partagée** entre le mobile et l'API : schémas Zod,
énumérations métier, machine à états des commandes, et configuration société.

Les données AGRIM (gammes, formats, contacts, prix provisoires) sont centralisées
dans `packages/contracts/src/company.ts` : **aucune valeur métier n'est écrite en
dur dans un composant ou un service**.

---

## Commandes

```bash
# API
npm run start:dev -w @agrim/api    # développement (watch)
npm run build -w @agrim/api        # compilation
npm run test -w @agrim/api         # tests (243)
npm run lint -w @agrim/api         # ESLint (0 warning toléré)
npm run typecheck -w @agrim/api    # TypeScript strict

# Mobile
npm run start -w @agrim/mobile     # Metro
npm run test -w @agrim/mobile      # tests (238)
npm run typecheck -w @agrim/mobile

# Base de données
npm run db:migrate -w @agrim/api
npm run db:seed -w @agrim/api

# Utilitaires
npm run apk:adresse                # adresse d'API joignable par un téléphone
```

> Les tests e2e de l'API utilisent la base de développement : ne pas les lancer
> en parallèle d'une session de test manuelle.

---

## Endpoints disponibles

| Méthode             | Route                                                      | Accès                                     |
| ------------------- | ---------------------------------------------------------- | ----------------------------------------- |
| GET                 | `/api/v1/health`                                           | public                                    |
| GET                 | `/api/v1/categories`                                       | public                                    |
| GET                 | `/api/v1/products`                                         | public — recherche, filtres, pagination   |
| GET                 | `/api/v1/products/:slug`                                   | public                                    |
| POST                | `/api/v1/auth/register`                                    | public                                    |
| POST                | `/api/v1/auth/login`                                       | public — limité à 5/min                   |
| POST                | `/api/v1/auth/refresh`                                     | public — avec rotation                    |
| POST                | `/api/v1/auth/logout`                                      | authentifié                               |
| GET                 | `/api/v1/auth/me`                                          | authentifié                               |
| POST                | `/api/v1/auth/change-password`                             | authentifié                               |
| GET/POST/PUT/DELETE | `/api/v1/addresses`                                        | client                                    |
| POST/GET            | `/api/v1/orders` · `/:reference` · `/tracking` · `/cancel` | client                                    |
| GET                 | `/api/v1/deliveries/mine` · `/:id` · `/:id/route`          | livreur                                   |
| PATCH               | `/api/v1/deliveries/:id/status`                            | livreur — statuts terrain                 |
| POST                | `/api/v1/deliveries/:id/verify-otp`                        | livreur — **seul chemin vers DELIVERED**  |
| GET                 | `/api/v1/deliveries/orders/:reference/otp`                 | client — propriétaire seul                |
| POST                | `/api/v1/deliveries/orders/:reference/close`               | gestionnaire — clôture d'exception        |
| GET/PATCH           | `/api/v1/management/*`                                     | gestionnaire — commandes, stock, livreurs |
| GET                 | `/api/v1/analytics/dashboard`                              | direction                                 |
| GET/POST/PUT        | `/api/v1/producers/me/*`                                   | producteur — parcelles, récoltes          |
| GET/PATCH           | `/api/v1/notifications` · `/read` · `/tokens`              | authentifié                               |

Liste complète et à jour dans Swagger : `/api/v1/docs`.

---

## Documentation

| Document                                                                                                                | Contenu                                                            |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [docs/APK-DE-TEST.md](docs/APK-DE-TEST.md)                                                                              | **Construire un APK installable** — guide en 8 étapes              |
| [docs/PUBLIER-SUR-GITHUB.md](docs/PUBLIER-SUR-GITHUB.md)                                                                | Publier le dépôt sur GitHub                                        |
| [docs/VALIDATION-LIVRAISON-OTP.md](docs/VALIDATION-LIVRAISON-OTP.md)                                                    | Validation de livraison par code, chiffrement, clôture d'exception |
| [docs/PHASE-20-SECURITE.md](docs/PHASE-20-SECURITE.md)                                                                  | Revue de sécurité                                                  |
| [docs/PHASE-19-CONSOLIDATION-TESTS.md](docs/PHASE-19-CONSOLIDATION-TESTS.md)                                            | Stratégie de tests                                                 |
| [docs/PHASE-18-FLUX-BOUT-EN-BOUT.md](docs/PHASE-18-FLUX-BOUT-EN-BOUT.md)                                                | Parcours de bout en bout                                           |
| [docs/PHASE-17-DIRECTION-GENERALE.md](docs/PHASE-17-DIRECTION-GENERALE.md) · [16](docs/PHASE-16-ESPACE-GESTIONNAIRE.md) | Espaces direction et gestion                                       |

---

## Choix structurants

### Montants en XOF entiers

Aucun flottant pour l'argent. Les prix sont des entiers de francs CFA ; les poids
sont en grammes entiers (22,5 kg → `22500`). Cela élimine toute erreur d'arrondi.

### Adresses adaptées au contexte ivoirien

L'adressage formel étant faible, une adresse combine commune, quartier,
**points de repère**, téléphone de contact et coordonnées GPS — et non une
simple ligne de rue.

### Le téléphone comme identifiant

L'inscription et la connexion utilisent le numéro de téléphone (format ivoirien,
`+225` optionnel), l'email restant facultatif.

### Sécurité

- Refresh tokens **hachés en SHA-256** en base — jamais en clair.
- **Rotation** à chaque renouvellement ; la réutilisation d'un token révoqué
  invalide toutes les sessions de l'utilisateur (détection de vol).
- RBAC vérifié **côté serveur** à chaque requête. Le frontend n'est jamais une
  couche de sécurité.
- Argon2 pour les mots de passe, `helmet`, rate limiting, validation stricte
  avec liste blanche des champs.
- Aucune erreur technique brute renvoyée au client.
- Code de livraison **chiffré au repos** (AES-256-GCM) : lisible par son seul
  propriétaire, jamais poussé en notification ni journalisé.
- Le livreur ne peut pas clôturer une livraison sans le code du client ; la
  voie d'exception appartient à la gestion, avec motif tracé et comptage
  visible par la direction.

### Idempotence des commandes

Chaque commande porte une `idempotencyKey` unique : une reconnexion après une
coupure réseau ne peut pas créer de doublon — contrainte essentielle en
connectivité intermittente.

---

## Données provisoires

Conformément à la règle « ne pas bloquer pour une information manquante », des
valeurs raisonnables ont été créées et **clairement identifiées** dans
`packages/contracts/src/company.ts` sous les préfixes `PROVISIONAL_*` :

- **prix** des 4 gammes × 3 formats (indicatifs marché ivoirien) ;
- **stocks** initiaux ;
- **frais de livraison** (1 000 XOF, offerts au-delà de 25 000 XOF).

À remplacer par les valeurs officielles AGRIM sans toucher au code applicatif.

---

## Sécurité et secrets

- `.env` n'est **jamais** commité ; seul `.env.example` l'est.
- Les variables `EXPO_PUBLIC_*` sont **lisibles dans le bundle mobile** : n'y
  placer aucun secret.
- L'API refuse de démarrer si un secret est absent ou si un secret de
  développement est détecté en production.
