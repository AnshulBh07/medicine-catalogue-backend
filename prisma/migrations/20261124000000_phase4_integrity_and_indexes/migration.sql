-- Phase 4 Remediation (F-032 & F-040B):
-- 1. Prevent cascading deletion of historical AttendanceRecord payroll records on User delete (Cascade -> Restrict).
-- 2. Align nullable Medicine.mrId foreign key to ON DELETE SET NULL so medicines are preserved if an MR is removed.
-- 3. Add non-destructive CHECK constraints for MedicineAlternative self-reference prevention and non-negative AttendanceRecord.workUnits.
-- 4. Add query-justified indexes for Medicine, Batch.expiryDate, CommercialDetails.updatedBy, and CompositionSalt.saltId.
-- 5. Drop 3 demonstrably redundant indexes already covered by composite UNIQUE constraints.

-- DropForeignKey
ALTER TABLE "AttendanceRecord" DROP CONSTRAINT "AttendanceRecord_userId_fkey";

-- DropForeignKey
ALTER TABLE "Medicine" DROP CONSTRAINT "Medicine_mrId_fkey";

-- DropIndex (redundant duplicate / leading-prefix indexes)
DROP INDEX IF EXISTS "AttendanceRecord_userId_date_idx";
DROP INDEX IF EXISTS "ShortageItem_medicineId_date_idx";
DROP INDEX IF EXISTS "MedicineAlternative_sourceMedicineId_idx";

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Medicine" ADD CONSTRAINT "Medicine_mrId_fkey" FOREIGN KEY ("mrId") REFERENCES "MR"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Check Constraints
ALTER TABLE "MedicineAlternative" ADD CONSTRAINT "MedicineAlternative_no_self_reference_check" CHECK ("sourceMedicineId" <> "alternativeMedicineId");
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_workUnits_non_negative_check" CHECK ("workUnits" IS NULL OR "workUnits" >= 0);

-- CreateIndex (query-justified foreign-key and filter indexes)
CREATE INDEX "Medicine_manufacturerId_idx" ON "Medicine"("manufacturerId");
CREATE INDEX "Medicine_mrId_idx" ON "Medicine"("mrId");
CREATE INDEX "Medicine_compositionId_idx" ON "Medicine"("compositionId");
CREATE INDEX "Medicine_active_idx" ON "Medicine"("active");
CREATE INDEX "Batch_expiryDate_idx" ON "Batch"("expiryDate");
CREATE INDEX "CommercialDetails_updatedBy_idx" ON "CommercialDetails"("updatedBy");
CREATE INDEX "CompositionSalt_saltId_idx" ON "CompositionSalt"("saltId");
