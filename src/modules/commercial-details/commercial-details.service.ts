import { Prisma, type CommercialDetails, type Medicine, type User } from '@prisma/client/index';
import { AppError } from '../../common/errors/app-error.js';
import { prisma } from '../../lib/prisma.js';
import type { CreateCommercialDetailsInput, UpdateCommercialDetailsInput } from './commercial-details.schemas.js';

type MedicineReference = Pick<Medicine, 'id' | 'name'>;
type UserReference = Pick<User, 'id' | 'name'>;
type CommercialDetailsRecord = CommercialDetails & {
  medicine: MedicineReference;
  updatedByUser: UserReference;
};

export type PublicCommercialDetails = {
  id: string;
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
  medicine: { select: { id: true, name: true } },
  updatedByUser: { select: { id: true, name: true } },
} as const;

export interface CommercialDetailsStore {
  medicine: {
    findUnique(args: {
      where: { id: string };
      select: { id: true; name: true };
    }): PromiseLike<MedicineReference | null>;
  };
  commercialDetails: {
    findUnique(args: {
      where: { medicineId: string };
      include: typeof commercialDetailsInclude;
    }): PromiseLike<CommercialDetailsRecord | null>;
    create(args: {
      data: {
        medicineId: string;
        purchaseRate: number;
        mrp: number;
        discountPercent: number;
        scheme: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
        privateNotes: string | null;
        updatedBy: string;
      };
      include: typeof commercialDetailsInclude;
    }): PromiseLike<CommercialDetailsRecord>;
    update(args: {
      where: { medicineId: string };
      data: {
        purchaseRate?: number;
        mrp?: number;
        discountPercent?: number;
        scheme?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
        privateNotes?: string | null;
        updatedBy: string;
      };
      include: typeof commercialDetailsInclude;
    }): PromiseLike<CommercialDetailsRecord>;
  };
}

const commercialDetailsNotFound = (): AppError =>
  new AppError(404, 'COMMERCIAL_DETAILS_NOT_FOUND', 'CommercialDetails not found');

const medicineNotFound = (): AppError =>
  new AppError(404, 'MEDICINE_NOT_FOUND', 'Medicine not found');

const duplicateCommercialDetails = (): AppError =>
  new AppError(409, 'COMMERCIAL_DETAILS_ALREADY_EXISTS', 'CommercialDetails already exists for this medicine');

const toPrismaScheme = (
  scheme: Prisma.InputJsonValue | null,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput =>
  scheme === null ? Prisma.DbNull : scheme;

const toPublicCommercialDetails = (details: CommercialDetailsRecord): PublicCommercialDetails => ({
  id: details.id,
  medicine: details.medicine,
  purchaseRate: Number(details.purchaseRate),
  mrp: Number(details.mrp),
  discountPercent: Number(details.discountPercent),
  scheme: details.scheme,
  privateNotes: details.privateNotes,
  updatedAt: details.updatedAt,
  updatedBy: details.updatedByUser,
});

export const getCommercialDetails = async (
  medicineId: string,
  db: CommercialDetailsStore = prisma,
): Promise<PublicCommercialDetails> => {
  const details = await db.commercialDetails.findUnique({
    where: { medicineId },
    include: commercialDetailsInclude,
  });
  if (!details) throw commercialDetailsNotFound();
  return toPublicCommercialDetails(details);
};

export const createCommercialDetails = async (
  medicineId: string,
  input: CreateCommercialDetailsInput,
  updatedBy: string,
  db: CommercialDetailsStore = prisma,
): Promise<PublicCommercialDetails> => {
  const medicine = await db.medicine.findUnique({
    where: { id: medicineId },
    select: { id: true, name: true },
  });
  if (!medicine) throw medicineNotFound();

  const existing = await db.commercialDetails.findUnique({
    where: { medicineId },
    include: commercialDetailsInclude,
  });
  if (existing) throw duplicateCommercialDetails();

  try {
    const details = await db.commercialDetails.create({
      data: {
        medicineId,
        purchaseRate: input.purchaseRate,
        mrp: input.mrp,
        discountPercent: input.discountPercent,
        scheme: toPrismaScheme(input.scheme ?? null),
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
  medicineId: string,
  input: UpdateCommercialDetailsInput,
  updatedBy: string,
  db: CommercialDetailsStore = prisma,
): Promise<PublicCommercialDetails> => {
  const existing = await db.commercialDetails.findUnique({
    where: { medicineId },
    include: commercialDetailsInclude,
  });
  if (!existing) throw commercialDetailsNotFound();

  const details = await db.commercialDetails.update({
    where: { medicineId },
    data: {
      ...(input.purchaseRate === undefined ? {} : { purchaseRate: input.purchaseRate }),
      ...(input.mrp === undefined ? {} : { mrp: input.mrp }),
      ...(input.discountPercent === undefined ? {} : { discountPercent: input.discountPercent }),
      ...(input.scheme === undefined ? {} : { scheme: toPrismaScheme(input.scheme) }),
      ...(input.privateNotes === undefined ? {} : { privateNotes: input.privateNotes }),
      updatedBy,
    },
    include: commercialDetailsInclude,
  });
  return toPublicCommercialDetails(details);
};
