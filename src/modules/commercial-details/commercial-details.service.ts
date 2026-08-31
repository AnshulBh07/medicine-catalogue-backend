import { Prisma, type Batch, type CommercialDetails, type Medicine, type User } from '@prisma/client/index';
import { AppError } from '../../common/errors/app-error.js';
import { prisma } from '../../lib/prisma.js';
import { getLatestBatchForMedicine } from '../batches/batch.service.js';
import type { CreateCommercialDetailsInput, UpdateCommercialDetailsInput } from './commercial-details.schemas.js';

type MedicineReference = Pick<Medicine, 'id' | 'name'>;
type BatchReference = Pick<Batch, 'id' | 'batchNumber' | 'manufacturingDate' | 'expiryDate'>;
type UserReference = Pick<User, 'id' | 'name'>;

type CommercialDetailsRecord = CommercialDetails & {
  batch: BatchReference & { medicine: MedicineReference };
  updatedByUser: UserReference;
};

export type PublicCommercialDetails = {
  id: string;
  batchId: string;
  batch: BatchReference;
  medicine: MedicineReference;
  purchaseRate: number;
  mrp: number;
  discountPercent: number;
  scheme: Prisma.JsonValue | null;
  privateNotes: string | null;
  updatedAt: Date;
  updatedBy: UserReference;
};

const commercialDetailsInclude = {
  batch: {
    select: {
      id: true,
      batchNumber: true,
      manufacturingDate: true,
      expiryDate: true,
      medicine: { select: { id: true, name: true } },
    },
  },
  updatedByUser: { select: { id: true, name: true } },
} as const;

export type CommercialDetailsStore = typeof prisma;

const commercialDetailsNotFound = (): AppError =>
  new AppError(404, 'COMMERCIAL_DETAILS_NOT_FOUND', 'CommercialDetails not found');

const batchNotFound = (): AppError =>
  new AppError(404, 'BATCH_NOT_FOUND', 'Batch not found');

const medicineNotFound = (): AppError =>
  new AppError(404, 'MEDICINE_NOT_FOUND', 'Medicine not found');

const duplicateCommercialDetails = (): AppError =>
  new AppError(409, 'COMMERCIAL_DETAILS_ALREADY_EXISTS', 'CommercialDetails already exists for this batch');

const toPrismaScheme = (
  scheme: Prisma.InputJsonValue | null | undefined,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined => {
  if (scheme === undefined) return undefined;
  return scheme === null ? Prisma.DbNull : scheme;
};

const toPublicCommercialDetails = (details: CommercialDetailsRecord): PublicCommercialDetails => ({
  id: details.id,
  batchId: details.batchId,
  batch: {
    id: details.batch.id,
    batchNumber: details.batch.batchNumber,
    manufacturingDate: details.batch.manufacturingDate,
    expiryDate: details.batch.expiryDate,
  },
  medicine: details.batch.medicine,
  purchaseRate: Number(details.purchaseRate),
  mrp: Number(details.mrp),
  discountPercent: Number(details.discountPercent),
  scheme: details.scheme,
  privateNotes: details.privateNotes,
  updatedAt: details.updatedAt,
  updatedBy: details.updatedByUser,
});

export const getCommercialDetails = async (
  batchId: string,
  db: CommercialDetailsStore = prisma,
): Promise<PublicCommercialDetails> => {
  const batch = await db.batch.findUnique({
    where: { id: batchId },
    select: { id: true, medicineId: true, batchNumber: true, manufacturingDate: true, expiryDate: true },
  });
  if (!batch) throw batchNotFound();

  const details = await db.commercialDetails.findUnique({
    where: { batchId },
    include: commercialDetailsInclude,
  });
  if (!details) throw commercialDetailsNotFound();
  return toPublicCommercialDetails(details);
};

export const createCommercialDetails = async (
  batchId: string,
  input: CreateCommercialDetailsInput,
  updatedBy: string,
  db: CommercialDetailsStore = prisma,
): Promise<PublicCommercialDetails> => {
  const batch = await db.batch.findUnique({
    where: { id: batchId },
    select: { id: true, medicineId: true, batchNumber: true, manufacturingDate: true, expiryDate: true },
  });
  if (!batch) throw batchNotFound();

  const existing = await db.commercialDetails.findUnique({
    where: { batchId },
    include: commercialDetailsInclude,
  });
  if (existing) throw duplicateCommercialDetails();

  try {
    const details = await db.commercialDetails.create({
      data: {
        batchId,
        purchaseRate: input.purchaseRate,
        mrp: input.mrp,
        discountPercent: input.discountPercent,
        scheme: toPrismaScheme(input.scheme ?? null) ?? Prisma.DbNull,
        privateNotes: input.privateNotes ?? null,
        updatedBy,
      },
      include: commercialDetailsInclude,
    });
    return toPublicCommercialDetails(details);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw duplicateCommercialDetails();
    }
    throw error;
  }
};

