# Contrat d'API — AGRIM / RIZ BOAGNI

> État réel au 28 août 2026. Les deux API sont décrites, puis le contrat
> d'intégration qui les relie.
> Documentation vivante de l'application : `/api/v1/docs` (Swagger).

## 0. Deux API, deux publics

| | Site (FastAPI) | Application (NestJS) |
| --- | --- | --- |
| Base | `https://agrim-zuxe.onrender.com` | `…/api/v1` |
| Public | navigateur, back office | application Expo |
| Routes | 145 | 67 |
| Langue des chemins | **français** (`/api/produits`) | **anglais** (`/products`) |
| Authentification | jeton opaque (`Authorization: Bearer` ou cookie `rb_session`) | JWT d'accès (15 min) + refresh (30 j) |

**Elles ne servent pas le même besoin et n'ont pas à être identiques.**
La question de l'étape 5 — *`POST /products` doit-il se comporter pareil des
deux côtés ?* — a une réponse nette :

> **Non, et c'est voulu.** Le site **possède** le catalogue : lui seul crée,
> modifie et supprime un produit. L'application n'expose **aucune** écriture
> de catalogue — elle n'a ni `POST /products`, ni `PUT`, ni `DELETE`. Deux
> écrivains sur la même donnée, ce serait exactement la divergence que cette
> étape cherche à supprimer.

Ce qui doit être identique, ce n'est pas la forme des routes : c'est le
**résultat métier**. Même prix, même disponibilité, mêmes statuts, mêmes
droits.

---

## 1. Conventions de l'API de l'application

### Réponse d'erreur — format unique

```json
{
  "statusCode": 409,
  "code": "INSUFFICIENT_STOCK",
  "message": "Le stock disponible ne couvre plus votre panier.",
  "details": [{ "variantId": "…", "productName": "…", "available": 3 }]
}
```

Garanti par un filtre global : **aucune erreur technique brute n'atteint le
client**, et les 5xx sont journalisées avec leur pile sans jamais être
renvoyées. `code` est stable et destiné au programme ; `message` est destiné
à l'humain, en français.

### Codes HTTP

| Code | Emploi |
| --- | --- |
| `200` / `201` | succès |
| `400` | requête invalide, article indisponible |
| `401` | non authentifié, jeton expiré |
| `403` | rôle insuffisant (`FORBIDDEN_ROLE`) |
| `404` | introuvable — **aussi** quand l'existence ne doit pas être confirmée |
| `409` | conflit d'état : stock insuffisant, transition impossible, course déjà prise |
| `429` | quota dépassé |
| `503` | passerelle de paiement ou site injoignable |

> `404` plutôt que `403` sur les livraisons d'autrui : confirmer l'existence
> d'une course à un livreur qui n'y a pas droit serait déjà une fuite.

### Pagination

```json
{ "data": [ … ], "pagination": { "page": 1, "limit": 20, "total": 137 } }
```

### Montants et poids

Entiers. XOF sans décimale, grammes entiers. Aucun flottant nulle part.

---

## 2. Endpoints de l'application

Rôles indiqués tels qu'appliqués par `RolesGuard`. « — » = tout compte
authentifié.

### Authentification — `/auth`

| Méthode | Chemin | Accès |
| --- | --- | --- |
| POST | `/auth/register` | public |
| POST | `/auth/login` | public |
| POST | `/auth/refresh` | public (jeton de refresh) |
| POST | `/auth/logout` | — |
| GET | `/auth/me` | — |
| POST | `/auth/me/delete` | — |
| POST | `/auth/change-password` | — |
| POST | `/auth/forgot-password` | public |
| POST | `/auth/reset-password` | public |

Refresh **avec rotation** : présenter un jeton déjà consommé invalide toutes
les sessions du compte (`REFRESH_TOKEN_REUSED`) — c'est la détection de vol.

### Catalogue (lecture seule) — `/products`, `/categories`

