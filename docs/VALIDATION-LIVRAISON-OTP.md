# Validation de livraison par OTP

Remplace la preuve signature/photo par un code à quatre chiffres remis par le
client et vérifié par le backend.

**Changement de décision assumé** : la preuve signature + photo, retenue
précédemment, est entièrement retirée. Le raisonnement qui la justifiait
(fonctionne hors ligne, ne dépend pas du téléphone du client) reste valable mais
n'est plus le critère retenu — voir « Limites connues ».

---

## 1. Flux

```
Commande confirmée → préparée → mission créée → livreur affecté
  → ACCEPTED    le livreur accepte
  → IN_TRANSIT  il démarre     ← le code est émis et envoyé AU CLIENT
  → ARRIVED     il arrive sur place
  → le client dicte son code, le livreur le saisit
  → le BACKEND vérifie
  → OTP_VERIFIED puis DELIVERED (même transaction)
```

`PICKED_UP` disparaît : l'étape « colis récupéré » faisait double emploi avec le
départ. Les livraisons existantes dans cet état sont migrées vers `IN_TRANSIT`.

---

## 2. Règles du code

Définies une seule fois, dans `packages/contracts/src/delivery-otp.ts`
(`DELIVERY_OTP_CONFIG`), appliquées par le backend et reflétées par le mobile.

| Règle | Valeur | Justification |
|---|---|---|
| Longueur | 4 chiffres | imposé |
| Durée de vie | 60 min | couvre une course urbaine ; se régénère sans friction |
| Tentatives | 5 | 4 chiffres = 10 000 combinaisons ; 5 essais ⇒ 0,05 % de réussite au hasard |
| Renvois | 5 max, 60 s d'intervalle | évite que le renvoi en boucle serve de harcèlement |
| Usage | unique | consommé à la première vérification réussie |
| Unicité | un seul code actif | une régénération invalide le précédent |

**Génération** : `crypto.randomInt` (générateur cryptographique du système),
pas `Math.random()` qui est prédictible. Les codes à zéros initiaux (`0007`)
sont valides — le code est une chaîne, jamais un nombre.

**Stockage** : seule l'empreinte SHA-256 est persistée. Une fuite de base ne
permet pas de valider une livraison.

> SHA-256 nu, sans Argon2 : sur 10 000 valeurs, un algorithme lent n'apporterait
> aucune résistance réelle. La protection vient de la durée de vie, du plafond de
> tentatives et de l'usage unique. Le haché évite que le code soit lisible en
> base ou dans une sauvegarde.

---

## 3. Les cinq conditions

`DeliveryOtpService.verify()` les contrôle ensemble — aucun chemin ne peut en
contourner une :

1. code exact (comparaison d'empreintes) ;
2. non expiré ;
3. non consommé et non invalidé ;
4. rattaché à la livraison concernée ;
5. livreur habilité sur cette mission.

La consommation est atomique (`updateMany` filtrant sur `verifiedAt: null`) :
deux requêtes simultanées avec le bon code ne valident qu'une seule fois.

Un échec incrémente le compteur **avant** de répondre ; sans cela, une saisie
automatisée épuiserait les 10 000 combinaisons.

---

## 4. Le livreur ne peut pas contourner le code

Trois barrières indépendantes :

- **Contrat** : `COURIER_SETTABLE_DELIVERY_STATUSES` exclut `OTP_VERIFIED` et
  `DELIVERED`. Le type TypeScript rend la demande impossible à écrire côté
  mobile — le compilateur a d'ailleurs signalé chaque appel existant.
- **Backend** : `PATCH /deliveries/:id/status` rejette tout statut non
  positionnable par le terrain → **403 `COURIER_CANNOT_SET_STATUS`**.
- **Interface** : aucun bouton de validation manuelle ; le champ de code
  n'apparaît qu'à l'état `ARRIVED`.

Le seul chemin vers `DELIVERED` est `POST /deliveries/:id/verify-otp`.

---

## 5. Le livreur ne voit jamais le code

- La réponse à `PATCH .../status` ne le contient pas.
- `GET /deliveries/:id/otp-status` renvoie l'état (actif, expiré, tentatives
  restantes) **sans jamais le code**.
- Le code n'apparaît dans aucun journal : `DeliveryOtpService` ne journalise
  que l'identifiant de la livraison. Vérifié sur les journaux d'une exécution
  réelle — 0 occurrence.

**Le code ne part pas en notification poussée.** Une notification transite par
un service tiers (Expo) et s'affiche sur un écran verrouillé, à la vue de
n'importe qui — y compris du livreur qui attend devant la porte. Le push dit
seulement « Ouvrez l'application pour voir votre code » ; le code n'existe que
dans le message consultable en application.

