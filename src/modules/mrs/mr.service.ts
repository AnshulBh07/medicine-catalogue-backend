import { Prisma, type MR, type Medicine, type Manufacturer } from '@prisma/client/index';
import { AppError } from '../../common/errors/app-error.js';
import { prisma } from '../../lib/prisma.js';
import type { PublicMedicine } from '../medicines/medicine.service.js';
import type {
  AssignMrMedicinesInput,
  CreateMrInput,
  ListMrsInput,
  MrSortField,
  SortOrder,
  UpdateMrInput,
} from './mr.schemas.js';

export type AssociatedMedicine = {
  id: string;
  name: string;
  form: Medicine['form'];
  manufacturer: Pick<Manufacturer, 'id' | 'name'>;
};

export type PublicMr = Pick<
  MR,
  'id' | 'name' | 'company' | 'phone' | 'email' | 'notes' | 'active' | 'createdAt' | 'updatedAt'
> & {
  medicinesCount?: number;
  medicines?: AssociatedMedicine[];
};

type MrWithRelations = MR & {
  _count?: {
    medicines: number;
  };
  medicines?: Array<
    Pick<Medicine, 'id' | 'name' | 'form'> & {
      manufacturer: Pick<Manufacturer, 'id' | 'name'>;
    }
  >;
};

export interface MrStore {
  mR: {
    findMany(args: {
      where?: Prisma.MRWhereInput;
      orderBy?: Prisma.MROrderByWithRelationInput;
      skip?: number;
      take?: number;
      include?: {
        _count?: { select: { medicines: boolean } };
        medicines?: {
          where?: Prisma.MedicineWhereInput;
          select?: {
            id: boolean;
            name: boolean;
            form: boolean;
            manufacturer: { select: { id: boolean; name: boolean } };
          };
          orderBy?: Prisma.MedicineOrderByWithRelationInput;
        };
      };
    }): PromiseLike<MrWithRelations[]>;
    findUnique(args: {
      where: { id: string };
      include?: {
        _count?: { select: { medicines: boolean } };
        medicines?: {
          where?: Prisma.MedicineWhereInput;
          select?: {
            id: boolean;
            name: boolean;
            form: boolean;
            manufacturer: { select: { id: boolean; name: boolean } };
          };
          orderBy?: Prisma.MedicineOrderByWithRelationInput;
        };
      };
    }): PromiseLike<MrWithRelations | null>;
    count(args?: { where?: Prisma.MRWhereInput }): PromiseLike<number>;
    create(args: {
      data: {
        name: string;
        company: string | null;
        phone: string | null;
        email: string | null;
        notes: string | null;
        active: true;
      };
    }): PromiseLike<MR>;
    update(args: {
      where: { id: string };
      data: Partial<{
        name: string;
        company: string | null;
        phone: string | null;
        email: string | null;
        notes: string | null;
        active: boolean;
      }>;
    }): PromiseLike<MR>;
  };
}

const toPublicMr = (mr: MrWithRelations): PublicMr => ({
  id: mr.id,
  name: mr.name,
  company: mr.company,
  phone: mr.phone,
  email: mr.email,
  notes: mr.notes,
  active: mr.active,
  medicinesCount: mr._count?.medicines ?? (mr.medicines ? mr.medicines.length : 0),
  medicines: mr.medicines?.map((m) => ({
    id: m.id,
    name: m.name,
    form: m.form,
    manufacturer: {
      id: m.manufacturer.id,
      name: m.manufacturer.name,
    },
  })),
  createdAt: mr.createdAt,
  updatedAt: mr.updatedAt,
});

const mrNotFound = (): AppError => new AppError(404, 'MR_NOT_FOUND', 'MR not found');

const getOrderBy = (
  sortBy: MrSortField = 'name',
  sortOrder: SortOrder = 'asc',
): Prisma.MROrderByWithRelationInput => {
  return { [sortBy]: sortOrder };
};

