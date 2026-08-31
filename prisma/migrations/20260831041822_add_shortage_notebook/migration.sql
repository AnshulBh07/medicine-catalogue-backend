-- CreateEnum
CREATE TYPE "ShortageStatus" AS ENUM ('PENDING', 'ORDERED', 'COMPLETED');

-- CreateTable
CREATE TABLE "ShortageItem" (
    "id" UUID NOT NULL,
    "medicineId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "ShortageStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ShortageItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShortageItem_date_idx" ON "ShortageItem"("date");

-- CreateIndex
CREATE INDEX "ShortageItem_medicineId_date_idx" ON "ShortageItem"("medicineId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ShortageItem_medicineId_date_key" ON "ShortageItem"("medicineId", "date");

-- AddForeignKey
ALTER TABLE "ShortageItem" ADD CONSTRAINT "ShortageItem_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "Medicine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShortageItem" ADD CONSTRAINT "ShortageItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
