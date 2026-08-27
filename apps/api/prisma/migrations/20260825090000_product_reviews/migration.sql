-- Avis clients sur un produit (étoiles 1–5 + commentaire).
-- Table neuve, additive : aucune colonne existante n'est touchée.

CREATE TABLE "ProductReview" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" VARCHAR(800) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductReview_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ProductReview"
    ADD CONSTRAINT "ProductReview_rating_check"
    CHECK ("rating" >= 1 AND "rating" <= 5);

CREATE UNIQUE INDEX "ProductReview_productId_userId_key"
    ON "ProductReview"("productId", "userId");

CREATE INDEX "ProductReview_productId_createdAt_idx"
    ON "ProductReview"("productId", "createdAt");

ALTER TABLE "ProductReview"
    ADD CONSTRAINT "ProductReview_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductReview"
    ADD CONSTRAINT "ProductReview_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
