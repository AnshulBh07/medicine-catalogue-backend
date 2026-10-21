-- CreateEnum
CREATE TYPE "ShiftType" AS ENUM ('FULL_DAY', 'HALF_DAY');

-- AlterTable
ALTER TABLE "AttendanceRecord" ADD COLUMN     "workUnits" DECIMAL(4,2);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "shiftType" "ShiftType" NOT NULL DEFAULT 'FULL_DAY';
