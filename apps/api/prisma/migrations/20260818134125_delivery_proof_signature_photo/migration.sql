/*
  Warnings:

  - You are about to drop the column `proofOtp` on the `Delivery` table. All the data in the column will be lost.
  - You are about to drop the column `proofPhotoUrl` on the `Delivery` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "DeliveryProofMethod" AS ENUM ('SIGNATURE', 'PHOTO');

-- AlterTable
ALTER TABLE "Delivery" DROP COLUMN "proofOtp",
DROP COLUMN "proofPhotoUrl",
ADD COLUMN     "pickedUpAt" TIMESTAMP(3),
ADD COLUMN     "proofMethods" "DeliveryProofMethod"[],
ADD COLUMN     "proofNote" VARCHAR(500),
ADD COLUMN     "proofPhotoFile" UUID,
ADD COLUMN     "proofReceivedBy" VARCHAR(120),
ADD COLUMN     "proofSignatureFile" UUID,
ADD COLUMN     "proofSubmittedAt" TIMESTAMP(3);
