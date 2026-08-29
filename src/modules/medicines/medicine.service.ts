import { Prisma, type Composition, type Manufacturer, type Medicine, type MR } from '@prisma/client/index';
import { AppError } from '../../common/errors/app-error.js';
import { prisma } from '../../lib/prisma.js';
import type {
  CreateMedicineInput,
  ListMedicinesInput,
  MedicineSortField,
  SortOrder,
  UpdateMedicineInput,
} from './medicine.schemas.js';

type CompositionReference = Pick<Composition, 'id' | 'displayText'>;
type ManufacturerReference = Pick<Manufacturer, 'id' | 'name'>;
type MrReference = Pick<MR, 'id' | 'name' | 'company' | 'phone'>;

type MedicineRecord = Medicine & {
  composition: CompositionReference;
  manufacturer: ManufacturerReference;
  mr: MrReference | null;
  commercialDetails: { mrp: Prisma.Decimal } | null;
};

export type PublicMedicine = {
  id: string;
  name: string;
  composition: CompositionReference;
  form: Medicine['form'];
  packQuantity: number;
  packUnit: Medicine['packUnit'];
  shortDescription: string | null;
  imageUrl: string | null;
  uses: string | null;
  recommendedAgeGroup: string | null;
  directions: string | null;
  warnings: string | null;
  storageInstructions: string | null;
  barcode: string | null;
  prescriptionRequired: boolean;
  manufacturer: ManufacturerReference;
  mr: MrReference | null;
  active: boolean;
  mrp: number | null;
  createdAt: Date;
  updatedAt: Date;
};

const medicineInclude = {
  composition: { select: { id: true, displayText: true } },
  manufacturer: { select: { id: true, name: true } },
  mr: { select: { id: true, name: true, company: true, phone: true } },
  commercialDetails: { select: { mrp: true } },
} as const;

type ReferenceStore = {
  composition: {
    findUnique(args: {
      where: { id: string };
      select: { id: true; displayText: true; active: true };
    }): PromiseLike<Pick<Composition, 'id' | 'displayText' | 'active'> | null>;
  };
  manufacturer: {
    findUnique(args: {
      where: { id: string };
      select: { id: true; name: true; active: true };
    }): PromiseLike<Pick<Manufacturer, 'id' | 'name' | 'active'> | null>;
  };
  mR: {
    findUnique(args: {
      where: { id: string };
      select: { id: true; name: true; company: true; phone: true; active: true };
    }): PromiseLike<Pick<MR, 'id' | 'name' | 'company' | 'phone' | 'active'> | null>;
  };
};

export interface MedicineStore extends ReferenceStore {
  medicine: {
    findMany(args: {
      where: {
        active?: boolean;
        name?: { contains: string; mode: 'insensitive' };
        form?: Medicine['form'];
        manufacturerId?: string;
        mrId?: string;
        commercialDetails?: {
          mrp?: {
            gte?: number;
            lte?: number;
          };
        };
      };
      include: typeof medicineInclude;
      orderBy?:
        | { name?: 'asc' | 'desc' }
        | { packQuantity?: 'asc' | 'desc' }
        | { createdAt?: 'asc' | 'desc' }
        | { updatedAt?: 'asc' | 'desc' }
        | { commercialDetails?: { mrp?: 'asc' | 'desc' } }
        | Record<string, unknown>;
    }): PromiseLike<MedicineRecord[]>;
    findUnique(args: {
      where: { id: string };
      include: typeof medicineInclude;
    }): PromiseLike<MedicineRecord | null>;
    create(args: {
      data: {
        name: string;
        compositionId: string;
        form: Medicine['form'];
        packQuantity: number;
        packUnit: Medicine['packUnit'];
        shortDescription: string | null;
        imageUrl: string | null;
        uses: string | null;
        recommendedAgeGroup: string | null;
        directions: string | null;
        warnings: string | null;
        storageInstructions: string | null;
        barcode: string | null;
        prescriptionRequired: boolean;
        manufacturerId: string;
        mrId: string | null;
        active: true;
      };
      include: typeof medicineInclude;
    }): PromiseLike<MedicineRecord>;
    update(args: {
      where: { id: string };
      data: Partial<{
        name: string;
        compositionId: string;
        form: Medicine['form'];
        packQuantity: number;
        packUnit: Medicine['packUnit'];
        shortDescription: string | null;
        imageUrl: string | null;
        uses: string | null;
        recommendedAgeGroup: string | null;
        directions: string | null;
        warnings: string | null;
        storageInstructions: string | null;
        barcode: string | null;
        prescriptionRequired: boolean;
        manufacturerId: string;
        mrId: string | null;
        active: boolean;
      }>;
      include: typeof medicineInclude;
    }): PromiseLike<MedicineRecord>;
  };
}

