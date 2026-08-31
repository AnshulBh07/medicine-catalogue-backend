-- CreateEnum
CREATE TYPE "ShortageUnit" AS ENUM ('PACK', 'STRIP', 'BOX', 'PIECE', 'BOTTLE', 'CRATE');

-- AlterTable
ALTER TABLE "ShortageItem" ADD COLUMN     "unit" "ShortageUnit" NOT NULL DEFAULT 'PACK';
