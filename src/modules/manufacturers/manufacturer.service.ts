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
>;

type SearchFilter = {
  contains: string;
  mode: 'insensitive';
};

export interface ManufacturerStore {
  manufacturer: {
    findMany(args: {
      where: { active?: boolean; name?: SearchFilter };
      orderBy: { name: 'asc' };
    }): PromiseLike<Manufacturer[]>;
    findFirst(args: { where: { name: { equals: string; mode: 'insensitive' } } }): PromiseLike<Manufacturer | null>;
    findUnique(args: { where: { id: string } }): PromiseLike<Manufacturer | null>;
    create(args: { data: { name: string; active: true } }): PromiseLike<Manufacturer>;
    update(args: {
      where: { id: string };
      data: Partial<{ name: string; active: boolean }>;
    }): PromiseLike<Manufacturer>;
  };
}

const toPublicManufacturer = (manufacturer: Manufacturer): PublicManufacturer => ({
  id: manufacturer.id,
  name: manufacturer.name,
  active: manufacturer.active,
  createdAt: manufacturer.createdAt,
  updatedAt: manufacturer.updatedAt,
});

const manufacturerNotFound = (): AppError =>
  new AppError(404, 'MANUFACTURER_NOT_FOUND', 'Manufacturer not found');

const duplicateManufacturer = (): AppError =>
  new AppError(409, 'DUPLICATE_MANUFACTURER', 'A manufacturer with this name already exists');

const ensureUniqueName = async (
  name: string,
  db: ManufacturerStore,
  id?: string,
): Promise<void> => {
  const existing = await db.manufacturer.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
  });
  if (existing && existing.id !== id) throw duplicateManufacturer();
};

export const listManufacturers = async (
  input: ListManufacturersInput,
  db: ManufacturerStore = prisma,
): Promise<PublicManufacturer[]> => {
  const manufacturers = await db.manufacturer.findMany({
    where: {
      ...(input.includeInactive ? {} : { active: true }),
      ...(input.search ? { name: { contains: input.search, mode: 'insensitive' } } : {}),
    },
    orderBy: { name: 'asc' },
  });
  return manufacturers.map(toPublicManufacturer);
};

export const getManufacturer = async (
  id: string,
  includeInactive: boolean,
  db: ManufacturerStore = prisma,
): Promise<PublicManufacturer> => {
  const manufacturer = await db.manufacturer.findUnique({ where: { id } });
  if (!manufacturer || (!includeInactive && !manufacturer.active)) throw manufacturerNotFound();
  return toPublicManufacturer(manufacturer);
};

export const createManufacturer = async (
  input: CreateManufacturerInput,
  db: ManufacturerStore = prisma,
): Promise<PublicManufacturer> => {
  await ensureUniqueName(input.name, db);
  try {
    return toPublicManufacturer(await db.manufacturer.create({
      data: { name: input.name, active: true },
    }));
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
  db: ManufacturerStore = prisma,
): Promise<PublicManufacturer> => {
  const existing = await db.manufacturer.findUnique({ where: { id } });
  if (!existing) throw manufacturerNotFound();
  if (input.name !== undefined) await ensureUniqueName(input.name, db, id);

  try {
    return toPublicManufacturer(await db.manufacturer.update({ where: { id }, data: input }));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw duplicateManufacturer();
    }
    throw error;
  }
};

export const deactivateManufacturer = async (
  id: string,
  db: ManufacturerStore = prisma,
): Promise<PublicManufacturer> => {
  const existing = await db.manufacturer.findUnique({ where: { id } });
  if (!existing) throw manufacturerNotFound();
  if (!existing.active) return toPublicManufacturer(existing);
  return toPublicManufacturer(await db.manufacturer.update({
    where: { id },
    data: { active: false },
  }));
};
