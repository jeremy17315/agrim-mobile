# Architecture — AGRIM / RIZ BOAGNI

> État réel au 28 août 2026, puis cible retenue et justifiée.
> Ce document décrit **ce que fait le code**, pas une intention.

## 1. L'architecture réelle aujourd'hui

```
┌──────────────────┐                    ┌──────────────────────┐
│   NAVIGATEUR     │                    │   APPLICATION EXPO   │
│  (boutique web   │                    │  (React Native)      │
│   + back office) │                    │                      │
└────────┬─────────┘                    └──────────┬───────────┘
         │ HTTP                                    │ HTTP
         ▼                                         ▼
┌──────────────────────────┐            ┌──────────────────────────┐
│        SITE              │            │        API MOBILE        │
│   FastAPI · Python       │            │   NestJS · TypeScript    │
│   145 routes             │            │   67 routes              │
│                          │            │                          │
│  catalogue · promotions  │◀──────────▶│  commandes · livraisons  │
│  commandes web · avis    │  3 points  │  OTP · paiements mobile  │
│  factures · SMS/WhatsApp │  d'intégr. │  producteurs · direction │
└───────────┬──────────────┘            └────────────┬─────────────┘
            │ SQL                                    │ Prisma
            ▼                                        ▼
┌──────────────────────────┐            ┌──────────────────────────┐
│  BASE DU SITE            │            │  BASE DE L'APPLICATION   │
│  PostgreSQL (prod)       │            │  PostgreSQL 17 (Neon)    │
│  SQLite (développement)  │            │                          │
│  21 tables, en français  │            │  24 tables, en anglais   │
└──────────────────────────┘            └──────────────────────────┘
```

**Deux bases. Aucune table commune. Aucune ligne partagée.**

Neuf concepts métier sont modélisés deux fois :

| Concept | Site | Application |
| --- | --- | --- |
| Compte client | `clients` | `User` |
| Commande | `commandes` | `Order` |
| Ligne de commande | `lignes_commande` | `OrderItem` |
| Catalogue | `produits` · `gammes` | `Product` · `ProductVariant` · `Category` |
| Stock | `produits.stock` + `mouvements_stock` | `ProductVariant.stock` |
| Paiement | `commandes.paiement_statut` | `Payment` |
| Livraison | `tournees` · `commandes.livreur_id` | `Delivery` · `DeliveryOtp` |
| Avis | `avis` | `ProductReview` |
| Personnel | `utilisateurs` | `User` (rôles) |

### Le seul lien réel

Trois points d'intégration HTTP, un jeton partagé
(`RB_SYNC_TOKEN` côté site = `SITE_INTEGRATION_TOKEN` côté application),
comparé en temps constant :

| Endpoint | Sens | Propriétaire | Fréquence |
| --- | --- | --- | --- |
| `GET /api/integration/catalogue` | site → app | le **site** possède le catalogue | toutes les 15 min |
| `POST /api/integration/prix` | site → app | le **site** possède le prix | à chaque checkout |
| `POST /api/integration/message` | app → site | le **site** possède la messagerie | à chaque SMS |

Le push reste propre à l'application : c'est son canal, et il est gratuit.

### Ce que cette architecture garantit — et ce qu'elle ne garantit pas

**Garanti** : le catalogue, les prix et les promotions sont cohérents à
quinze minutes près, et exacts au centime au moment du paiement (la cotation
est relue en direct).

**Non garanti** : le stock, les comptes clients, les commandes, les statuts,
les tarifs de livraison, les remises. Un client inscrit sur le site ne peut
pas se connecter à l'application ; sa commande web n'y apparaît pas ; et le
même sac physique peut être vendu deux fois.

---

## 2. Les options examinées

L'énoncé en proposait quatre. Les voici confrontées au code réel.

### Option A — Deux backends, une base partagée, services communs

**Écartée.** Deux raisons, dont la seconde est rédhibitoire :

1. Les deux services sont écrits dans deux langages. « Des services métier
   communs » entre Python et TypeScript n'existent pas sans un troisième
   composant — ce qui ajoute une pièce au lieu d'en retirer.
2. Partager une base entre deux codes est un piège classique : deux
   applications écrivent dans les mêmes tables, **personne ne possède les
   règles**, et une migration de l'une casse l'autre en silence. Le site
   crée d'ailleurs son schéma à chaud (`CREATE TABLE IF NOT EXISTS`) là où
   l'application le fait par migrations versionnées : les deux mécanismes ne
   peuvent pas gouverner la même base.

### Option B — L'application consomme les API du site pour les domaines communs

**Retenue comme trajectoire.** C'est déjà ce que fait le code pour le
catalogue, les prix et la messagerie, et ça fonctionne. L'étendre au **stock**
règle le problème le plus coûteux sans rien réécrire.

### Option C — Deux façades cohérentes sur une même couche de données

C'est la **destination**, pas la prochaine étape. Elle suppose qu'un seul des
deux systèmes possède chaque donnée — ce qui est précisément le travail de
l'option B, mené jusqu'au bout.

### Option D — Une autre architecture

**Retenue sous une forme précise** : « un propriétaire par domaine ».
Ni fusion des bases, ni statu quo. Détail ci-dessous.

---

## 3. Architecture cible retenue

> **Une donnée, un propriétaire, un seul écrivain. Les autres demandent.**

Le principe n'est pas « une base » mais « un **serveur** par domaine ». C'est
le modèle des grandes places de marché : l'application et le site n'y sont pas
deux logiciels qui se synchronisent, ce sont deux façades qui interrogent le
même propriétaire.