const toPublicMedicine = (medicine: MedicineRecord): PublicMedicine => ({
  id: medicine.id,
  name: medicine.name,
  composition: medicine.composition,
  form: medicine.form,
  packQuantity: Number(medicine.packQuantity),
  packUnit: medicine.packUnit,
  shortDescription: medicine.shortDescription,
  imageUrl: medicine.imageUrl,
  uses: medicine.uses,
  recommendedAgeGroup: medicine.recommendedAgeGroup,
  directions: medicine.directions,
  warnings: medicine.warnings,
  storageInstructions: medicine.storageInstructions,
  barcode: medicine.barcode,
  prescriptionRequired: medicine.prescriptionRequired,
  manufacturer: medicine.manufacturer,
  mr: medicine.mr,
  active: medicine.active,
  mrp: medicine.commercialDetails ? Number(medicine.commercialDetails.mrp) : null,
  createdAt: medicine.createdAt,
  updatedAt: medicine.updatedAt,
});

const medicineNotFound = (): AppError =>
  new AppError(404, 'MEDICINE_NOT_FOUND', 'Medicine not found');

const referenceNotFound = (reference: string): AppError =>
  new AppError(404, `${reference.toUpperCase()}_NOT_FOUND`, `${reference} not found`);

const inactiveReference = (reference: string): AppError =>
  new AppError(409, `INACTIVE_${reference.toUpperCase()}`, `${reference} must be active`);

const ensureReferences = async (
  input: { compositionId?: string; manufacturerId?: string; mrId?: string | null },
  db: MedicineStore,
): Promise<void> => {
  if (input.compositionId !== undefined) {
    const composition = await db.composition.findUnique({
      where: { id: input.compositionId },
      select: { id: true, displayText: true, active: true },
    });
    if (!composition) throw referenceNotFound('composition');
    if (!composition.active) throw inactiveReference('composition');
  }

  if (input.manufacturerId !== undefined) {
    const manufacturer = await db.manufacturer.findUnique({
      where: { id: input.manufacturerId },
      select: { id: true, name: true, active: true },
    });
    if (!manufacturer) throw referenceNotFound('manufacturer');
    if (!manufacturer.active) throw inactiveReference('manufacturer');
  }

  if (input.mrId) {
    const mr = await db.mR.findUnique({
      where: { id: input.mrId },
      select: { id: true, name: true, company: true, phone: true, active: true },
    });
    if (!mr) throw referenceNotFound('mr');
    if (!mr.active) throw inactiveReference('mr');
  }
};

const getOrderBy = (
  sortBy: MedicineSortField = 'name',
  sortOrder: SortOrder = 'asc',
) => {
  switch (sortBy) {
    case 'mrp':
      return { commercialDetails: { mrp: sortOrder } };
    case 'packQuantity':
      return { packQuantity: sortOrder };
    case 'createdAt':
      return { createdAt: sortOrder };
    case 'updatedAt':
      return { updatedAt: sortOrder };
    case 'name':
    default:
      return { name: sortOrder };
  }
};