| Méthode | Chemin | Accès |
| --- | --- | --- |
| GET | `/products` | public |
| GET | `/products/:slug` | public |
| GET | `/categories` | public |
| GET | `/products/:slug/reviews` | public |
| POST | `/products/:slug/reviews` | — |

**Aucune écriture de catalogue.** Voir §0.

### Adresses — `/addresses`

`GET`, `POST`, `PUT /:id`, `DELETE /:id` — le propriétaire uniquement.

### Commandes — `/orders`

| Méthode | Chemin | Accès |
| --- | --- | --- |
| POST | `/orders` | — |
| GET | `/orders` | — |
| GET | `/orders/:reference` | — |
| GET | `/orders/:reference/tracking` | — |
| POST | `/orders/:reference/cancel` | — |

**`POST /orders`** est le point le plus chargé de garanties :

1. `idempotencyKey` (UUID fourni par le client) rend l'appel **rejouable** :
   un réseau qui coupe ne crée pas deux commandes ;
2. les **prix viennent de la base**, jamais du corps de la requête ;
3. la cotation est **relue sur le site** au moment du paiement — et une
   référence que le site vient de retirer de la vente est refusée
   (`VARIANT_UNAVAILABLE`), sauf si le site est injoignable, auquel cas la
   vente passe ;
4. stock, compteur de référence, commande et paiement sont écrits **dans une
   seule transaction**, avec décrément conditionnel du stock.

Erreurs propres : `INSUFFICIENT_STOCK` (409, avec le détail par ligne),
`VARIANT_UNAVAILABLE` (400), `IDEMPOTENCY_KEY_CONFLICT` (409),
`ORDER_NOT_CANCELLABLE` (409).

### Paiements — `/payments`

| Méthode | Chemin | Accès |
| --- | --- | --- |
| GET | `/payments/provider` | public |
| POST | `/payments/orders/:reference/initiate` | — |
| GET | `/payments/orders/:reference` | — |
| POST | `/payments/callback/:provider` | **public**, authentifié par signature |

Le webhook est public parce que l'appelant n'a pas de JWT ; son authenticité
est établie par la signature du fournisseur. Un succès annoncé n'est **jamais
cru sur parole** : l'API revérifie auprès du fournisseur avant d'encaisser.

### Livraisons — `/deliveries`

| Méthode | Chemin | Accès |
| --- | --- | --- |
| GET | `/deliveries/mine` | `LIVREUR` |
| GET | `/deliveries/:id` | `LIVREUR` |
| PATCH | `/deliveries/:id/status` | `LIVREUR` |
| POST | `/deliveries/:id/verify-otp` | `LIVREUR` |
| GET | `/deliveries/:id/otp-status` | `LIVREUR` |
| POST | `/deliveries/locations` | `LIVREUR` |
| GET | `/deliveries/:id/route` | `LIVREUR` |
| GET | `/deliveries/orders/:reference/otp` | `CLIENT` |
| POST | `/deliveries/orders/:reference/otp/resend` | `CLIENT` |
| POST | `/deliveries/orders/:reference/assign` | `GESTIONNAIRE`, `ADMIN`, `DG` |
| POST | `/deliveries/orders/:reference/close` | `GESTIONNAIRE`, `ADMIN` |

Le code n'est lisible que par **son propriétaire, le client**. Aucune route
livreur n'y donne accès : le livreur le saisit sous la dictée.

### Gestion — `/management`

`GET /dashboard`, `GET /orders`, `GET /orders/:reference`,
`PATCH /orders/:reference/status`, `GET /stock`, `PATCH /stock/:variantId`,
`GET /couriers` — `GESTIONNAIRE`, `ADMIN`, `DG`.

### Autres

