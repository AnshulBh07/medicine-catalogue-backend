import { Prisma, type Salt } from '@prisma/client/index';
import { AppError } from '../../common/errors/app-error.js';
import { prisma } from '../../lib/prisma.js';
import type { CreateSaltInput, ListSaltsInput, UpdateSaltInput } from './salt.schemas.js';

export type PublicSalt = Pick<Salt, 'id' | 'name' | 'description' | 'active' | 'createdAt' | 'updatedAt'>;

type SaltNameFilter = { equals: string; mode: 'insensitive' };

export interface SaltStore {
  salt: {
    findMany(args: {
      where: { active?: boolean; name?: { contains: string; mode: 'insensitive' } };
      orderBy: { name: 'asc' };
    }): PromiseLike<Salt[]>;
    findFirst(args: { where: { name: SaltNameFilter } }): PromiseLike<Salt | null>;
    findUnique(args: { where: { id: string } }): PromiseLike<Salt | null>;
    create(args: {
      data: { name: string; description: string | null; active: true };
    }): PromiseLike<Salt>;
    update(args: {
      where: { id: string };
      data: { name?: string; description?: string | null; active?: boolean };
    }): PromiseLike<Salt>;
  };
}

const toPublicSalt = (salt: Salt): PublicSalt => ({
  id: salt.id,
  name: salt.name,
  description: salt.description,
  active: salt.active,
  createdAt: salt.createdAt,
  updatedAt: salt.updatedAt,
});

const duplicateSaltError = (): AppError =>
  new AppError(409, 'DUPLICATE_SALT', 'A salt with this name already exists');

const ensureUniqueName = async (name: string, db: SaltStore, id?: string): Promise<void> => {
  const existing = await db.salt.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
  if (existing && existing.id !== id) {
    throw duplicateSaltError();
  }
};

export const listSalts = async (
  input: ListSaltsInput,
  db: SaltStore = prisma,
): Promise<PublicSalt[]> => {
  const salts = await db.salt.findMany({
    where: {
      ...(input.active === 'active' ? { active: true } : {}),
      ...(input.active === 'inactive' ? { active: false } : {}),
      ...(input.search ? { name: { contains: input.search, mode: 'insensitive' } } : {}),
    },
    orderBy: { name: 'asc' },
  });

  return salts.map(toPublicSalt);
};

export const getSalt = async (
  id: string,
  includeInactive: boolean,
  db: SaltStore = prisma,
): Promise<PublicSalt> => {
  const salt = await db.salt.findUnique({ where: { id } });
  if (!salt || (!includeInactive && !salt.active)) {
    throw new AppError(404, 'SALT_NOT_FOUND', 'Salt not found');
  }

  return toPublicSalt(salt);
};

export const createSalt = async (
  input: CreateSaltInput,
  db: SaltStore = prisma,
): Promise<PublicSalt> => {
  await ensureUniqueName(input.name, db);

  try {
    return toPublicSalt(await db.salt.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        active: true,
      },
    }));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw duplicateSaltError();
    }
    throw error;
  }
};

export const updateSalt = async (
  id: string,
  input: UpdateSaltInput,
  db: SaltStore = prisma,
): Promise<PublicSalt> => {
  const existing = await db.salt.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, 'SALT_NOT_FOUND', 'Salt not found');
  }

  if (input.name !== undefined) {
    await ensureUniqueName(input.name, db, id);
  }

  try {
    return toPublicSalt(await db.salt.update({ where: { id }, data: input }));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw duplicateSaltError();
    }
    throw error;
  }
};

export const deactivateSalt = async (
  id: string,
  db: SaltStore = prisma,
): Promise<PublicSalt> => {
  const existing = await db.salt.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, 'SALT_NOT_FOUND', 'Salt not found');
  }

  if (!existing.active) {
    return toPublicSalt(existing);
  }

  return toPublicSalt(await db.salt.update({ where: { id }, data: { active: false } }));
};
