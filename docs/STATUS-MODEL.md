# Modèle de statuts — AGRIM / RIZ BOAGNI

> Vocabulaire officiel. Toute valeur absente de ce document est un défaut.
> Établi le 28 août 2026 par lecture du code des deux plateformes.

## Le constat qui rend ce document nécessaire

Les deux plateformes nomment **les mêmes états avec des mots différents**, et
n'ont même pas le même nombre d'états. Aucune valeur n'est commune.

| Site (`config.py:STATUTS`) | Application (`Prisma OrderStatus`) |
| --- | --- |
| `en_attente_paiement` | `PENDING` |
| — | `CONFIRMED` |
| `a_preparer` | — |
| `en_preparation` | `PREPARING` |
| — | `READY` |
| `en_livraison` | `OUT_FOR_DELIVERY` |
| `livree` | `DELIVERED` |
| `annulee` | `CANCELLED` |

6 valeurs contre 7. Un gestionnaire qui lit « en livraison » sur le site et
« OUT_FOR_DELIVERY » dans l'application ne peut pas savoir, sans ce tableau,
qu'il regarde la même chose.

---

## 1. Statut de commande — vocabulaire officiel

La liste de l'**application** fait référence : c'est la plus fine, elle est
adossée à une machine à états vérifiée côté serveur, et chaque transition est
journalisée (`OrderEvent`).

| Statut officiel | Signification | Stock retenu | Site correspondant |
| --- | --- | --- | --- |
| `PENDING` | Commande reçue, paiement non confirmé | ✅ | `en_attente_paiement` |
| `CONFIRMED` | Paiement confirmé par le serveur | ✅ | `a_preparer` |
| `PREPARING` | En cours de préparation | ✅ | `en_preparation` |
| `READY` | Prête à partir | ✅ | *(absent — voir §1.2)* |
| `OUT_FOR_DELIVERY` | Le livreur est en route | ✅ | `en_livraison` |
| `DELIVERED` | Remise faite, validée par code | ❌ | `livree` |
| `CANCELLED` | Annulée, stock rendu | ❌ | `annulee` |

**« Stock retenu »** est la colonne qui compte pour l'intégrité : elle définit
`STOCK_HELD_STATUSES` dans `apps/api/src/common/stock/order-stock.ts`. Sortir
de cet ensemble rend la marchandise au rayon — une seule fois.

### 1.1 Qui a le droit de faire quoi

