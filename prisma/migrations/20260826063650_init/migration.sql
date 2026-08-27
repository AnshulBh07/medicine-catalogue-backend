-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "MedicineForm" AS ENUM ('TABLET', 'CAPSULE', 'SYRUP', 'LIQUID', 'SUSPENSION', 'OINTMENT', 'CREAM', 'GEL', 'POWDER', 'INJECTION', 'DROPS', 'SPRAY', 'INHALER', 'LOTION', 'SOLUTION', 'OTHER');

-- CreateEnum
CREATE TYPE "MedicinePackUnit" AS ENUM ('TABLET', 'CAPSULE', 'ML', 'MG', 'G', 'PIECE', 'VIAL', 'AMPULE', 'BOTTLE', 'TUBE', 'SACHET', 'OTHER');

-- CreateEnum
CREATE TYPE "CompositionSaltUnit" AS ENUM ('MG', 'MCG', 'G', 'ML', 'IU', '%', 'OTHER');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "phone" VARCHAR(20),
    "email" VARCHAR(255),
    "passwordHash" VARCHAR(255) NOT NULL,
    "role" "UserRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Medicine" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "compositionId" UUID NOT NULL,
    "form" "MedicineForm" NOT NULL,
    "packQuantity" DECIMAL(10,2) NOT NULL,
    "packUnit" "MedicinePackUnit" NOT NULL,
    "shortDescription" TEXT,
    "uses" TEXT,
    "recommendedAgeGroup" VARCHAR(100),
    "directions" TEXT,
    "warnings" TEXT,
    "storageInstructions" TEXT,
    "barcode" VARCHAR(100),
    "prescriptionRequired" BOOLEAN NOT NULL,
    "manufacturerId" UUID NOT NULL,
    "mrId" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Medicine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Salt" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Salt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompositionSalt" (
    "id" UUID NOT NULL,
    "saltId" UUID NOT NULL,
    "amount" DECIMAL(10,3) NOT NULL,
    "unit" "CompositionSaltUnit" NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "CompositionSalt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Composition" (
    "id" UUID NOT NULL,
    "displayText" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Composition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompositionCompositionSalt" (
    "id" UUID NOT NULL,
    "compositionId" UUID NOT NULL,
    "compositionSaltId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompositionCompositionSalt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Manufacturer" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "contactPerson" VARCHAR(150),
    "phone" VARCHAR(20),
    "email" VARCHAR(255),
    "address" TEXT,
    "website" VARCHAR(500),
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Manufacturer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MR" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "company" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(20),
    "email" VARCHAR(255),
    "area" VARCHAR(150),
    "employeeCode" VARCHAR(100),
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "MR_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Distributor" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "contactPerson" VARCHAR(150),
    "phone" VARCHAR(20),
    "email" VARCHAR(255),
    "address" TEXT,
    "gstin" VARCHAR(20),
    "drugLicenseNumber" VARCHAR(100),
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Distributor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Batch" (
    "id" UUID NOT NULL,
    "medicineId" UUID NOT NULL,
    "batchNumber" VARCHAR(100) NOT NULL,
    "manufacturingDate" DATE,
    "expiryDate" DATE NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialDetails" (
    "id" UUID NOT NULL,
    "medicineId" UUID NOT NULL,
    "purchaseRate" DECIMAL(12,2) NOT NULL,
    "mrp" DECIMAL(12,2) NOT NULL,
    "discountPercent" DECIMAL(5,2) NOT NULL,
    "scheme" JSONB,
    "privateNotes" TEXT,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "updatedBy" UUID NOT NULL,

    CONSTRAINT "CommercialDetails_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Medicine_barcode_key" ON "Medicine"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "Salt_name_key" ON "Salt"("name");

-- CreateIndex
CREATE UNIQUE INDEX "CompositionCompositionSalt_compositionId_compositionSaltId_key" ON "CompositionCompositionSalt"("compositionId", "compositionSaltId");

-- CreateIndex
CREATE UNIQUE INDEX "Batch_medicineId_batchNumber_key" ON "Batch"("medicineId", "batchNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialDetails_medicineId_key" ON "CommercialDetails"("medicineId");

-- AddForeignKey
ALTER TABLE "Medicine" ADD CONSTRAINT "Medicine_compositionId_fkey" FOREIGN KEY ("compositionId") REFERENCES "Composition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Medicine" ADD CONSTRAINT "Medicine_manufacturerId_fkey" FOREIGN KEY ("manufacturerId") REFERENCES "Manufacturer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Medicine" ADD CONSTRAINT "Medicine_mrId_fkey" FOREIGN KEY ("mrId") REFERENCES "MR"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompositionSalt" ADD CONSTRAINT "CompositionSalt_saltId_fkey" FOREIGN KEY ("saltId") REFERENCES "Salt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompositionCompositionSalt" ADD CONSTRAINT "CompositionCompositionSalt_compositionId_fkey" FOREIGN KEY ("compositionId") REFERENCES "Composition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompositionCompositionSalt" ADD CONSTRAINT "CompositionCompositionSalt_compositionSaltId_fkey" FOREIGN KEY ("compositionSaltId") REFERENCES "CompositionSalt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "Medicine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialDetails" ADD CONSTRAINT "CommercialDetails_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "Medicine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialDetails" ADD CONSTRAINT "CommercialDetails_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
