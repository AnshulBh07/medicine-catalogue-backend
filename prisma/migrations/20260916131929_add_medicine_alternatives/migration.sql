-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'MEDICINE_ALTERNATIVE_CREATED';
ALTER TYPE "NotificationType" ADD VALUE 'MEDICINE_ALTERNATIVE_UPDATED';
ALTER TYPE "NotificationType" ADD VALUE 'MEDICINE_ALTERNATIVE_DELETED';

-- CreateTable
CREATE TABLE "MedicineAlternative" (
    "id" UUID NOT NULL,
    "sourceMedicineId" UUID NOT NULL,
    "alternativeMedicineId" UUID NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "MedicineAlternative_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MedicineAlternative_sourceMedicineId_idx" ON "MedicineAlternative"("sourceMedicineId");

-- CreateIndex
CREATE INDEX "MedicineAlternative_alternativeMedicineId_idx" ON "MedicineAlternative"("alternativeMedicineId");

-- CreateIndex
CREATE INDEX "MedicineAlternative_createdAt_idx" ON "MedicineAlternative"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MedicineAlternative_sourceMedicineId_alternativeMedicineId_key" ON "MedicineAlternative"("sourceMedicineId", "alternativeMedicineId");

-- AddForeignKey
ALTER TABLE "MedicineAlternative" ADD CONSTRAINT "MedicineAlternative_sourceMedicineId_fkey" FOREIGN KEY ("sourceMedicineId") REFERENCES "Medicine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicineAlternative" ADD CONSTRAINT "MedicineAlternative_alternativeMedicineId_fkey" FOREIGN KEY ("alternativeMedicineId") REFERENCES "Medicine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicineAlternative" ADD CONSTRAINT "MedicineAlternative_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