| Transition | Auteur |
| --- | --- |
| → `PENDING` | le système, à la création |
| → `CONFIRMED` | le **paiement** (webhook ou réconciliation), jamais un humain |
| → `PREPARING`, `READY` | le gestionnaire |
| → `OUT_FOR_DELIVERY` | la **livraison**, quand le livreur part |
| → `DELIVERED` | le **backend**, après vérification du code du client. Ni le livreur, ni le gestionnaire ne peuvent l'écrire directement |
| → `CANCELLED` | le client (jusqu'à `READY` inclus), le gestionnaire (même limite), ou l'échec du paiement |

`OUT_FOR_DELIVERY` est délibérément **exclu** de l'annulation par le client et
par le bureau (`CLIENT_CANCELLABLE_STATUSES`) : la marchandise est partie.
Passé ce point, la sortie se fait par le terrain — le livreur clôt la course
en échec — pas par un bouton.

### 1.2 Le cas `READY` / `a_preparer`

Les deux listes ne se recouvrent pas exactement, et c'est **justifié** :

- `a_preparer` (site) et `CONFIRMED` (app) désignent la même chose : payé,
  pas encore touché. Deux noms, un état.
- `READY` n'a pas d'équivalent site : le site n'a pas d'étape « préparée,
  en attente du livreur » parce qu'il n'a pas de tournée modélisée.

**Règle de conversion** le jour où les commandes seront unifiées :
`READY` → `en_preparation` côté site (la commande est toujours au dépôt).
Jamais `en_livraison` : personne n'est parti.

---

## 2. Statut de livraison (application uniquement)

Le site n'a pas d'équivalent : il porte un `livreur_id` sur la commande et une
table `tournees` de relevés, pas une machine à états.

| Statut | Signification | Qui l'écrit |
| --- | --- | --- |
| `UNASSIGNED` | Course créée, sans livreur | système |
| `ASSIGNED` | Affectée à un livreur | gestionnaire |
| `ACCEPTED` | Le livreur a pris la course | livreur |
| `IN_TRANSIT` | En route | livreur |
| `ARRIVED` | Sur place | livreur |
| `OTP_VERIFIED` | Code du client vérifié | **backend seul** |
| `DELIVERED` | Remise close | **backend seul** |
| `FAILED` | Échec (porte close…), motif obligatoire | livreur |

Frontière de responsabilité : le terrain fait avancer la course **jusqu'à
l'arrivée**, jamais au-delà. `OTP_VERIFIED` et `DELIVERED` n'appartiennent
qu'au backend (`isCourierSettable`). C'est ce qui rend la validation par code
opposable.

`FAILED` est **réassignable** : c'est la seconde tentative après une porte
close, et la commande revient à `READY`.

---

## 3. Statut de paiement (application)

| Statut | Signification |
| --- | --- |
| `PENDING` | Créé, rien n'est parti |
| `AWAITING_CONFIRMATION` | Le client doit valider chez l'opérateur |
| `SUCCEEDED` | Encaissé — vérifié auprès du fournisseur, jamais cru sur parole |
| `FAILED` | Refusé |
| `EXPIRED` | Délai dépassé, stock rendu |
| `REFUNDED` | Remboursé |

`SUCCEEDED`, `FAILED`, `EXPIRED`, `REFUNDED` sont **terminaux** : un paiement
qui les atteint ne se règle plus (bascule conditionnelle dans
`PaymentsService.settle`).

Côté site, `commandes.paiement_statut` vaut `en_attente`, et le suivi détaillé
vit dans le journal — pas d'énumération équivalente.

**Invariant commun aux deux plateformes** : le statut de paiement fait foi
**côté serveur uniquement**. Aucun client, aucune application mobile ne peut
le décider.

---

## 4. Autres énumérations (application)

| Énumération | Valeurs |
| --- | --- |
| `PaymentMethod` | `MOBILE_MONEY`, `CARD`, `CASH_ON_DELIVERY` |
| `MobileMoneyProvider` | `ORANGE_MONEY`, `MTN_MOMO`, `MOOV_MONEY`, `WAVE` |
| `DeliveryClosureMode` | `CLIENT_OTP` (nominal), `MANAGER_OVERRIDE` (exception, motif obligatoire) |
| `ProductionStatus` | `DECLARED`, `CONFIRMED`, `RECEIVED`, `REJECTED` |
| `NotificationType` | 13 valeurs, voir `schema.prisma` |

Côté site, `OPERATEURS` vaut `wave`, `orange`, `mtn`, `moov`, `especes` —
**en minuscules et abrégés**. Correspondance à établir le jour où un paiement
traversera la frontière :

| Site | Application |
| --- | --- |
| `wave` | `WAVE` |
| `orange` | `ORANGE_MONEY` |
| `mtn` | `MTN_MOMO` |
| `moov` | `MOOV_MONEY` |
| `especes` | `CASH_ON_DELIVERY` (méthode, pas opérateur) |

---

## 5. Disponibilité d'un produit — la règle unique

Trois définitions coexistaient ; il n'en reste qu'une (voir
`AUDIT-FOUNDATIONS.md` §2). Le site distingue deux refus de vente :

| Champ du site | Sens |
| --- | --- |
| `actif = 0` | retirée du catalogue |
| `disponibilite = 'rupture'` | **rupture déclarée** : il en reste, on n'en vend plus |
| `stock` | la quantité, propre à chaque plateforme |

Ce qui franchit la frontière :

| Clé exposée | Formule | Usage |
| --- | --- | --- |
| `vendable` | `actif ET disponibilite ≠ 'rupture'` | ce que l'application copie dans `ProductVariant.isAvailable` |
| `disponible` | `actif ET stock > 0 ET disponibilite ≠ 'rupture'` | affichage côté site |

**`vendable` ne dépend pas du stock**, et c'est délibéré : tant que chaque
plateforme tient son propre compteur, transmettre une disponibilité fondée sur
le stock du site fermerait ici un rayon peut-être encore garni.

Le jour où le stock aura un propriétaire unique (phase 2 de
`ARCHITECTURE.md`), les deux clés fusionneront.

---

## 6. Règle de vie

> Une valeur de statut ne se renomme pas. Elle se **traduit** au passage de
> la frontière, dans une table de correspondance unique — jamais par des
> `if` disséminés.

Toute nouvelle valeur s'ajoute **d'abord ici**, puis dans
`packages/contracts/src/enums.ts`, puis dans une migration Prisma, puis dans
le code. Dans cet ordre.
