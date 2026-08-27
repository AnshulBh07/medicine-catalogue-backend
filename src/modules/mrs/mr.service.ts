import { Prisma, type MR } from '@prisma/client/index';
import { AppError } from '../../common/errors/app-error.js';
import { prisma } from '../../lib/prisma.js';
import type { CreateMrInput, ListMrsInput, UpdateMrInput } from './mr.schemas.js';

export type PublicMr = Pick<
  MR,
  'id' | 'name' | 'company' | 'phone' | 'email' | 'notes' | 'active' | 'createdAt' | 'updatedAt'
>;

type SearchFilter = {
  contains: string;
  mode: 'insensitive';
};

export interface MrStore {
  mR: {
    findMany(args: {
      where: {
        active?: boolean;
        OR?: Array<{
          name?: SearchFilter;
          company?: SearchFilter;
        }>;
      };
      orderBy: { name: 'asc' };
    }): PromiseLike<MR[]>;
    findUnique(args: { where: { id: string } }): PromiseLike<MR | null>;
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

const toPublicMr = (mr: MR): PublicMr => ({
  id: mr.id,
  name: mr.name,
  company: mr.company,
  phone: mr.phone,
  email: mr.email,
  notes: mr.notes,
  active: mr.active,
  createdAt: mr.createdAt,
  updatedAt: mr.updatedAt,
});

const mrNotFound = (): AppError => new AppError(404, 'MR_NOT_FOUND', 'MR not found');

export const listMrs = async (
  input: ListMrsInput,
  db: MrStore = prisma,
): Promise<PublicMr[]> => {
  const search = input.search
    ? { OR: [
        { name: { contains: input.search, mode: 'insensitive' as const } },
        { company: { contains: input.search, mode: 'insensitive' as const } },
      ] }
    : {};
  const mrs = await db.mR.findMany({
    where: {
      ...(input.includeInactive ? {} : { active: true }),
      ...search,
    },
    orderBy: { name: 'asc' },
  });
  return mrs.map(toPublicMr);
};

export const getMr = async (
  id: string,
  includeInactive: boolean,
  db: MrStore = prisma,
): Promise<PublicMr> => {
  const mr = await db.mR.findUnique({ where: { id } });
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
    return toPublicMr(await db.mR.update({ where: { id }, data: input }));
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

  return toPublicMr(await db.mR.update({ where: { id }, data: { active: false } }));
};