export const listMrs = async (
  input: ListMrsInput,
  db: MrStore = prisma,
): Promise<{ mrs: PublicMr[]; total: number; page: number; limit: number }> => {
  const where: Prisma.MRWhereInput = {
    ...(input.includeInactive ? {} : { active: true }),
  };

  if (input.company) {
    where.company = { contains: input.company, mode: 'insensitive' };
  }

  if (input.search) {
    const term = input.search;
    where.OR = [
      { name: { contains: term, mode: 'insensitive' } },
      { company: { contains: term, mode: 'insensitive' } },
      { phone: { contains: term, mode: 'insensitive' } },
      { email: { contains: term, mode: 'insensitive' } },
    ];
  }

  const page = Math.max(1, Number(input.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(input.limit) || 50));
  const skip = (page - 1) * limit;

  const [mrs, total] = await Promise.all([
    db.mR.findMany({
      where,
      orderBy: getOrderBy(input.sortBy, input.sortOrder),
      skip,
      take: limit,
      include: {
        _count: {
          select: { medicines: true },
        },
      },
    }),
    db.mR.count({ where }),
  ]);

  return {
    mrs: mrs.map(toPublicMr),
    total,
    page,
    limit,
  };
};

export const getMr = async (
  id: string,
  includeInactive: boolean,
  db: MrStore = prisma,
): Promise<PublicMr> => {
  const mr = await db.mR.findUnique({
    where: { id },
    include: {
      _count: {
        select: { medicines: true },
      },
      medicines: {
        where: includeInactive ? {} : { active: true },
        select: {
          id: true,
          name: true,
          form: true,
          manufacturer: {
            select: { id: true, name: true },
          },
        },
        orderBy: { name: 'asc' },
      },
    },
  });

  if (!mr || (!includeInactive && !mr.active)) throw mrNotFound();
  return toPublicMr(mr);
};

export const createMr = async (
  input: CreateMrInput,
  db: MrStore = prisma,
): Promise<PublicMr> => {
  try {
    const mr = await db.mR.create({
      data: {
        name: input.name,
        company: input.company ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        notes: input.notes ?? null,
        active: true,
      },
    });
    return toPublicMr(mr);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError(409, 'DUPLICATE_MR', 'MR conflicts with an existing record');
    }
    throw error;
  }
};

export const updateMr = async (
  id: string,
  input: UpdateMrInput,
  db: MrStore = prisma,
): Promise<PublicMr> => {
  const existing = await db.mR.findUnique({ where: { id } });
  if (!existing) throw mrNotFound();

  try {
    const updated = await db.mR.update({
      where: { id },
      data: {
        name: input.name,
        company: input.company !== undefined ? input.company : existing.company,
        phone: input.phone !== undefined ? input.phone : existing.phone,
        email: input.email !== undefined ? input.email : existing.email,
        notes: input.notes !== undefined ? input.notes : existing.notes,
        active: input.active !== undefined ? input.active : existing.active,
      },
    });
    return toPublicMr(updated);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError(409, 'DUPLICATE_MR', 'MR conflicts with an existing record');
    }
    throw error;
  }
};

export const deactivateMr = async (
  id: string,
  db: MrStore = prisma,
): Promise<PublicMr> => {
  const existing = await db.mR.findUnique({ where: { id } });
  if (!existing) throw mrNotFound();
  if (!existing.active) return toPublicMr(existing);

  const updated = await db.mR.update({ where: { id }, data: { active: false } });
  return toPublicMr(updated);
};

