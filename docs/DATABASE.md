# Bases de données — AGRIM / RIZ BOAGNI

> État réel au 28 août 2026.
> **Il y a deux bases.** Ce document décrit les deux et ce qui les sépare.

## 0. Avertissement sur la vérification

Les schémas ci-dessous sont établis à partir du **code source** :
`apps/api/prisma/schema.prisma` et ses 13 migrations d'un côté,
`backend/app/db.py` (constante `SCHEMA`) de l'autre.

L'**état réel de la base de production n'a pas pu être inspecté** : le
`DATABASE_URL` d'`apps/api/.env` est périmé —

```
error: password authentication failed for user 'neondb_owner'  (28P01)
```

Tant que cette URL n'est pas renouvelée, on ne peut confirmer ni que les 13
migrations sont appliquées, ni que les index et contraintes réels
correspondent. **À faire en priorité.**

---

## 1. Base de l'application — PostgreSQL 17 (Neon)

Gouvernée **exclusivement** par Prisma. Toute modification passe par une
migration versionnée. 24 modèles, 13 migrations.

Conventions : montants en **entiers XOF** (aucun flottant, donc aucune erreur
d'arrondi), poids en **grammes entiers** (22,5 kg = 22500, jamais 22.5),
clés primaires en **UUID**.

### Utilisateurs et sécurité

| Table | Rôle | Points notables |
| --- | --- | --- |
| `User` | comptes, tous rôles confondus | `phone` **unique** (identifiant naturel en Côte d'Ivoire), `email` unique et facultatif, `referralCode` unique |
| `RefreshToken` | sessions | `tokenHash` **unique** — jamais le jeton en clair ; rotation |
| `PushToken` | notifications | `token` unique |
| `Address` | adresses | GPS + repères plutôt qu'une rue : adapté au contexte local |

### Catalogue — **copie** du site

| Table | Rôle | Clé de synchronisation |
| --- | --- | --- |
| `Category` | gamme | `sourceCode` unique (`EBE`, `DJA`…) |
| `Product` | gamme commerciale | `sourceCode` unique |
| `ProductVariant` | format vendable | `sourceRef` unique (`RB-EBE-05`…), `syncedAt` |
| `ProductReview` | avis | `@@unique([productId, userId])` — on note le riz, pas la commande |

La clé est **la référence du site**, jamais le nom ni le sku : ceux-ci se
corrigent dans le back office sans rien casser ici.

### Commandes, paiement, livraison

| Table | Points notables |
| --- | --- |
| `Order` | `reference` unique, `idempotencyKey` **unique** (protège du rejeu réseau), prix **figés** à la commande |
| `OrderItem` | `productName`, `variantLabel`, `unitPrice` **dénormalisés** : l'historique reste lisible si le catalogue change |
| `OrderEvent` | journal d'audit des transitions — la seule trace qui survive à la réutilisation d'une ligne `Delivery` |
| `OrderCounter` | compteur annuel, incrémenté **atomiquement** : deux commandes simultanées n'obtiennent jamais la même référence |
| `Payment` | `orderId` unique ; le statut fait foi **côté serveur uniquement** |
| `Delivery` | `orderId` unique ; horodatages par étape ; `closureMode` mesure les clôtures d'exception |
| `DeliveryOtp` | `codeHash` (vérification) **et** `codeCipher` (relecture par le client) ; historique conservé, jamais écrasé |
| `DeliveryLocation` | `@@unique([deliveryId, recordedAt])` — déduplique les rejeux hors ligne ; index descendant pour « dernière position connue » |

### Producteurs, divers

`Producer`, `Farm`, `Production` (déclaration → vérification → réception),
`Notification`, `FileAsset`, `CompanySetting`.

### ⚠️ Tables mortes

`Cart` et `CartItem` sont modélisées, migrées, indexées et **jamais utilisées** :
le panier vit dans le store Zustand du mobile. Unique occurrence dans tout le
code :

```
auth.service.ts:226:  this.prisma.db.cart.deleteMany({ where: { userId } })
```

Conservées (un `DROP` est irréversible et sans bénéfice), mais **elles ne
servent à rien**. Ne pas s'appuyer dessus.

### Intégrité vérifiée

| Contrôle | Résultat |
| --- | --- |
| Modèles Prisma ↔ tables des migrations | **24 ↔ 24**, aucun orphelin |
| Champs scalaires ↔ colonnes migrées | **aucun écart** |
| Clés étrangères | déclarées sur toutes les relations |
| `onDelete: Cascade` | sur les dépendances vraies (items, otp, traces, jetons) ; **absent** sur `Order.user`, `Order.address`, `OrderItem.variant` — volontaire : on ne supprime pas une commande parce qu'un produit disparaît |
| Index | présents sur les colonnes de filtre réelles (`[userId, status]`, `[status, createdAt]`, `[courierId, status]`…) |
| Unicités métier | `phone`, `reference`, `idempotencyKey`, `sku`, `sourceRef`, `sourceCode`, `tokenHash` |

Aucune contrainte `CHECK` en base : les bornes (quantité > 0, prix ≥ 0) sont
tenues par la validation `class-validator` et les schémas Zod. **Le site, lui,
a des `CHECK`** — voir §2. Écart à noter : côté application, une écriture qui
contournerait l'API ne serait arrêtée par rien.

---

## 2. Base du site — PostgreSQL en production, SQLite en développement

21 tables, nommées **en français**, créées à chaud par `CREATE TABLE IF NOT
EXISTS` (pas de migrations versionnées).

| Table | Correspondance dans l'application |
| --- | --- |
| `gammes` | `Category` / `Product` |
| `produits` | `ProductVariant` (c'est la table des **variantes**) |
| `promotions` | *(aucune — le site envoie le prix déjà promotionné)* |
| `images_produit` | *(aucune)* |
| `clients` | `User` (rôle `CLIENT`) |
| `utilisateurs` | `User` (personnel) |
| `commandes` | `Order` |
| `lignes_commande` | `OrderItem` |
| `mouvements_stock` | *(aucune — l'application n'a pas de journal de stock)* |
| `notifications` | `Notification` (sens différent : SMS/WhatsApp envoyés) |
| `factures` | *(aucune)* |
| `avis`, `avis_reactions` | `ProductReview` |
| `journal` | `OrderEvent` (partiellement) |
| `parametres` | `CompanySetting` |
| `documents`, `sauvegardes` | *(aucune)* |
| `tournees` | `Delivery` (bien plus pauvre : un relevé, pas une machine à états) |
| `sessions` | `RefreshToken` |
| `paniers_abandonnes`, `infolettre`, `favoris` | *(aucune)* |

### Particularités structurelles

- Clés primaires **`INTEGER AUTOINCREMENT`**, pas des UUID. Les identifiants
  ne sont donc pas comparables d'une base à l'autre : le rapprochement se
  fait par `reference` / `sourceRef`, jamais par `id`.
- Horodatages en **`TEXT`** (`datetime('now')`), pas en `timestamptz`. D'où
  les précautions `NULLIF(colonne,'')` avant cast dans le traducteur.
- Booléens en **`INTEGER CHECK (x IN (0,1))`**.
- Contraintes **`CHECK`** réelles sur les prix, stocks, quantités et notes :
  `prix >= 0`, `stock >= 0`, `quantite > 0`, `format_kg > 0`. L'intégrité ne
  repose pas seulement sur l'API — c'est mieux que côté application.
- Séquences PostgreSQL **resynchronisées explicitement** après tout chargement
  à identifiants imposés (`ressynchroniser_sequences`) : sans cela, le premier
  `INSERT` suivant échouerait en doublon.

### Le point de vigilance principal

Le schéma est écrit **en dialecte SQLite** et traduit à la volée vers
PostgreSQL par expressions régulières (`dialecte.py`, 235 requêtes
concernées). Le moteur utilisé en développement **n'est donc pas celui qui
sert les clients**.

Ce choix est assumé et documenté (réversibilité en trente secondes), et
couvert par `test_migration_postgres.py`. Il reste que `INSERT OR REPLACE`
n'a pas d'équivalent générique : il est traduit en `ON CONFLICT DO NOTHING`
avec un simple avertissement journalisé — chaque usage doit être vérifié à la
main.

**Recommandation** : faire tourner la suite de tests du site **aussi** contre
un PostgreSQL, en intégration continue.

---

## 3. Ce qui n'est PAS partagé

| Donnée | Conséquence concrète |
| --- | --- |
| **Stock** | Le même sac peut être vendu deux fois. Voir `AUDIT-FOUNDATIONS.md` §2. |
| **Comptes clients** | Un client du site ne peut pas se connecter à l'application. |
| **Commandes** | Une commande web n'apparaît pas dans l'application, et l'inverse. |
| **Avis** | Deux corpus d'avis sur le même riz. |
| **Journal** | Deux pistes d'audit disjointes. |

Ce qui **est** partagé : le catalogue, les prix et les promotions (le site en
est propriétaire, l'application en tient une copie rafraîchie toutes les 15
minutes et relue au checkout), et la messagerie SMS/WhatsApp.

---

## 4. Règles d'exploitation

1. **Aucune écriture directe en production.** Toute modification du schéma de
   l'application passe par `prisma migrate` ; la migration est relue,
   appliquée sur une copie, testée, puis déployée.
2. **Ne jamais créer une troisième base.** Ni pour le mobile, ni pour le site,
   ni pour un back office.
3. **Sauvegarder avant toute migration** qui supprime ou renomme.
4. **Après tout chargement à identifiants imposés côté site**, appeler
   `ressynchroniser_sequences()`.
5. **Les comptes de développement du seed** (`0700000001`…) ne doivent
   **jamais** être créés en production.

## 5. Procédure de migration (application)

```bash
cd apps/api
npx prisma migrate dev --name <nom_explicite>   # développement
npx prisma migrate status                        # vérifier l'écart
npx prisma migrate deploy                        # production
npm run test                                     # les 20 suites
```

Avant : analyser l'impact, sauvegarder si la migration détruit. Après :
vérifier que l'API démarre, que la synchronisation du catalogue passe, et que
la suite e2e est verte.
