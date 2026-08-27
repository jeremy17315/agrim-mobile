-- Échec de livraison : la commande repart plutôt que de rester bloquée.
--
-- Migration purement additive : une valeur d'énumération, aucune colonne
-- touchée, aucune donnée réécrite. Les lignes existantes restent valides.
--
-- `AFTER 'DELIVERY_OTP'` aligne l'ordre physique de l'énumération sur celui
-- déclaré dans schema.prisma. Sans cette précision, PostgreSQL ajoute la
-- valeur en fin de liste et `prisma migrate diff` signale une dérive à chaque
-- exécution suivante.
--
-- `ADD VALUE` est admis dans une transaction depuis PostgreSQL 12 tant que la
-- valeur n'est pas UTILISÉE dans la même transaction — ce qui est le cas ici.

ALTER TYPE "NotificationType" ADD VALUE 'DELIVERY_FAILED' AFTER 'DELIVERY_OTP';