export const getMrMedicines = async (
  mrId: string,
  includeInactive: boolean = false,
): Promise<{ medicines: PublicMedicine[]; count: number }> => {
  const mr = await prisma.mR.findUnique({ where: { id: mrId } });
  if (!mr || (!includeInactive && !mr.active)) throw mrNotFound();

  const medicines = await prisma.medicine.findMany({
    where: {
      mrId,
      ...(includeInactive ? {} : { active: true }),
    },
    include: {
      composition: { select: { id: true, displayText: true } },
      manufacturer: { select: { id: true, name: true } },
      mr: { select: { id: true, name: true, company: true, phone: true } },
      commercialDetails: { select: { mrp: true } },
    },
    orderBy: { name: 'asc' },
  });

  const publicMedicines: PublicMedicine[] = medicines.map((m) => ({
    id: m.id,
    name: m.name,
    composition: m.composition,
    form: m.form,
    packQuantity: Number(m.packQuantity),
    packUnit: m.packUnit,
    shortDescription: m.shortDescription,
    imageUrl: m.imageUrl,
    uses: m.uses,
    recommendedAgeGroup: m.recommendedAgeGroup,
    directions: m.directions,
    warnings: m.warnings,
    storageInstructions: m.storageInstructions,
    barcode: m.barcode,
    prescriptionRequired: m.prescriptionRequired,
    manufacturer: m.manufacturer,
    mr: m.mr,
    active: m.active,
    mrp: m.commercialDetails ? Number(m.commercialDetails.mrp) : null,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  }));

  return {
    medicines: publicMedicines,
    count: publicMedicines.length,
  };
};

export const assignMrMedicines = async (
  mrId: string,
  input: AssignMrMedicinesInput,
): Promise<{ medicines: PublicMedicine[]; count: number }> => {
  const mr = await prisma.mR.findUnique({ where: { id: mrId } });
  if (!mr) throw mrNotFound();

  const uniqueIds = [...new Set(input.medicineIds)];

  if (uniqueIds.length > 0) {
    const existingMedicines = await prisma.medicine.findMany({
      where: { id: { in: uniqueIds } },
      include: { mr: { select: { id: true, name: true } } },
    });

    if (existingMedicines.length !== uniqueIds.length) {
      throw new AppError(404, 'MEDICINE_NOT_FOUND', 'One or more specified medicines do not exist');
    }

    // Check for conflict with other MR assignments
    const conflicting = existingMedicines.filter((m) => m.mrId && m.mrId !== mrId);
    if (conflicting.length > 0 && !input.allowReassign) {
      const firstConflict = conflicting[0]!;
      throw new AppError(
        409,
        'ASSIGNMENT_CONFLICT',
        `Medicine '${firstConflict.name}' is already assigned to representative '${firstConflict.mr?.name || 'another representative'}'.`,
      );
    }
  }

  // Execute in transaction
  const updatedMedicines = await prisma.$transaction(async (tx) => {
    // 1. Unassign medicines previously assigned to this MR that are not in uniqueIds
    await tx.medicine.updateMany({
      where: {
        mrId,
        id: { notIn: uniqueIds },
      },
      data: { mrId: null },
    });

    // 2. Assign medicines in uniqueIds to this MR
    if (uniqueIds.length > 0) {
      await tx.medicine.updateMany({
        where: { id: { in: uniqueIds } },
        data: { mrId },
      });
    }

    // 3. Return updated list of medicines
    return tx.medicine.findMany({
      where: { mrId, active: true },
      include: {
        composition: { select: { id: true, displayText: true } },
        manufacturer: { select: { id: true, name: true } },
        mr: { select: { id: true, name: true, company: true, phone: true } },
        commercialDetails: { select: { mrp: true } },
      },
      orderBy: { name: 'asc' },
    });
  });

  const publicMedicines: PublicMedicine[] = updatedMedicines.map((m) => ({
    id: m.id,
    name: m.name,
    composition: m.composition,
    form: m.form,
    packQuantity: Number(m.packQuantity),
    packUnit: m.packUnit,
    shortDescription: m.shortDescription,
    imageUrl: m.imageUrl,
    uses: m.uses,
    recommendedAgeGroup: m.recommendedAgeGroup,
    directions: m.directions,
    warnings: m.warnings,
    storageInstructions: m.storageInstructions,
    barcode: m.barcode,
    prescriptionRequired: m.prescriptionRequired,
    manufacturer: m.manufacturer,
    mr: m.mr,
    active: m.active,
    mrp: m.commercialDetails ? Number(m.commercialDetails.mrp) : null,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  }));

  return {
    medicines: publicMedicines,
    count: publicMedicines.length,
  };
};
