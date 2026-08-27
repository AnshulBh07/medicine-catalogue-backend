import { Prisma, type Batch, type Medicine } from '@prisma/client/index';
import { AppError } from '../../common/errors/app-error.js';
import { prisma } from '../../lib/prisma.js';
import type { CreateBatchInput, ListBatchesInput, UpdateBatchInput } from './batch.schemas.js';

type MedicineReference = Pick<Medicine, 'id' | 'name'>;
type BatchRecord = Batch & {
  medicine: MedicineReference & { active: boolean };
};

export type PublicBatch = {
  id: string;
  medicine: MedicineReference;
  batchNumber: string;
  manufacturingDate: string | null;
  expiryDate: string;
  createdAt: Date;
  updatedAt: Date;
};

const batchInclude = {
  medicine: { select: { id: true, name: true, active: true } },
} as const;

export interface BatchStore {
  medicine: {
    findUnique(args: {
      where: { id: string };
      select: { id: true; name: true; active: true };
    }): PromiseLike<MedicineReference & { active: boolean } | null>;
  };
  batch: {
    findMany(args: {
      where: {
        medicineId?: string;
        medicine?: { active?: boolean };
        expiryDate?: { lte?: Date; gte?: Date };
      };
      include: typeof batchInclude;
      orderBy: { expiryDate: 'asc' };
    }): PromiseLike<BatchRecord[]>;
    findUnique(args: {
      where: { id: string };
      include: typeof batchInclude;
    }): PromiseLike<BatchRecord | null>;
    create(args: {
      data: {
        medicineId: string;
        batchNumber: string;
        manufacturingDate: Date | null;
        expiryDate: Date;
      };
      include: typeof batchInclude;
    }): PromiseLike<BatchRecord>;
    update(args: {
      where: { id: string };
      data: {
        batchNumber?: string;
        manufacturingDate?: Date | null;
        expiryDate?: Date;
      };
      include: typeof batchInclude;
    }): PromiseLike<BatchRecord>;
  };
}

const toDateOnly = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const toPublicBatch = (batch: BatchRecord): PublicBatch => ({
  id: batch.id,
  medicine: { id: batch.medicine.id, name: batch.medicine.name },
  batchNumber: batch.batchNumber,
  manufacturingDate: batch.manufacturingDate ? toDateOnly(batch.manufacturingDate) : null,
  expiryDate: toDateOnly(batch.expiryDate),
  createdAt: batch.createdAt,
  updatedAt: batch.updatedAt,
});

const batchNotFound = (): AppError =>
  new AppError(404, 'BATCH_NOT_FOUND', 'Batch not found');

const ensureActiveMedicine = async (medicineId: string, db: BatchStore): Promise<void> => {
  const medicine = await db.medicine.findUnique({
    where: { id: medicineId },
    select: { id: true, name: true, active: true },
  });
  if (!medicine) {
    throw new AppError(404, 'MEDICINE_NOT_FOUND', 'Medicine not found');
  }
  if (!medicine.active) {
    throw new AppError(409, 'INACTIVE_MEDICINE', 'Batch must reference an active medicine');
  }
};

const ensureDateOrder = (manufacturingDate: Date | null, expiryDate: Date): void => {
  if (manufacturingDate && expiryDate <= manufacturingDate) {
    throw new AppError(400, 'INVALID_DATES', 'Expiry date must be after manufacturing date');
  }
};

export const listBatches = async (
  input: ListBatchesInput,
  db: BatchStore = prisma,
): Promise<PublicBatch[]> => {
  const batches = await db.batch.findMany({
    where: {
      ...(input.medicineId ? { medicineId: input.medicineId } : {}),
      ...(input.includeInactive ? {} : { medicine: { active: true } }),
      ...(input.expiryBefore || input.expiryAfter
        ? {
            expiryDate: {
              ...(input.expiryBefore ? { lte: input.expiryBefore } : {}),
              ...(input.expiryAfter ? { gte: input.expiryAfter } : {}),
            },
          }
        : {}),
    },
    include: batchInclude,
    orderBy: { expiryDate: 'asc' },
  });
  return batches.map(toPublicBatch);
};

export const getBatch = async (
  id: string,
  includeInactive: boolean,
  db: BatchStore = prisma,
): Promise<PublicBatch> => {
  const batch = await db.batch.findUnique({ where: { id }, include: batchInclude });
  if (!batch || (!includeInactive && !batch.medicine.active)) {
    throw batchNotFound();
  }
  return toPublicBatch(batch);
};

export const createBatch = async (
  input: CreateBatchInput,
  db: BatchStore = prisma,
): Promise<PublicBatch> => {
  await ensureActiveMedicine(input.medicineId, db);
  ensureDateOrder(input.manufacturingDate ?? null, input.expiryDate);

  try {
    return toPublicBatch(await db.batch.create({
      data: {
        medicineId: input.medicineId,
        batchNumber: input.batchNumber,
        manufacturingDate: input.manufacturingDate ?? null,
        expiryDate: input.expiryDate,
      },
      include: batchInclude,
    }));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError(409, 'DUPLICATE_BATCH_NUMBER', 'This batch number already exists for the medicine');
    }
    throw error;
  }
};

export const updateBatch = async (
  id: string,
  input: UpdateBatchInput,
  db: BatchStore = prisma,
): Promise<PublicBatch> => {
  const existing = await db.batch.findUnique({ where: { id }, include: batchInclude });
  if (!existing) throw batchNotFound();

  const manufacturingDate = input.manufacturingDate === undefined
    ? existing.manufacturingDate
    : input.manufacturingDate;
  const expiryDate = input.expiryDate ?? existing.expiryDate;
  ensureDateOrder(manufacturingDate, expiryDate);

  try {
    return toPublicBatch(await db.batch.update({
      where: { id },
      data: {
        ...(input.batchNumber === undefined ? {} : { batchNumber: input.batchNumber }),
        ...(input.manufacturingDate === undefined ? {} : { manufacturingDate: input.manufacturingDate }),
        ...(input.expiryDate === undefined ? {} : { expiryDate: input.expiryDate }),
      },
      include: batchInclude,
    }));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError(409, 'DUPLICATE_BATCH_NUMBER', 'This batch number already exists for the medicine');
    }
    throw error;
  }
};
