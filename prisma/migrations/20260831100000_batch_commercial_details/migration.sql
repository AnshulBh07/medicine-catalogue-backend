-- Step 1: For each Medicine that has a CommercialDetails record but NO Batch, create an initial Batch record
INSERT INTO "Batch" ("id", "medicineId", "batchNumber", "manufacturingDate", "expiryDate", "createdAt", "updatedAt")
SELECT
    gen_random_uuid(),
    m."id",
    'BATCH-001',
    (m."createdAt"::date),
    (m."createdAt"::date + INTERVAL '2 years'),
    m."createdAt",
    m."updatedAt"
FROM "Medicine" m
WHERE EXISTS (
    SELECT 1 FROM "CommercialDetails" cd WHERE cd."medicineId" = m."id"
)
AND NOT EXISTS (
    SELECT 1 FROM "Batch" b WHERE b."medicineId" = m."id"
);

-- Step 2: Add batchId column to CommercialDetails
ALTER TABLE "CommercialDetails" ADD COLUMN "batchId" UUID;

-- Step 3: Map existing CommercialDetails to the latest batch of each medicine
UPDATE "CommercialDetails" cd
SET "batchId" = b.id
FROM (
    SELECT DISTINCT ON ("medicineId") id, "medicineId"
    FROM "Batch"
    ORDER BY "medicineId", "createdAt" DESC
) b
WHERE cd."medicineId" = b."medicineId";

-- Step 4: Make batchId NOT NULL
ALTER TABLE "CommercialDetails" ALTER COLUMN "batchId" SET NOT NULL;

-- Step 5: Drop old constraints and column
ALTER TABLE "CommercialDetails" DROP CONSTRAINT IF EXISTS "CommercialDetails_medicineId_fkey";
DROP INDEX IF EXISTS "CommercialDetails_medicineId_key";
ALTER TABLE "CommercialDetails" DROP COLUMN "medicineId";

-- Step 6: Create new unique index and foreign key on batchId
CREATE UNIQUE INDEX "CommercialDetails_batchId_key" ON "CommercialDetails"("batchId");
ALTER TABLE "CommercialDetails" ADD CONSTRAINT "CommercialDetails_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
