# Checkout invité et réception — septembre 2026

Le parcours client mobile ne dépend plus d'une session :

```text
bienvenue → catalogue → panier → checkout invité → commande reçue
```

## API publiques

- `GET /api/v1/orders/pickup-points?city=...` retourne les points actifs, filtrables par ville.
- `POST /api/v1/orders/guest` crée une commande sans JWT.

Le corps de la création contient uniquement le nom, le téléphone, les variantes et quantités, le mode de réception, la ville/localité, le repère éventuel et la clé d'idempotence. Aucun prix ni frais de livraison ne vient du mobile.

Pour `HOME_DELIVERY`, `deliveryFeeStatus=TO_CONFIRM` et `deliveryFee=0` : zéro signifie ici « non confirmé », jamais « livraison gratuite ». Pour `PICKUP_POINT`, le point est vérifié côté serveur contre la ville choisie et les frais sont nuls.

Les anciennes routes authentifiées restent disponibles pour les autres clients et les comptes existants. Le backend crée un compte technique `User.isGuest` uniquement pour conserver les relations historiques `Order`/`Address`; ce compte n'est jamais présenté comme une inscription et aucun jeton n'est émis.

## Administration

La commande conserve un instantané `customerName`/`customerPhone`, le mode de réception, la ville, le quartier, le repère et le point de retrait. Le gestionnaire peut confirmer le montant via :

`PATCH /api/v1/management/orders/:reference/delivery-fee`

avec `{ "deliveryFee": 3500 }`. L'API recalcule le total et passe `deliveryFeeStatus` à `CONFIRMED`. Un retrait ne peut recevoir qu'un montant nul. Quand un retrait atteint `READY`, la gestion peut le marquer `DELIVERED` pour enregistrer la remise au client sans créer de course livreur.
