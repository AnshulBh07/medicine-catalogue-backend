import { Prisma, type Batch, type CommercialDetails, type Medicine, type User } from '@prisma/client/index';
import { AppError } from '../../common/errors/app-error.js';
import { prisma } from '../../lib/prisma.js';
import type { CreateBatchInput, ListBatchesInput, UpdateBatchInput } from './batch.schemas.js';

type MedicineReference = Pick<Medicine, 'id' | 'name'>;
type UserReference = Pick<User, 'id' | 'name'>;

type CommercialDetailsRecord = CommercialDetails & {
  updatedByUser: UserReference;
};

type BatchRecord = Batch & {
  medicine: MedicineReference & { active: boolean };
  commercialDetails?: CommercialDetailsRecord | null;
};

export type PublicBatchCommercialDetails = {
  id: string;
  purchaseRate: number;
  mrp: number;
  discountPercent: number;
  gstPercent: number;
  scheme: Prisma.JsonValue | null;
  privateNotes: string | null;
  updatedAt: Date;
  updatedBy: UserReference;
};

export type PublicBatch = {
  id: string;
  medicine: MedicineReference;
  batchNumber: string;
  manufacturingDate: string | null;
  expiryDate: string;
  commercialDetails?: PublicBatchCommercialDetails | null;
  createdAt: Date;
  updatedAt: Date;
};

const batchInclude = {
  medicine: { select: { id: true, name: true, active: true } },
  commercialDetails: {
    include: {
      updatedByUser: { select: { id: true, name: true } },
    },
  },
} as const;

export type BatchStore = typeof prisma;

