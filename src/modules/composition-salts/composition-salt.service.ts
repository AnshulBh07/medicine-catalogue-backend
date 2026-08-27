import type { $Enums, CompositionSalt, Salt } from '@prisma/client/index';
import { AppError } from '../../common/errors/app-error.js';
import { prisma } from '../../lib/prisma.js';
import type {
  CreateCompositionSaltInput,
  ListCompositionSaltsInput,
  UpdateCompositionSaltInput,
} from './composition-salt.schemas.js';

type PublicSaltReference = Pick<Salt, 'id' | 'name'>;
type CompositionSaltRecord = CompositionSalt & {
  salt: Pick<Salt, 'id' | 'name' | 'active'>;
};

export type PublicCompositionSalt = {
  id: string;
  salt: PublicSaltReference;
  amount: number;
  unit: $Enums.CompositionSaltUnit;
  createdAt: Date;
  updatedAt: Date;
};

export interface CompositionSaltStore {
  salt: {
    findUnique(args: {
      where: { id: string };
      select: { id: true; name: true; active: true };
    }): PromiseLike<Pick<Salt, 'id' | 'name' | 'active'> | null>;
  };
  compositionSalt: {
    findMany(args: {
      where: { salt?: { active?: boolean } };
      include: { salt: { select: { id: true; name: true; active: true } } };
      orderBy: { createdAt: 'asc' };
    }): PromiseLike<CompositionSaltRecord[]>;
    findUnique(args: {
      where: { id: string };
      include: { salt: { select: { id: true; name: true; active: true } } };
    }): PromiseLike<CompositionSaltRecord | null>;
    create(args: {
      data: { saltId: string; amount: number; unit: $Enums.CompositionSaltUnit };
      include: { salt: { select: { id: true; name: true; active: true } } };
    }): PromiseLike<CompositionSaltRecord>;
    update(args: {
      where: { id: string };
      data: {
        saltId?: string;
        amount?: number;
        unit?: $Enums.CompositionSaltUnit;
      };
      include: { salt: { select: { id: true; name: true; active: true } } };
    }): PromiseLike<CompositionSaltRecord>;
  };
}

const saltReference = {
  select: { id: true, name: true, active: true },
} as const;

const compositionSaltInclude = { salt: saltReference } as const;

const toPublicCompositionSalt = (record: CompositionSaltRecord): PublicCompositionSalt => ({
  id: record.id,
  salt: { id: record.salt.id, name: record.salt.name },
  amount: Number(record.amount),
  unit: record.unit,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

const saltNotFound = (): AppError =>
  new AppError(404, 'SALT_NOT_FOUND', 'Referenced salt not found');

const compositionSaltNotFound = (): AppError =>
  new AppError(404, 'COMPOSITION_SALT_NOT_FOUND', 'CompositionSalt not found');

const ensureActiveSalt = async (saltId: string, db: CompositionSaltStore): Promise<void> => {
  const salt = await db.salt.findUnique({ where: { id: saltId }, select: saltReference.select });
  if (!salt) {
    throw saltNotFound();
  }
  if (!salt.active) {
    throw new AppError(409, 'INACTIVE_SALT_REFERENCE', 'CompositionSalt must reference an active salt');
  }
};

export const listCompositionSalts = async (
  input: ListCompositionSaltsInput,
  db: CompositionSaltStore = prisma,
): Promise<PublicCompositionSalt[]> => {
  const records = await db.compositionSalt.findMany({
    where: input.includeInactive ? {} : { salt: { active: true } },
    include: compositionSaltInclude,
    orderBy: { createdAt: 'asc' },
  });

  return records.map(toPublicCompositionSalt);
};

export const getCompositionSalt = async (
  id: string,
  includeInactive: boolean,
  db: CompositionSaltStore = prisma,
): Promise<PublicCompositionSalt> => {
  const record = await db.compositionSalt.findUnique({
    where: { id },
    include: compositionSaltInclude,
  });

  if (!record || (!includeInactive && !record.salt.active)) {
    throw compositionSaltNotFound();
  }

  return toPublicCompositionSalt(record);
};

export const createCompositionSalt = async (
  input: CreateCompositionSaltInput,
  db: CompositionSaltStore = prisma,
): Promise<PublicCompositionSalt> => {
  await ensureActiveSalt(input.saltId, db);

  const record = await db.compositionSalt.create({
    data: {
      saltId: input.saltId,
      amount: input.amount,
      unit: input.unit as $Enums.CompositionSaltUnit,
    },
    include: compositionSaltInclude,
  });

  return toPublicCompositionSalt(record);
};

export const updateCompositionSalt = async (
  id: string,
  input: UpdateCompositionSaltInput,
  db: CompositionSaltStore = prisma,
): Promise<PublicCompositionSalt> => {
  const existing = await db.compositionSalt.findUnique({
    where: { id },
    include: compositionSaltInclude,
  });

  if (!existing) {
    throw compositionSaltNotFound();
  }
  if (input.saltId !== undefined) {
    await ensureActiveSalt(input.saltId, db);
  }

  const record = await db.compositionSalt.update({
    where: { id },
    data: {
      ...(input.saltId === undefined ? {} : { saltId: input.saltId }),
      ...(input.amount === undefined ? {} : { amount: input.amount }),
      ...(input.unit === undefined ? {} : { unit: input.unit as $Enums.CompositionSaltUnit }),
    },
    include: compositionSaltInclude,
  });

  return toPublicCompositionSalt(record);
};

export const rejectCompositionSaltDeletion = (): never => {
  throw new AppError(
    409,
    'COMPOSITION_SALT_DELETION_UNSUPPORTED',
    'CompositionSalt deletion requires an approved safe deletion strategy',
  );
};