| Domaine | Chemins | Accès |
| --- | --- | --- |
| Producteurs | `/producers/me/**` | `PRODUCTEUR` |
| Revue de production | `/producers/productions/**` | `GESTIONNAIRE`, `ADMIN`, `DG` |
| Direction | `/analytics/dashboard` | `DG`, `ADMIN` |
| Synchronisation | `/catalog-sync`, `/catalog-sync/diff` | `ADMIN`, `DG` |
| Notifications | `/notifications`, `/notifications/tokens` | — |
| Parrainage | `/referrals/me` | — |
| Santé, mentions | `/health`, `/legal/**` | public |

---

## 3. Endpoints du site (résumé)

145 routes. Les familles :

| Famille | Chemins | Accès |
| --- | --- | --- |
| Boutique | `/api/produits`, `/api/panier/calculer`, `/api/commandes` | public |
| Espace client | `/api/client/**` | session client |
| Avis | `/api/produits/{id}/avis`, `/api/avis/**` | public / client |
| Paiement | `/api/paiement/**` | public + callback |
| Authentification | `/api/auth/**` | public / personnel |
| Back office | `/api/admin/**` (~90 routes) | matrice de permissions |
| Livreur | `/api/livreur/**` | `livreur` |
| **Intégration** | `/api/integration/**` | **jeton partagé** |

---

## 4. Le contrat d'intégration — le seul lien réel

Authentification : en-tête `X-Sync-Token` (ou `Authorization: Bearer`),
comparé **en temps constant sur des empreintes**. Sans jeton configuré côté
site, l'intégration répond `503` — elle est désactivée, pas ouverte.

### `GET /api/integration/catalogue` — site → application

Le catalogue complet. Consommé toutes les 15 minutes par `CatalogSyncService`.

```json
{
  "genere_le": "2026-08-28T18:00:00Z",
  "marque": "RIZ BOAGNI",
  "devise": "F CFA",
  "gammes": [
    { "code": "DJA", "nom": "Djassa", "slug": "djassa",
      "description_courte": "…", "description": "…",
      "ordre": 1, "actif": true, "image_url": "" }
  ],
  "produits": [
    { "reference": "RB-DJA-05", "sku": "DJ5",
      "gamme_code": "DJA", "gamme_nom": "Djassa", "gamme_slug": "djassa",
      "nom": "Djassa 5 kg", "format": "Sac de 5 kg",
      "poids_grammes": 5000,
      "prix": 2250, "prix_barre": null, "en_promotion": false,
      "stock": 118, "seuil_alerte": 10,
      "actif": true,
      "vendable": true,
      "disponibilite": "auto",
      "disponible": true,
      "badge": "", "couleur": "", "image_url": "" }
  ],
  "total": 14
}
```

**Deux principes gouvernent ce format.**

1. **Rien n'est calculé côté application.** `prix` est **déjà** le prix
   effectif — le site a appliqué la promotion. L'application n'a aucune règle
   de prix à connaître, elle ne peut donc pas les interpréter autrement.
2. **La clé est `reference`**, jamais le nom, le sku ni la position. Renommer
   une gamme dans le back office ne crée pas de doublon côté application.

**Les trois clés de disponibilité** (ajoutées à l'audit d'août 2026) :

| Clé | Formule | Ce que l'application en fait |
| --- | --- | --- |
| `actif` | la référence est au catalogue | *(historique)* |
| `vendable` | `actif ET disponibilite ≠ 'rupture'` | **copié dans `ProductVariant.isAvailable`** |
| `disponible` | `vendable ET stock > 0` | ignoré : le stock du site n'est pas celui de l'application |

`vendable` est **volontairement indépendant du stock** : tant que chaque
plateforme tient son propre compteur, transmettre une disponibilité fondée
sur le stock du site fermerait ici un rayon peut-être encore garni.

**Compatibilité** : `vendable` et `disponibilite` sont facultatifs. Un site
non redéployé n'en envoie pas, et l'application retombe sur `actif`.

### `POST /api/integration/prix` — site → application

Relu **à chaque passage en caisse**, pour couvrir la fenêtre de 0 à 15 minutes
entre deux synchronisations.

