/*
  Warnings:

  - You are about to drop the column `address` on the `Manufacturer` table. All the data in the column will be lost.
  - You are about to drop the column `contactPerson` on the `Manufacturer` table. All the data in the column will be lost.
  - You are about to drop the column `email` on the `Manufacturer` table. All the data in the column will be lost.
  - You are about to drop the column `notes` on the `Manufacturer` table. All the data in the column will be lost.
  - You are about to drop the column `phone` on the `Manufacturer` table. All the data in the column will be lost.
  - You are about to drop the column `website` on the `Manufacturer` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[name]` on the table `Manufacturer` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Manufacturer" DROP COLUMN "address",
DROP COLUMN "contactPerson",
DROP COLUMN "email",
DROP COLUMN "notes",
DROP COLUMN "phone",
DROP COLUMN "website";

-- CreateIndex
CREATE UNIQUE INDEX "Manufacturer_name_key" ON "Manufacturer"("name");
