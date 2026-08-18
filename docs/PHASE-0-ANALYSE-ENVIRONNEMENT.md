# Phase 0 — Analyse de l'environnement

Date : 18 août 2026

## 1. Environnement détecté

| Élément | Constat | Impact projet |
|---|---|---|
| OS | Debian 13 (trixie), x86_64, 2 vCPU, 1,9 Go RAM | Suffisant pour l'API ; insuffisant pour un émulateur Android |
| Node.js | v20.20.2 | Conforme (Prisma 7 exige `^20.19 \|\| ^22.12 \|\| >=24`) |
| npm | 10.8.2 | Retenu comme gestionnaire (pnpm/yarn/bun absents) |
| Git | 2.47.3 | Disponible |
| Docker | **absent** | PostgreSQL installé nativement via apt |
| PostgreSQL | **installé pendant cette phase** (17.11) | Base `agrim_dev` opérationnelle |
| Redis | absent | Non requis en V1 (section 48) |
| Java | OpenJDK 11 | Insuffisant pour un build Android local (JDK 17+) → EAS Build |
| Xcode | impossible (Linux) | Build iOS uniquement via EAS |
| Registry npm | joignable (PONG 292 ms) | Installation des dépendances possible |

## 2. Projet existant

`/home/user` ne contenait aucun code : **aucune migration, aucune reprise
d'existant**. Le projet démarre donc sur une base vierge, ce qui est cohérent
avec la règle d'indépendance (pas de dépendance à Railway ni Supabase).

## 3. Versions retenues (vérifiées sur le registry, pas de mémoire)

| Paquet | Version installée | Remarque |
|---|---|---|
| Expo SDK | **57** (dernier stable, 30 juin 2026) | SDK 56 souffre d'une régression mémoire Hermes V1 |
| React Native | 0.86 (via SDK 57) | New Architecture obligatoire |
| NestJS | 11.2.1 | |
| Prisma | 7.9.1 | **Changement majeur** : voir §4 |
| PostgreSQL | 17.11 | |
| TypeScript | 5.9.3 | mode `strict` activé |

## 4. Décisions techniques prises pendant la phase

### 4.1 Prisma 7 : `url` sort du schéma

Prisma 7 refuse `url = env("DATABASE_URL")` dans le bloc `datasource`. La
connexion se déclare désormais dans `prisma.config.ts` et le client exige un
**driver adapter** (`@prisma/adapter-pg`). C'est appliqué dans
`src/prisma/prisma.client.ts`.

### 4.2 Compilation : `tsc`, pas `tsx`

Première tentative avec `tsx watch` : **toute l'injection de dépendances
NestJS échouait** (`Cannot read properties of undefined`). Cause : esbuild
n'émet pas `emitDecoratorMetadata`, dont NestJS dépend entièrement.
→ Compilation via `nest start` / `tsc`. `tsx` reste utilisé pour le seed
(script isolé sans injection).

### 4.3 Monorepo : `@agrim/contracts` en workspace

Les imports relatifs profonds (`../../../../packages/...`) sortaient du
`rootDir` et déplaçaient l'arborescence de `dist/`. Le package est désormais
compilé et consommé via l'alias workspace `@agrim/contracts`.

### 4.4 Rôle PostgreSQL

Prisma Migrate a besoin d'une *shadow database* : le rôle `agrim` a reçu
`CREATEDB`. À restreindre en production (migrations appliquées par un rôle
dédié, l'application tournant avec un rôle sans droit DDL).

## 5. Limites de l'environnement actuel

À connaître avant d'attaquer la partie mobile :

1. **Aucun émulateur** Android/iOS possible ici (RAM, pas de KVM, pas de
   Xcode). Le développement mobile se validera sur appareil physique via
   Expo Go / development build, ou sur un poste de développement.
2. **Development build EAS requis dès le début** pour les notifications push :
   elles ne fonctionnent plus dans Expo Go sur Android depuis SDK 53, et Expo Go
   SDK 56/57 n'est pas publié sur les stores.
3. **Pas de Docker** : PostgreSQL tourne nativement. À relancer après un
   redémarrage du bac à sable avec `sudo pg_ctlcluster 17 main start`.

## 6. État de la base

Base `agrim_dev` — 21 tables, 7 types énumérés, 1 migration appliquée
(`20260818102433_init_agrim_schema`).

Seed exécuté : 6 utilisateurs (un par rôle), 4 gammes, 4 produits,
12 variantes (3 formats × 4 gammes), 1 commande de démonstration avec
paiement, livraison et notifications.

## 7. Prochaine étape recommandée

Phase 5 (suite) et Phase 10-11 côté backend : panier serveur et commandes avec
génération transactionnelle de référence, avant d'initialiser l'application
mobile (Phase 2) — de sorte que le mobile se branche sur une API déjà réelle.