Requête : `{ "references": ["RB-DJA-05", …] }` — 50 au maximum.

```json
{
  "genere_le": "…", "devise": "F CFA",
  "prix": {
    "RB-DJA-05": { "prix": 2250, "prix_barre": null,
                   "en_promotion": false,
                   "disponible": true, "vendable": true, "actif": true },
    "RB-XXX-99": null
  }
}
```

`null` = référence inconnue du site : l'application retombe sur son prix local.

**Dégradation prévue** : site injoignable ou en erreur ⇒ l'application vend au
prix local **non promotionnel** (`originalPrice` s'il existe) et **n'empêche
aucune vente**. Une panne du site ne doit pas fermer la boutique.

### `POST /api/integration/message` — application → site

Le site est le service de messagerie des deux plateformes : un seul crédit
SMS, un seul journal, un seul jeu de clés d'agrégateur. Le **push** reste
propre à l'application.

```json
{ "canal": "sms", "destinataire": "0700000001",
  "message": "…", "evenement": "commande_confirmee",
  "cle_unicite": "AGR-2026-0001-confirmee", "origine": "app" }
```

Garde-fous : `cle_unicite` empêche le doublon (un SMS se paie) ; les
événements sensibles (`otp`, `code_livraison`, `mot_de_passe`…) sont
**interdits** — un jeton qui fuit ne doit pas permettre d'envoyer un faux
code sous le sender ID d'AGRIM ; plafond de 60 SMS par 5 minutes.

Réponse `200` même si l'opérateur a refusé : l'appelant **ne doit pas
rejouer**, l'échec est enregistré et se renvoie depuis le back office.

### `GET /api/integration/livraison` — site → application

La grille officielle des frais de livraison. **Décision métier du 29 août
2026 : le site fait foi**, comme pour la grille produits.

```json
{
  "genere_le": "2026-08-29T10:51:14Z",
  "devise": "F CFA",
  "zones": {
    "yamoussoukro": { "libelle": "Yamoussoukro", "frais": 1000, "delai": "24 h" },
    "abidjan":      { "libelle": "Abidjan",      "frais": 3500, "delai": "48 h" },
    "bouake":       { "libelle": "Bouaké",       "frais": 3000, "delai": "48 h" },
    "autre":        { "libelle": "Autre ville",  "frais": 5000, "delai": "72 h" }
  },
  "zone_par_defaut": "autre",
  "retrait": { "libelle": "Retrait au dépôt", "frais": 0, "delai": "2 h" },
  "livraison_offerte_seuil_kg": 75
}
```

Ce qui traverse la frontière est la **règle**, pas un montant calculé :
l'appelant combine zone, mode et poids avec `computeDeliveryFee`
(`@agrim/contracts/delivery`). L'application ne contient plus aucun tarif.

La zone se déduit de la ville de l'adresse (`resolveDeliveryZone`), accents et
casse ignorés. Une ville inconnue tombe dans `zone_par_defaut` — **jamais dans
la moins chère** : une faute de frappe ne doit pas devenir une remise.

**Dégradation** : l'API garde une copie de la grille (en mémoire et dans
`CompanySetting`) et la renvoie immédiatement, en rafraîchissant en arrière-plan.
Une commande n'attend donc jamais le site. Sans aucune grille connue —
installation neuve, site jamais joint — la commande est refusée
(`DELIVERY_GRID_UNAVAILABLE`, 503) plutôt que facturée à un tarif inventé.

### Réservation de stock — app → site

Depuis le 29 août 2026, **le site possède le stock**. L'application ne tient
plus de compteur concurrent : elle réserve, elle ne décide pas.

| Endpoint | Objet |
| --- | --- |
| `POST /api/integration/stock/reserver` | réserver à la création de commande |
| `POST /api/integration/stock/confirmer` | figer la réservation : la vente est actée |
| `POST /api/integration/stock/liberer` | rendre le stock à l'annulation |
| `GET /api/integration/stock/{reference}` | état des réservations, pour l'audit |

