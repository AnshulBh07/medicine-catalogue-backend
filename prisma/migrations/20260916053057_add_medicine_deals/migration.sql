-- CreateEnum
CREATE TYPE "DealStatus" AS ENUM ('PENDING', 'RECEIVED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Deal" (
    "id" UUID NOT NULL,
    "medicineId" UUID NOT NULL,
    "mrId" UUID NOT NULL,
    "dealDate" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "agreedMrp" DECIMAL(12,2) NOT NULL,
    "agreedScheme" VARCHAR(100) NOT NULL,
    "agreedBillDiscount" DECIMAL(5,2) NOT NULL,
    "mrPhoneSnapshot" VARCHAR(20),
    "status" "DealStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Deal_medicineId_idx" ON "Deal"("medicineId");

-- CreateIndex
CREATE INDEX "Deal_mrId_idx" ON "Deal"("mrId");

-- CreateIndex
CREATE INDEX "Deal_status_idx" ON "Deal"("status");

-- CreateIndex
CREATE INDEX "Deal_dealDate_idx" ON "Deal"("dealDate");

-- CreateIndex
CREATE INDEX "Deal_createdAt_idx" ON "Deal"("createdAt");

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "Medicine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_mrId_fkey" FOREIGN KEY ("mrId") REFERENCES "MR"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
