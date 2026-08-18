-- CreateEnum
CREATE TYPE "ProductionStatus" AS ENUM ('DECLARED', 'CONFIRMED', 'RECEIVED', 'REJECTED');

-- AlterTable
ALTER TABLE "Farm" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Production" ADD COLUMN     "reviewNote" VARCHAR(300),
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "status" "ProductionStatus" NOT NULL DEFAULT 'DECLARED',
ADD COLUMN     "targetKg" INTEGER,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "Production_status_idx" ON "Production"("status");