```json
// POST /api/integration/stock/reserver
{ "reference": "<idempotencyKey de la commande>",
  "origine": "app",
  "lignes": [ { "reference_produit": "RB-DIE-05", "quantite": 2 } ] }
```

**La clé est l'`idempotencyKey` de la commande, pas sa référence** : celle-ci
n'existe qu'une fois le compteur annuel incrémenté, donc trop tard. Cette clé
vient du client, elle est unique par tentative, et c'est déjà elle qui empêche
le doublon de commande.

| Code | Sens |
| --- | --- |
| `200` | réservé — ou `rejeu: true` si la même clé avait déjà réservé |
| `409` | **refus métier** : stock insuffisant, référence retirée de la vente |
| `422` | quantité hors bornes (1 à 500) |
| `401` | jeton d'intégration invalide |

**Tout ou rien** : une seule ligne insuffisante annule la réservation entière.
Livrer une commande à moitié réservée serait pire que la refuser.

**Idempotence des deux côtés** : rejouer une réservation ne retire pas le stock
deux fois ; rejouer une libération ne le rend pas deux fois. La seconde
garantie compte autant que la première — du stock rendu en trop est du stock
inventé.

**Enchaînement côté application** (`OrdersService.create`) :

```
réserver (hors transaction, appel réseau)
   ↓ refus 409 → INSUFFICIENT_STOCK, aucune commande créée
   ↓ site injoignable → STOCK_SERVICE_UNAVAILABLE (503), aucune commande créée
transaction { compteur · journal du mouvement · commande · paiement }
   ↓ échec → libérer (compensation)
confirmer
```

L'API refuse de vendre un stock qu'aucun système ne lui a accordé : une vente
perdue est réparable, un sac vendu deux fois ne l'est pas.

---

## 5. Formes de données — correspondance

Le même concept ne porte pas le même nom des deux côtés. Table de
correspondance officielle :

| Concept | Site | Application |
| --- | --- | --- |
| Gamme | `gammes.code`, `.nom`, `.ordre`, `.actif` | `Category` / `Product` : `sourceCode`, `name`, `sortOrder`, `isActive` |
| Variante | `produits.reference`, `.prix`, `.prix_barre`, `.stock`, `.format_kg` | `ProductVariant` : `sourceRef`, `price`, `originalPrice`, `stock`, `weightGrams` |
| Client | `clients.telephone`, `.nom` | `User.phone`, `.firstName` + `.lastName` |
| Commande | `commandes.reference`, `.statut`, `.total`, `.frais_livraison` | `Order.reference`, `.status`, `.total`, `.deliveryFee` |
| Ligne | `lignes_commande.designation`, `.prix_unitaire`, `.quantite` | `OrderItem.productName`, `.unitPrice`, `.quantity` |
| Livraison | `commandes.livreur_id` + `tournees` | `Delivery` (machine à états) |
| Avis | `avis.note`, `.commentaire` | `ProductReview.rating`, `.comment` |

**Différence de fond** : le poids est en **kg entiers** côté site
(`format_kg`) et en **grammes** côté application (`weightGrams`). La
conversion se fait dans le payload d'intégration (`poids_grammes`), jamais
ailleurs : 22,5 kg = `22500`, jamais `22.5`.

---

## 6. Règles à tenir

1. **Un endpoint qui écrit une donnée n'existe que chez son propriétaire.**
2. **Ce qui traverse la frontière est une décision, pas des ingrédients.**
3. **Tout nouveau champ d'intégration est facultatif à sa naissance**, avec un
   repli explicite — les deux plateformes ne se déploient pas ensemble.
4. **Un `code` d'erreur ne se renomme jamais** : le mobile s'en sert pour
   décider quoi afficher.
5. **Aucune règle de calcul n'est réimplémentée côté client** : elle vit dans
   `@agrim/contracts` ou chez son propriétaire.
