/*
  Warnings:

  - You are about to drop the column `area` on the `MR` table. All the data in the column will be lost.
  - You are about to drop the column `employeeCode` on the `MR` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "MR" DROP COLUMN "area",
DROP COLUMN "employeeCode",
ALTER COLUMN "company" DROP NOT NULL;