---

## 6. GPS

Position **facultative**, enregistrée comme traçabilité (`otpLatitude`,
`otpLongitude`, `otpVerifiedAt`). Elle n'est jamais une condition : un immeuble
qui bloque le signal ne doit pas empêcher une livraison réelle d'être validée.
Le mobile joint la dernière position déjà connue du suivi, sans nouvelle demande
de permission ni attente.

---

## 7. Côté client

Nouvelle carte sur l'écran de suivi, visible uniquement pendant la livraison :

- code affiché en grand, groupé par deux (`48 21`) pour être dicté sans erreur ;
- libellé pour lecteur d'écran chiffre par chiffre (« 4 8 2 1 »), sinon `4821`
  serait annoncé « quatre mille huit cent vingt et un » ;
- consigne explicite : **à la remise uniquement, jamais par téléphone à
  l'avance** ;
- bouton « Je n'ai pas reçu mon code » (renvoi, réservé au propriétaire de la
  commande).

---

## 8. Suppressions

- Modèle : colonnes `proof*` retirées, énumération `DeliveryProofMethod`
  supprimée. Conserver ces colonnes aurait laissé des données personnelles sans
  usage.
- Contrats : `submitDeliveryProofSchema`, `deliveryProofSchema`,
  `DELIVERY_PROOF_*`.
- Mobile : `SignaturePad.tsx`, capture photo, `uploadProofFile`.
- **API : `FilesController` et `FilesService` supprimés.** Plus aucun fichier
  n'est déposé par les utilisateurs ; une route d'upload sans consommateur reste
  une surface d'attaque. L'abstraction `StorageProvider` est conservée pour le
  prochain besoin réel (visuels produits).

---

## 9. API

| Route | Rôle | Effet |
|---|---|---|
| `POST /deliveries/:id/verify-otp` | LIVREUR | Vérifie le code et clôt la course. Seul chemin vers `DELIVERED`. |
| `GET /deliveries/:id/otp-status` | LIVREUR | État du code, jamais le code. |
| `POST /deliveries/orders/:reference/otp/resend` | CLIENT | Régénère et renvoie le code. Propriétaire uniquement. |

Codes d'erreur : `OTP_INVALID` 400, `OTP_NOT_FOUND` 400, `OTP_EXPIRED` 409,
`OTP_ATTEMPTS_EXCEEDED` 409, `OTP_ALREADY_USED` 409, `OTP_RESEND_TOO_SOON` 409,
`OTP_RESEND_LIMIT` 409, `OTP_NOT_AVAILABLE` 409, `DELIVERY_NOT_ARRIVED` 409,
`COURIER_CANNOT_SET_STATUS` 403.

---

## 10. Vérifications

| Vérification | Résultat |
|---|---|
| Tests API | **224 / 15 suites** |
| Tests mobile | **225 / 22 suites** |
| `tsc --noEmit` + ESLint (API, mobile) | propres |
| Migration Prisma | appliquée, `PICKED_UP` → `IN_TRANSIT` |
| Seed | fonctionnel |
| Build + démarrage réel | OK |

Parcours complet exécuté contre un serveur réel :

```
code reçu par le CLIENT : 0946
code présent côté livreur ?      false
mauvais code               → 400 OTP_INVALID
clôture manuelle DELIVERED → 403 COURIER_CANNOT_SET_STATUS
bon code                   → 201 DELIVERED, otpVerifiedAt renseigné
rejeu du même code         → 409 DELIVERY_ALREADY_CLOSED
commande finale            → DELIVERED
occurrences du code dans les journaux : 0
```

Couverture ajoutée : 15 tests unitaires (règles du contrat), 21 tests e2e
(émission, non-divulgation, code faux, expiration, épuisement des tentatives,
rejeu, livreur non habilité, arrivée requise, avec et sans GPS, saisie espacée,
renvoi et son délai, refus de clôture manuelle), 15 tests d'écran livreur,
7 tests de la carte client.

---

## Limites connues

- **Le code dépend du téléphone du client.** Batterie vide, pas de réseau, ou
  réception par un tiers (gardien, voisin) : la livraison ne peut pas être
  validée. C'était précisément l'argument en faveur de la signature. Le repli
  actuel est `FAILED` avec motif, ce qui ne reflète pas la réalité d'un colis
  effectivement remis. Si ce cas se présente en exploitation, la réponse la plus
  simple est un code de secours généré côté gestionnaire, tracé et
  contresigné — à décider sur des cas réels, pas par anticipation.
- Codes expirés non purgés : l'historique est conservé pour les litiges. Prévoir
  une purge à l'échéance de la durée de conservation.
- Le renvoi est plafonné par livraison, sans limite globale par client.
