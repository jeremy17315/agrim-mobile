# Authentification et autorisation — AGRIM / RIZ BOAGNI

> État réel au 28 août 2026, les deux plateformes confrontées.

## 1. Le point à comprendre en premier

**Les comptes ne sont pas partagés.** Un client inscrit sur le site ne peut
pas se connecter à l'application, et réciproquement. Ce ne sont pas deux vues
d'un même annuaire : ce sont deux annuaires.

| | Site | Application |
| --- | --- | --- |
| Clients | table `clients` | table `User` (rôle `CLIENT`) |
| Personnel | table `utilisateurs` | table `User` (autres rôles) |
| Identifiant | téléphone (clients), `identifiant` (personnel) | **téléphone** pour tous |
| Mot de passe | haché | **argon2** |
| Session | jeton opaque en table `sessions` | **JWT + refresh avec rotation** |
| Durée | 12 h (personnel), 48 h (client) | 15 min (accès) / 30 j (refresh) |

Le **téléphone est déjà la clé naturelle des deux côtés** : c'est par lui que
passera le rapprochement des comptes (phase 3 de `ARCHITECTURE.md`).

---

## 2. Les rôles

| Rôle | Site | Application | Remarque |
| --- | --- | --- | --- |
| Administrateur | `admin` | `ADMIN` | casse différente |
| Gestionnaire | `gestionnaire` | `GESTIONNAIRE` | |
| Livreur | `livreur` | `LIVREUR` | |
| Client | `client` | `CLIENT` | |
| Producteur | — | `PRODUCTEUR` | **n'existe pas côté site** |
| Direction générale | — | `DG` | **n'existe pas côté site** |

Le site n'a **aucun espace producteur ni direction** : ces deux rôles sont
propres à l'application, et c'est légitime — ils correspondent à des métiers
(déclaration de production, indicateurs consolidés) que le site ne couvre pas.

**Convention officielle** : les rôles s'écrivent en **MAJUSCULES**. La
conversion se fait au passage de la frontière, jamais ailleurs.

---

## 3. Comment l'autorisation est appliquée

### Application — RBAC par décorateur

```ts
@Roles('GESTIONNAIRE', 'ADMIN', 'DG')
@Get('dashboard')
```

`RolesGuard` (`common/guards/roles.guard.ts`) lit les rôles exigés et compare
au rôle du JWT. Aucune route protégée n'échappe au garde : celui-ci est
global, et l'ouverture se fait par `@Public()` — un oubli **ferme** l'accès au
lieu de l'ouvrir. C'est le bon sens du défaut.

Le frontend n'est jamais une couche de sécurité : `Stack.Protected` côté
mobile ne protège que l'affichage.

### Site — matrice de permissions nommées

```python
PERMISSIONS = {
    "produits.supprimer": {ADMIN},                  # geste irréversible
    "stock.ajuster":      {ADMIN, GESTIONNAIRE},
    ...
}
```

Un seul endroit décrit qui peut quoi (`permissions.py`, 60 permissions), et
`verifier_integrite()` **bloque le démarrage** si la matrice est incohérente —
par exemple si une nouvelle permission oublie l'administrateur.

C'est un modèle **plus fin** que celui de l'application : il distingue
`produits.modifier` de `produits.supprimer`, `catalogue.exporter` de
`catalogue.importer`. L'application ne connaît que le rôle.

---

## 4. Comparaison des droits, domaine par domaine

La question de l'étape 9 — *un utilisateur a-t-il plus de droits d'un côté
que de l'autre, par simple différence d'implémentation ?*

| Domaine | Site | Application | Cohérent ? |
| --- | --- | --- | --- |
| Voir le catalogue public | tous | tous (`@Public`) | ✅ |
| Voir le catalogue **interne** (stocks, prix barrés, inactifs) | `admin`, `gestionnaire` — **pas le livreur** | `GESTIONNAIRE`, `ADMIN`, `DG` | ✅ |
| Créer / modifier un produit | `admin`, `gestionnaire` | **personne** — le catalogue vient du site | ✅ (par conception) |
| Supprimer un produit | `admin` seul | — | ✅ |
| Ajuster le stock | `admin`, `gestionnaire` | `GESTIONNAIRE`, `ADMIN`, `DG` | ⚠️ `DG` en plus |
| Voir toutes les commandes | `admin`, `gestionnaire` | `GESTIONNAIRE`, `ADMIN`, `DG` | ⚠️ `DG` en plus |
| Changer le statut d'une commande | `admin`, `gestionnaire` | `GESTIONNAIRE`, `ADMIN`, `DG` | ⚠️ `DG` en plus |
| Affecter un livreur | `admin`, `gestionnaire` | `GESTIONNAIRE`, `ADMIN`, `DG` | ⚠️ `DG` en plus |
| Marquer une commande livrée | `admin`, `gestionnaire`, `livreur` | **backend seul**, après OTP | ⚠️ voir §5 |
| Voir ses propres livraisons | `livreur` | `LIVREUR` | ✅ |
| Journal d'audit | `admin` seul | — | ✅ |
| Paramètres, sauvegardes | `admin` seul | — | ✅ |
| Indicateurs consolidés | `admin`, `gestionnaire` | `DG`, `ADMIN` — **pas le gestionnaire** | ⚠️ plus restrictif |

