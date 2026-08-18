# AGRIM-Mobile

Plateforme mobile **AGRIM** — marque **RIZ BOAGNI**, *Pur riz local de luxe*.
Monorepo : application mobile (React Native / Expo) + API (NestJS / PostgreSQL).

> **État actuel : fondations backend opérationnelles.**
> API REST fonctionnelle sur PostgreSQL réel, authentification JWT complète,
> catalogue AGRIM en base, 26 tests au vert. L'application mobile n'est pas
> encore initialisée (phase suivante).

---

## Démarrage rapide

### Prérequis
- Node.js ≥ 20.19
- PostgreSQL 17 (local ou distant)

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

---

## Comptes de développement

Créés par le seed. Mot de passe commun : `Agrim2026!`

| Rôle | Téléphone |
|---|---|
| CLIENT | 0700000001 |
| LIVREUR | 0700000002 |
| PRODUCTEUR | 0700000003 |
| GESTIONNAIRE | 0700000004 |
| ADMIN | 0700000005 |
| DG | 0700000006 |

> Ces comptes n'existent qu'en développement. Ne jamais les seeder en production.

---

## Structure

```
agrim-mobile/
├── apps/
│   └── api/                    # Backend NestJS
│       ├── prisma/
│       │   ├── schema.prisma   # 21 modèles
│       │   ├── migrations/
│       │   └── seed.ts         # Données AGRIM
│       └── src/
│           ├── auth/           # JWT + refresh avec rotation
│           ├── products/       # Catalogue
│           ├── categories/     # Gammes RIZ BOAGNI
│           ├── orders/         # Logique commandes (calculs, références)
│           ├── common/         # Guards, filtres, décorateurs
│           ├── config/         # Validation d'environnement
│           └── prisma/
├── packages/
│   └── contracts/              # Schémas Zod + enums + données société
└── docs/
    └── PHASE-0-ANALYSE-ENVIRONNEMENT.md
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
npm run test -w @agrim/api         # tests (26)
npm run lint -w @agrim/api         # ESLint (0 warning toléré)
npm run typecheck -w @agrim/api    # TypeScript strict

# Base de données
npm run db:migrate -w @agrim/api
npm run db:seed -w @agrim/api
```

---

## Endpoints disponibles

| Méthode | Route | Accès |
|---|---|---|
| GET | `/api/v1/health` | public |
| GET | `/api/v1/categories` | public |
| GET | `/api/v1/products` | public — recherche, filtres, pagination |
| GET | `/api/v1/products/:slug` | public |
| POST | `/api/v1/auth/register` | public |
| POST | `/api/v1/auth/login` | public — limité à 5/min |
| POST | `/api/v1/auth/refresh` | public — avec rotation |
| POST | `/api/v1/auth/logout` | authentifié |
| GET | `/api/v1/auth/me` | authentifié |
| POST | `/api/v1/auth/change-password` | authentifié |

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