### Répartition des domaines

| Domaine | Propriétaire | Pourquoi lui |
| --- | --- | --- |
| **Catalogue** (gammes, formats, prix, promotions) | **SITE** | Le back office existe, il est utilisé, et c'est là que travaillent les gestionnaires. Déjà en place. |
| **Stock** | **SITE** | Le catalogue et le stock ne se séparent pas : c'est la même ligne d'inventaire. *À faire.* |
| **Messagerie** SMS/WhatsApp | **SITE** | Un seul crédit, un seul journal, un seul jeu de clés d'agrégateur. Déjà en place. |
| **Commandes, livraisons, OTP** | **APPLICATION** | Machines à états vérifiées, journal d'audit, validation par code chiffré, réconciliation. Le site n'a rien d'équivalent. |
| **Paiement mobile money** | **APPLICATION** | Webhook, vérification auprès du fournisseur, réconciliation des abandons. |
| **Identité client** | **un seul des deux**, à trancher | Le téléphone est déjà la clé des deux côtés. |
| **Règles de calcul** (panier, frais, remises) | **`@agrim/contracts`** pour l'app, `config.py` pour le site — **à unifier** | Voir `AUDIT-FOUNDATIONS.md` §2, P1. |

### Trajectoire, par ordre de valeur

**Phase 1 — aujourd'hui (fait dans cette étape)**
Fermer les fuites : restitution de stock idempotente, affectation sans course,
une seule définition de « en vente ». Documenter les divergences plutôt que
les corriger en silence.

**Phase 2 — le stock — ✅ FAITE le 29 août 2026**
Le site expose `reserver`, `confirmer`, `liberer` et l'état des réservations.
L'application les appelle et **ne tient plus son propre compteur** : sa colonne
`ProductVariant.stock` est devenue une COPIE, rafraîchie par la
synchronisation, et plus une source de vérité. La double vente est
structurellement impossible — le test de concurrence le prouve sur des
requêtes HTTP réellement simultanées.

Le point d'attention pressenti s'est confirmé et a été tranché autrement que
prévu : la réservation n'a PAS lieu dans la transaction de base. Un appel
réseau tenu à l'intérieur retiendrait des verrous PostgreSQL pendant toute la
latence du site. L'ordre retenu est donc : réserver → transaction → confirmer,
avec libération de compensation si la transaction échoue, et une expiration de
30 minutes comme filet si le processus tombe entre les deux.

Reste de la phase : le site n'est pas encore déployé avec ces endpoints (voir
`AUDIT-FOUNDATIONS.md` §9).

**Phase 3 — l'identité (~1 mois)**
Un seul service d'authentification, l'autre s'y adosse. Rapprochement par
téléphone. Le client retrouve son historique sur les deux canaux.

**Phase 4 — la cible**
Les commandes, quel que soit le canal, vivent au même endroit ; un seul back
office. Le site devient un client de l'API mobile, comme l'application.

### Ce qui n'est PAS la cible

- **Pas de migration FastAPI → NestJS** ni l'inverse. Les deux services
  fonctionnent ; les réécrire n'apporterait aucune cohérence supplémentaire
  et détruirait des mois de travail éprouvé.
- **Pas de base partagée.** Voir option A.
- **Pas de synchronisation bidirectionnelle.** Recopier dans les deux sens
  crée des conflits que personne ne sait arbitrer. Un propriétaire, une
  direction de flux.

---

## 4. Règles d'architecture à respecter désormais

1. **Une donnée n'a qu'un propriétaire.** Celui qui ne la possède pas la
   demande ; il ne la recalcule jamais.
2. **Une règle métier n'a qu'une implémentation.** Si les deux plateformes
   doivent l'appliquer, elle est exposée par son propriétaire ou vit dans
   `@agrim/contracts` — jamais écrite deux fois.
3. **Ce qui franchit la frontière est une décision, pas un calcul.** Le site
   envoie `prix` (déjà promotionné) et `vendable` (déjà arbitré), pas les
   ingrédients qui permettraient de les recalculer différemment.
4. **La panne du propriétaire ne ferme pas la boutique de l'autre.** Site
   injoignable ⇒ prix locaux conservés, vente autorisée. Une intégration qui
   transforme une panne partielle en panne totale est un défaut.
5. **Toute écriture concurrente passe par une bascule conditionnelle.**
   Lire puis écrire ne suffit pas en `READ COMMITTED` (voir
   `common/stock/order-stock.ts`).
6. **Le schéma de l'application ne change que par migration Prisma.**

---

## 5. Où vivent les choses (application)

```
apps/api/src/
├── auth/           JWT + refresh avec rotation, argon2
├── products/ categories/ reviews/      catalogue (copie du site)
├── catalog-sync/   la synchronisation et l'audit `diff`
├── orders/         création, annulation, suivi
├── payments/       initiation, webhook, réconciliation
├── deliveries/     tournée, statuts, OTP, trace GPS
├── management/     file du gestionnaire, stock, affectation
├── producers/ analytics/ referrals/ notifications/
├── common/
│   ├── guards/     RBAC serveur
│   ├── crypto/     chiffrement au repos
│   └── stock/      ← restitution de stock, point de passage unique
└── reconciliation/ balayages de fond

packages/contracts/  schémas Zod, énumérations, règles de calcul PARTAGÉES
apps/mobile/         Expo — src/api est le SEUL accès réseau
```