export const updateCommercialDetails = async (
  batchId: string,
  input: UpdateCommercialDetailsInput,
  updatedBy: string,
  db: CommercialDetailsStore = prisma,
): Promise<PublicCommercialDetails> => {
  const existing = await db.commercialDetails.findUnique({
    where: { batchId },
    include: commercialDetailsInclude,
  });
  if (!existing) throw commercialDetailsNotFound();

  const schemeValue = toPrismaScheme(input.scheme);

  const details = await db.commercialDetails.update({
    where: { batchId },
    data: {
      ...(input.purchaseRate === undefined ? {} : { purchaseRate: input.purchaseRate }),
      ...(input.mrp === undefined ? {} : { mrp: input.mrp }),
      ...(input.discountPercent === undefined ? {} : { discountPercent: input.discountPercent }),
      ...(schemeValue === undefined ? {} : { scheme: schemeValue }),
      ...(input.privateNotes === undefined ? {} : { privateNotes: input.privateNotes }),
      updatedBy,
    },
    include: commercialDetailsInclude,
  });
  return toPublicCommercialDetails(details);
};

export const getCommercialDetailsForMedicine = async (
  medicineId: string,
  db = prisma,
): Promise<PublicCommercialDetails> => {
  const medicine = await db.medicine.findUnique({
    where: { id: medicineId },
    select: { id: true, name: true },
  });
  if (!medicine) throw medicineNotFound();

  const latestBatch = await getLatestBatchForMedicine(medicineId, db);
  if (!latestBatch || !latestBatch.commercialDetails) {
    throw commercialDetailsNotFound();
  }

  const details = await db.commercialDetails.findUnique({
    where: { batchId: latestBatch.id },
    include: commercialDetailsInclude,
  });
  if (!details) throw commercialDetailsNotFound();

  return toPublicCommercialDetails(details);
};

export const createCommercialDetailsForMedicine = async (
  medicineId: string,
  input: CreateCommercialDetailsInput,
  updatedBy: string,
  db = prisma,
): Promise<PublicCommercialDetails> => {
  const medicine = await db.medicine.findUnique({
    where: { id: medicineId },
    select: { id: true, name: true },
  });
  if (!medicine) throw medicineNotFound();

  return (db as unknown as typeof prisma).$transaction(async (tx) => {
    let latestBatch = await getLatestBatchForMedicine(medicineId, tx);

    if (!latestBatch) {
      latestBatch = await tx.batch.create({
        data: {
          medicineId,
          batchNumber: 'BATCH-001',
          manufacturingDate: new Date(),
          expiryDate: new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000),
        },
        include: {
          medicine: { select: { id: true, name: true, active: true } },
          commercialDetails: {
            include: {
              updatedByUser: { select: { id: true, name: true } },
            },
          },
        },
      });
    }

    if (latestBatch.commercialDetails) {
      throw duplicateCommercialDetails();
    }

    const details = await tx.commercialDetails.create({
      data: {
        batchId: latestBatch.id,
        purchaseRate: input.purchaseRate,
        mrp: input.mrp,
        discountPercent: input.discountPercent,
        scheme: toPrismaScheme(input.scheme ?? null) ?? Prisma.DbNull,
        privateNotes: input.privateNotes ?? null,
        updatedBy,
      },
      include: commercialDetailsInclude,
    });

    return toPublicCommercialDetails(details);
  });
};

export const updateCommercialDetailsForMedicine = async (
  medicineId: string,
  input: UpdateCommercialDetailsInput,
  updatedBy: string,
  db = prisma,
): Promise<PublicCommercialDetails> => {
  const medicine = await db.medicine.findUnique({
    where: { id: medicineId },
    select: { id: true, name: true },
  });
  if (!medicine) throw medicineNotFound();

  return (db as unknown as typeof prisma).$transaction(async (tx) => {
    let latestBatch = await getLatestBatchForMedicine(medicineId, tx);

    if (!latestBatch) {
      latestBatch = await tx.batch.create({
        data: {
          medicineId,
          batchNumber: 'BATCH-001',
          manufacturingDate: new Date(),
          expiryDate: new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000),
        },
        include: {
          medicine: { select: { id: true, name: true, active: true } },
          commercialDetails: {
            include: {
              updatedByUser: { select: { id: true, name: true } },
            },
          },
        },
      });
    }

    const schemeValue = toPrismaScheme(input.scheme);

    if (latestBatch.commercialDetails) {
      const details = await tx.commercialDetails.update({
        where: { batchId: latestBatch.id },
        data: {
          ...(input.purchaseRate === undefined ? {} : { purchaseRate: input.purchaseRate }),
          ...(input.mrp === undefined ? {} : { mrp: input.mrp }),
          ...(input.discountPercent === undefined ? {} : { discountPercent: input.discountPercent }),
          ...(schemeValue === undefined ? {} : { scheme: schemeValue }),
          ...(input.privateNotes === undefined ? {} : { privateNotes: input.privateNotes }),
          updatedBy,
        },
        include: commercialDetailsInclude,
      });
      return toPublicCommercialDetails(details);
    } else {
      const details = await tx.commercialDetails.create({
        data: {
          batchId: latestBatch.id,
          purchaseRate: input.purchaseRate ?? 0,
          mrp: input.mrp ?? 0,
          discountPercent: input.discountPercent ?? 0,
          scheme: schemeValue ?? Prisma.DbNull,
          privateNotes: input.privateNotes ?? null,
          updatedBy,
        },
        include: commercialDetailsInclude,
      });
      return toPublicCommercialDetails(details);
    }
  });
};