export const listMedicines = async (
  input: ListMedicinesInput,
  db: MedicineStore = prisma,
): Promise<PublicMedicine[]> => {
  const minPrice = input.minPrice ?? input.minMrp;
  const maxPrice = input.maxPrice ?? input.maxMrp;
  const sortBy = input.sortBy ?? 'name';
  const sortOrder = input.sortOrder ?? 'asc';

  const medicines = await db.medicine.findMany({
    where: {
      ...(input.includeInactive ? {} : { active: true }),
      ...(input.search ? { name: { contains: input.search, mode: 'insensitive' } } : {}),
      ...(input.form ? { form: input.form } : {}),
      ...(input.manufacturerId ? { manufacturerId: input.manufacturerId } : {}),
      ...(input.mrId ? { mrId: input.mrId } : {}),
      ...(minPrice !== undefined || maxPrice !== undefined
        ? {
            commercialDetails: {
              ...(minPrice !== undefined ? { mrp: { gte: minPrice } } : {}),
              ...(maxPrice !== undefined ? { mrp: { lte: maxPrice } } : {}),
            },
          }
        : {}),
    },
    include: medicineInclude,
    orderBy: getOrderBy(sortBy, sortOrder),
  });
  return medicines.map(toPublicMedicine);
};

export const getMedicine = async (
  id: string,
  includeInactive: boolean,
  db: MedicineStore = prisma,
): Promise<PublicMedicine> => {
  const medicine = await db.medicine.findUnique({ where: { id }, include: medicineInclude });
  if (!medicine || (!includeInactive && !medicine.active)) throw medicineNotFound();
  return toPublicMedicine(medicine);
};

const createData = (input: CreateMedicineInput) => ({
  name: input.name,
  compositionId: input.compositionId,
  form: input.form,
  packQuantity: input.packQuantity,
  packUnit: input.packUnit,
  shortDescription: input.shortDescription ?? null,
  imageUrl: input.imageUrl ?? null,
  uses: input.uses ?? null,
  recommendedAgeGroup: input.recommendedAgeGroup ?? null,
  directions: input.directions ?? null,
  warnings: input.warnings ?? null,
  storageInstructions: input.storageInstructions ?? null,
  barcode: input.barcode ? (input.barcode.trim() || null) : null,
  prescriptionRequired: input.prescriptionRequired,
  manufacturerId: input.manufacturerId,
  mrId: input.mrId ?? null,
  active: true as const,
});

export const createMedicine = async (
  input: CreateMedicineInput,
  db: MedicineStore = prisma,
): Promise<PublicMedicine> => {
  await ensureReferences(input, db);
  try {
    return toPublicMedicine(await db.medicine.create({ data: createData(input), include: medicineInclude }));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError(409, 'DUPLICATE_BARCODE', 'A medicine with this barcode already exists');
    }
    throw error;
  }
};

export const updateMedicine = async (
  id: string,
  input: UpdateMedicineInput,
  db: MedicineStore = prisma,
): Promise<PublicMedicine> => {
  const existing = await db.medicine.findUnique({ where: { id }, include: medicineInclude });
  if (!existing) throw medicineNotFound();
  await ensureReferences(input, db);

  const barcode = input.barcode !== undefined
    ? (input.barcode ? (input.barcode.trim() || null) : null)
    : undefined;

  try {
    return toPublicMedicine(await db.medicine.update({
      where: { id },
      data: {
        ...input,
        ...(input.barcode !== undefined ? { barcode } : {}),
      },
      include: medicineInclude,
    }));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError(409, 'DUPLICATE_BARCODE', 'A medicine with this barcode already exists');
    }
    throw error;
  }
};

export const deactivateMedicine = async (
  id: string,
  db: MedicineStore = prisma,
): Promise<PublicMedicine> => {
  const existing = await db.medicine.findUnique({ where: { id }, include: medicineInclude });
  if (!existing) throw medicineNotFound();
  if (!existing.active) return toPublicMedicine(existing);

  return toPublicMedicine(await db.medicine.update({
    where: { id },
    data: { active: false },
    include: medicineInclude,
  }));
};