### Les écarts, et ce qu'ils valent

**`DG` a les droits du gestionnaire dans l'application.** Ce n'est pas une
faille : c'est un rôle d'encadrement au-dessus du gestionnaire, absent du
site. Aucune permission n'est *gagnée* par un utilisateur existant.

**Les statistiques sont plus fermées dans l'application** (DG/ADMIN) que sur
le site (admin/gestionnaire). Écart réel, dans le sens prudent. À trancher :
soit le gestionnaire y a droit partout, soit nulle part.

**Ce qu'aucun écart ne produit** : un utilisateur ayant *plus* de droits dans
l'application que sur le site du seul fait d'une implémentation différente.
La vérification a été faite domaine par domaine.

---

## 5. Le cas de la clôture de livraison

C'est la différence la plus structurante, et elle est **volontaire**.

- **Site** : `commandes.marquer_livree` est accordée à `admin`,
  `gestionnaire` et `livreur`. Un livreur déclare la remise, on le croit.
- **Application** : personne ne peut écrire `DELIVERED`. Le livreur saisit le
  **code dicté par le client**, le backend vérifie l'empreinte, et c'est lui
  qui clôt. Le livreur ne reçoit ce code par aucun canal.

Une clôture d'exception reste possible (`MANAGER_OVERRIDE`) pour une remise
réelle qu'aucun code ne pouvait valider — téléphone déchargé, tiers qui
réceptionne. Elle exige un **motif** et enregistre son **auteur**, et elle est
mesurée : si elle devient fréquente, c'est que le parcours par code ne
fonctionne pas sur le terrain.

**Le modèle de l'application est le bon.** Le jour de l'unification, c'est lui
qui doit l'emporter, sans quoi la validation par code perdrait toute valeur
opposable.

---

## 6. Points de sécurité relevés

| # | Point | Gravité |
| --- | --- | --- |
| 1 | Le site stocke `sessions.token` **en clair** ; l'application ne stocke que des empreintes (`RefreshToken.tokenHash`) et pratique la rotation. Une lecture de la base du site donne des sessions rejouables. | **à corriger** |
| 2 | Deux secrets JWT distincts sont exigés en production, et l'API **refuse de démarrer** si l'un ressemble à un exemple ou fait moins de 32 caractères. | ✅ bon |
| 3 | Le code de livraison n'est jamais stocké en clair : empreinte SHA-256 pour vérifier, chiffré AES-256-GCM pour que le client le relise. | ✅ exemplaire |
| 4 | Le jeton d'intégration est comparé en **temps constant**, sur des empreintes de même longueur. | ✅ bon |
| 5 | Le relais de messages interdit les événements sensibles (`otp`, `code_livraison`, `mot_de_passe`…) : un jeton d'intégration qui fuit ne permet pas d'envoyer un faux code sous le sender ID d'AGRIM. Plafonné à 60 SMS / 5 min. | ✅ bon |
| 6 | Un compte désactivé est traité comme non authentifié des deux côtés : ses sessions deviennent inutilisables. | ✅ bon |
| 7 | Trois permissions du site sont **orphelines** (`commandes.voir_siennes`, `commandes.annuler`, `comptes.voir`) : définies, jamais vérifiées. Sans effet, mais trompeuses. | cosmétique |
| 8 | Le site permet à un non-livreur de relever une tournée pour un livreur alors que `livreur.tournee` ne l'autorise pas au gestionnaire — incohérence entre la route et la matrice, déjà signalée dans le code. | à trancher |

---

## 7. Règles à tenir

1. **Le serveur décide, toujours.** Aucune décision d'autorisation ne repose
   sur le client, mobile ou navigateur.
2. **Le défaut est fermé.** Une route sans annotation est protégée ;
   l'ouverture est explicite (`@Public`).
3. **Un rôle nouveau s'ajoute d'abord ici**, puis dans
   `packages/contracts/src/enums.ts`, puis en migration Prisma, puis dans
   `permissions.py` si le site le connaît aussi.
4. **Aucune permission ne s'élargit sans être écrite dans ce document.**
