import { Prisma, type Manufacturer } from '@prisma/client/index';
import { AppError } from '../../common/errors/app-error.js';
import { prisma } from '../../lib/prisma.js';
import type {
  CreateManufacturerInput,
  ListManufacturersInput,
  UpdateManufacturerInput,
} from './manufacturer.schemas.js';

export type PublicManufacturer = Pick<
  Manufacturer,
  'id' | 'name' | 'active' | 'createdAt' | 'updatedAt'
> & {
  medicinesCount?: number;
  medicines?: Array<{
    id: string;
    name: string;
    form: string;
    packQuantity: number;
    packUnit: string;
    active: boolean;
    composition?: {
      id: string;
      displayText: string;
    } | null;
  }>;
};

const toPublicManufacturer = (
  manufacturer: Manufacturer & {
    _count?: { medicines: number };
    medicines?: Array<{
      id: string;
      name: string;
      form: string;
      packQuantity: number | Prisma.Decimal;
      packUnit: string;
      active: boolean;
      composition?: { id: string; displayText: string } | null;
    }>;
  },
): PublicManufacturer => ({
  id: manufacturer.id,
  name: manufacturer.name,
  active: manufacturer.active,
  medicinesCount: manufacturer._count?.medicines ?? manufacturer.medicines?.length ?? 0,
  ...(manufacturer.medicines
    ? {
        medicines: manufacturer.medicines.map((m) => ({
          ...m,
          packQuantity: Number(m.packQuantity),
        })),
      }
    : {}),
  createdAt: manufacturer.createdAt,
  updatedAt: manufacturer.updatedAt,
});

const manufacturerNotFound = (): AppError =>
  new AppError(404, 'MANUFACTURER_NOT_FOUND', 'Manufacturer not found');

const duplicateManufacturer = (): AppError =>
  new AppError(409, 'DUPLICATE_MANUFACTURER', 'A manufacturer with this name already exists');

const ensureUniqueName = async (
  name: string,
  db: typeof prisma | Prisma.TransactionClient = prisma,
  id?: string,
): Promise<void> => {
  const existing = await db.manufacturer.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
  });
  if (existing && existing.id !== id) throw duplicateManufacturer();
};

export const listManufacturers = async (
  input: ListManufacturersInput,
  db: typeof prisma = prisma,
): Promise<PublicManufacturer[]> => {
  const where: Prisma.ManufacturerWhereInput = {
    ...(input.active === 'active'
      ? { active: true }
      : input.active === 'inactive'
        ? { active: false }
        : input.includeInactive || input.active === 'all'
          ? {}
          : { active: true }),
    ...(input.search?.trim()
      ? { name: { contains: input.search.trim(), mode: 'insensitive' } }
      : {}),
  };

  const manufacturers = await db.manufacturer.findMany({
    where,
    include: {
      _count: {
        select: { medicines: true },
      },
    },
    orderBy: { name: 'asc' },
  });

  let filtered = manufacturers;
  if (input.hasMedicines === 'true') {
    filtered = filtered.filter((m) => m._count.medicines > 0);
  } else if (input.hasMedicines === 'false') {
    filtered = filtered.filter((m) => m._count.medicines === 0);
  }

  const sortBy = input.sortBy || 'name_asc';
  filtered.sort((a, b) => {
    switch (sortBy) {
      case 'name_desc':
        return b.name.localeCompare(a.name);
      case 'newest':
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      case 'oldest':
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      case 'medicines_high':
        return (b._count?.medicines ?? 0) - (a._count?.medicines ?? 0) || a.name.localeCompare(b.name);
      case 'medicines_low':
        return (a._count?.medicines ?? 0) - (b._count?.medicines ?? 0) || a.name.localeCompare(b.name);
      case 'name_asc':
      default:
        return a.name.localeCompare(b.name);
    }
  });

  return filtered.map(toPublicManufacturer);
};

export const getManufacturer = async (
  id: string,
  includeInactive: boolean,
  db: typeof prisma = prisma,
): Promise<PublicManufacturer> => {
  const manufacturer = await db.manufacturer.findUnique({
    where: { id },
    include: {
      _count: {
        select: { medicines: true },
      },
      medicines: {
        select: {
          id: true,
          name: true,
          form: true,
          packQuantity: true,
          packUnit: true,
          active: true,
          composition: {
            select: {
              id: true,
              displayText: true,
            },
          },
        },
        orderBy: { name: 'asc' },
      },
    },
  });
  if (!manufacturer || (!includeInactive && !manufacturer.active)) throw manufacturerNotFound();
  return toPublicManufacturer(manufacturer);
};

export const createManufacturer = async (
  input: CreateManufacturerInput,
  db: typeof prisma = prisma,
): Promise<PublicManufacturer> => {
  await ensureUniqueName(input.name, db);
  try {
    const created = await db.manufacturer.create({
      data: { name: input.name, active: true },
    });
    return {
      id: created.id,
      name: created.name,
      active: created.active,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw duplicateManufacturer();
    }
    throw error;
  }
};

export const updateManufacturer = async (
  id: string,
  input: UpdateManufacturerInput,
  db: typeof prisma = prisma,
): Promise<PublicManufacturer> => {
  const existing = await db.manufacturer.findUnique({ where: { id } });
  if (!existing) throw manufacturerNotFound();
  if (input.name !== undefined) await ensureUniqueName(input.name, db, id);

  try {
    const updated = await db.manufacturer.update({ where: { id }, data: input });
    return {
      id: updated.id,
      name: updated.name,
      active: updated.active,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw duplicateManufacturer();
    }
    throw error;
  }
};

export const deleteManufacturer = async (
  id: string,
  db: typeof prisma = prisma,
): Promise<{ success: true; deletedManufacturerId: string; name: string }> => {
  const existing = await db.manufacturer.findUnique({
    where: { id },
    include: {
      _count: {
        select: { medicines: true },
      },
    },
  });
  if (!existing) throw manufacturerNotFound();

  const count = existing._count?.medicines ?? 0;
  if (count > 0) {
    throw new AppError(
      409,
      'MANUFACTURER_IN_USE',
      `This manufacturer cannot be deleted because it is associated with ${count} medicine(s). Deactivate the manufacturer instead to preserve catalogue records.`,
      { medicineCount: count },
    );
  }

  await db.manufacturer.delete({ where: { id } });
  return {
    success: true,
    deletedManufacturerId: id,
    name: existing.name,
  };
};

export const deactivateManufacturer = async (
  id: string,
  db: typeof prisma = prisma,
): Promise<PublicManufacturer> => {
  const existing = await db.manufacturer.findUnique({ where: { id } });
  if (!existing) throw manufacturerNotFound();
  if (!existing.active) return toPublicManufacturer(existing);
  return toPublicManufacturer(
    await db.manufacturer.update({
      where: { id },
      data: { active: false },
    }),
  );
};

export const reactivateManufacturer = async (
  id: string,
  db: typeof prisma = prisma,
): Promise<PublicManufacturer> => {
  return updateManufacturer(id, { active: true }, db);
};
