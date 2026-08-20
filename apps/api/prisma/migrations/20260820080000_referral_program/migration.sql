-- AlterTable
ALTER TABLE "User" ADD COLUMN     "referralCode" VARCHAR(12),
ADD COLUMN     "referredById" UUID,
ADD COLUMN     "referralRewardedAt" TIMESTAMP(3),
ADD COLUMN     "creditBalanceXof" INTEGER NOT NULL DEFAULT 0;

-- Retro-remplissage : chaque compte deja existant recoit un code unique
-- avant que la contrainte NOT NULL/UNIQUE ne soit posee.
DO $$
DECLARE
  r RECORD;
  new_code TEXT;
BEGIN
  FOR r IN SELECT id FROM "User" LOOP
    LOOP
      new_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
      EXIT WHEN NOT EXISTS (SELECT 1 FROM "User" WHERE "referralCode" = new_code);
    END LOOP;
    UPDATE "User" SET "referralCode" = new_code WHERE id = r.id;
  END LOOP;
END $$;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "referralCode" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");

-- CreateIndex
CREATE INDEX "User_referredById_idx" ON "User"("referredById");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