const toDateOnly = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const toPublicBatch = (batch: BatchRecord, isAdmin = false): PublicBatch => ({
  id: batch.id,
  medicine: { id: batch.medicine.id, name: batch.medicine.name },
  batchNumber: batch.batchNumber,
  manufacturingDate: batch.manufacturingDate ? toDateOnly(batch.manufacturingDate) : null,
  expiryDate: toDateOnly(batch.expiryDate),
  commercialDetails: isAdmin && batch.commercialDetails
    ? {
        id: batch.commercialDetails.id,
        purchaseRate: Number(batch.commercialDetails.purchaseRate),
        mrp: Number(batch.commercialDetails.mrp),
        discountPercent: Number(batch.commercialDetails.discountPercent),
        gstPercent: Number(batch.commercialDetails.gstPercent ?? 0),
        scheme: batch.commercialDetails.scheme,
        privateNotes: batch.commercialDetails.privateNotes,
        updatedAt: batch.commercialDetails.updatedAt,
        updatedBy: batch.commercialDetails.updatedByUser,
      }
    : isAdmin ? null : undefined,
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

export const getLatestBatchForMedicine = async (
  medicineId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
) => {
  return db.batch.findFirst({
    where: { medicineId },
    orderBy: { createdAt: 'desc' },
    include: batchInclude,
  });
};

export const listBatches = async (
  input: ListBatchesInput,
  isAdmin = false,
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
  return batches.map((b) => toPublicBatch(b, isAdmin));
};

export const getBatch = async (
  id: string,
  includeInactive: boolean,
  isAdmin = false,
  db: BatchStore = prisma,
): Promise<PublicBatch> => {
  const batch = await db.batch.findUnique({ where: { id }, include: batchInclude });
  if (!batch || (!includeInactive && !batch.medicine.active)) {
    throw batchNotFound();
  }
  return toPublicBatch(batch, isAdmin);
};

export const createBatch = async (
  input: CreateBatchInput,
  userId?: string,
  isAdmin = false,
  db = prisma,
): Promise<PublicBatch> => {
  await ensureActiveMedicine(input.medicineId, db as unknown as BatchStore);
  ensureDateOrder(input.manufacturingDate ?? null, input.expiryDate);

  const commData = input.commercialDetails || (input.mrp !== undefined ? {
    purchaseRate: input.purchaseRate ?? 0,
    mrp: input.mrp,
    discountPercent: input.discountPercent ?? 0,
    gstPercent: input.gstPercent ?? 0,
    scheme: input.scheme ?? null,
    privateNotes: input.privateNotes ?? null,
  } : undefined);

  return (db as unknown as typeof prisma).$transaction(async (tx) => {
    let createdBatch: BatchRecord;
    try {
      createdBatch = (await tx.batch.create({
        data: {
          medicineId: input.medicineId,
          batchNumber: input.batchNumber,
          manufacturingDate: input.manufacturingDate ?? null,
          expiryDate: input.expiryDate,
        },
        include: batchInclude,
      })) as BatchRecord;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppError(409, 'DUPLICATE_BATCH_NUMBER', 'This batch number already exists for the medicine');
      }
      throw error;
    }

    if (commData && userId) {
      await tx.commercialDetails.create({
        data: {
          batchId: createdBatch.id,
          purchaseRate: commData.purchaseRate ?? 0,
          mrp: commData.mrp,
          discountPercent: commData.discountPercent ?? 0,
          gstPercent: commData.gstPercent ?? 0,
          scheme: commData.scheme === undefined || commData.scheme === null
            ? Prisma.DbNull
            : (commData.scheme as Prisma.InputJsonValue),
          privateNotes: commData.privateNotes ?? null,
          updatedBy: userId,
        },
      });

      const refreshed = await tx.batch.findUnique({
        where: { id: createdBatch.id },
        include: batchInclude,
      });
      if (refreshed) {
        createdBatch = refreshed as BatchRecord;
      }
    }

    return toPublicBatch(createdBatch, isAdmin);
  });
};

export const updateBatch = async (
  id: string,
  input: UpdateBatchInput,
  userId?: string,
  isAdmin = false,
  db = prisma,
): Promise<PublicBatch> => {
  const existing = await db.batch.findUnique({ where: { id }, include: batchInclude });
  if (!existing) throw batchNotFound();

  const manufacturingDate = input.manufacturingDate === undefined
    ? existing.manufacturingDate
    : input.manufacturingDate;
  const expiryDate = input.expiryDate ?? existing.expiryDate;
  ensureDateOrder(manufacturingDate, expiryDate);

  const commData = input.commercialDetails || (input.mrp !== undefined ? {
    purchaseRate: input.purchaseRate,
    mrp: input.mrp,
    discountPercent: input.discountPercent,
    gstPercent: input.gstPercent,
    scheme: input.scheme,
    privateNotes: input.privateNotes,
  } : undefined);

  return (db as unknown as typeof prisma).$transaction(async (tx) => {
    let updatedBatch: BatchRecord;
    try {
      updatedBatch = (await tx.batch.update({
        where: { id },
        data: {
          ...(input.batchNumber === undefined ? {} : { batchNumber: input.batchNumber }),
          ...(input.manufacturingDate === undefined ? {} : { manufacturingDate: input.manufacturingDate }),
          ...(input.expiryDate === undefined ? {} : { expiryDate: input.expiryDate }),
        },
        include: batchInclude,
      })) as BatchRecord;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppError(409, 'DUPLICATE_BATCH_NUMBER', 'This batch number already exists for the medicine');
      }
      throw error;
    }

    if (commData && userId) {
      const existingCommercial = await tx.commercialDetails.findUnique({
        where: { batchId: id },
      });

      if (existingCommercial) {
        await tx.commercialDetails.update({
          where: { batchId: id },
          data: {
            purchaseRate: commData.purchaseRate !== undefined ? commData.purchaseRate : existingCommercial.purchaseRate,
            mrp: commData.mrp !== undefined ? commData.mrp : existingCommercial.mrp,
            discountPercent: commData.discountPercent !== undefined ? commData.discountPercent : existingCommercial.discountPercent,
            gstPercent: commData.gstPercent !== undefined ? commData.gstPercent : existingCommercial.gstPercent,
            scheme: commData.scheme === undefined
              ? (existingCommercial.scheme === null ? Prisma.DbNull : (existingCommercial.scheme as Prisma.InputJsonValue))
              : commData.scheme === null ? Prisma.DbNull : (commData.scheme as Prisma.InputJsonValue),
            privateNotes: commData.privateNotes !== undefined ? commData.privateNotes : existingCommercial.privateNotes,
            updatedBy: userId,
          },
        });
      } else if (commData.mrp !== undefined) {
        await tx.commercialDetails.create({
          data: {
            batchId: id,
            purchaseRate: commData.purchaseRate ?? 0,
            mrp: commData.mrp,
            discountPercent: commData.discountPercent ?? 0,
            gstPercent: commData.gstPercent ?? 0,
            scheme: commData.scheme === undefined || commData.scheme === null
              ? Prisma.DbNull
              : (commData.scheme as Prisma.InputJsonValue),
            privateNotes: commData.privateNotes ?? null,
            updatedBy: userId,
          },
        });
      }

      const refreshed = await tx.batch.findUnique({
        where: { id },
        include: batchInclude,
      });
      if (refreshed) {
        updatedBatch = refreshed as BatchRecord;
      }
    }

    return toPublicBatch(updatedBatch, isAdmin);
  });
};

export const deleteBatch = async (
  id: string,
  isAdmin = false,
  db = prisma,
): Promise<PublicBatch> => {
  const existing = await db.batch.findUnique({
    where: { id },
    include: batchInclude,
  });
  if (!existing) throw batchNotFound();

  await db.batch.delete({ where: { id } });
  return toPublicBatch(existing, isAdmin);
};
