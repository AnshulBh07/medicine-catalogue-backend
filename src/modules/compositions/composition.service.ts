import type { Composition, CompositionCompositionSalt, CompositionSalt, Salt } from '@prisma/client/index';
import { AppError } from '../../common/errors/app-error.js';
import { prisma } from '../../lib/prisma.js';
import type {
  CreateCompositionInput,
  ListCompositionsInput,
  UpdateCompositionInput,
} from './composition.schemas.js';

type CompositionSaltWithSalt = CompositionSalt & {
  salt: Pick<Salt, 'id' | 'name'>;
};

type CompositionLink = CompositionCompositionSalt & {
  compositionSalt: CompositionSaltWithSalt;
};

type CompositionRecord = Composition & {
  compositionSaltLinks: CompositionLink[];
};

export type PublicComposition = {
  id: string;
  displayText: string;
  description: string | null;
  active: boolean;
  compositionSalts: Array<{
    id: string;
    salt: Pick<Salt, 'id' | 'name'>;
    amount: number;
    unit: CompositionSalt['unit'];
  }>;
  createdAt: Date;
  updatedAt: Date;
};

const compositionSaltInclude = {
  compositionSaltLinks: {
    include: {
      compositionSalt: {
        include: { salt: { select: { id: true, name: true } } },
      },
    },
  },
} as const;

type CompositionStoreTransaction = {
  composition: {
    create(args: {
      data: { displayText: string; description: string | null; active: true };
    }): PromiseLike<Composition>;
    update(args: {
      where: { id: string };
      data: { displayText?: string; description?: string | null; active?: boolean };
    }): PromiseLike<Composition>;
    findUnique(args: {
      where: { id: string };
      include: typeof compositionSaltInclude;
    }): PromiseLike<CompositionRecord | null>;
  };
  compositionCompositionSalt: {
    createMany(args: { data: Array<{ compositionId: string; compositionSaltId: string }> }): PromiseLike<unknown>;
    deleteMany(args: { where: { compositionId: string } }): PromiseLike<unknown>;
  };
};

type CompositionSaltWithActiveSalt = {
  id: string;
  salt: {
    active: boolean;
  };
};

export interface CompositionStore extends CompositionStoreTransaction {
  $transaction<T>(callback: (transaction: CompositionStoreTransaction) => Promise<T>): Promise<T>;
  composition: CompositionStoreTransaction['composition'] & {
    findMany(args: {
      where: { active?: boolean };
      include: typeof compositionSaltInclude;
      orderBy: { displayText: 'asc' };
    }): PromiseLike<CompositionRecord[]>;
    findUnique(args: {
      where: { id: string };
      include: typeof compositionSaltInclude;
    }): PromiseLike<CompositionRecord | null>;
  };
  compositionSalt: {
    findMany(args: {
      where: { id: { in: string[] } };
      include: { salt: { select: { active: true } } };
    }): PromiseLike<CompositionSaltWithActiveSalt[]>;
  };
}

const compositionNotFound = (): AppError =>
  new AppError(404, 'COMPOSITION_NOT_FOUND', 'Composition not found');

const missingCompositionSalt = (): AppError =>
  new AppError(404, 'COMPOSITION_SALT_NOT_FOUND', 'One or more CompositionSalts were not found');

const inactiveSaltReference = (): AppError =>
  new AppError(409, 'INACTIVE_SALT_REFERENCE', 'Composition cannot reference a deactivated salt');

const toPublicComposition = (composition: CompositionRecord): PublicComposition => ({
  id: composition.id,
  displayText: composition.displayText,
  description: composition.description,
  active: composition.active,
  compositionSalts: composition.compositionSaltLinks.map(({ compositionSalt }) => ({
    id: compositionSalt.id,
    salt: compositionSalt.salt,
    amount: Number(compositionSalt.amount),
    unit: compositionSalt.unit,
  })),
  createdAt: composition.createdAt,
  updatedAt: composition.updatedAt,
});

const ensureCompositionSaltsExist = async (
  compositionSaltIds: string[],
  db: CompositionStore,
): Promise<void> => {
  const existing = await db.compositionSalt.findMany({
    where: { id: { in: compositionSaltIds } },
    include: { salt: { select: { active: true } } },
  });
  if (existing.length !== compositionSaltIds.length) {
    throw missingCompositionSalt();
  }
  if (existing.some((record) => !record.salt.active)) {
    throw inactiveSaltReference();
  }
};

const getCompositionOrThrow = async (
  id: string,
  includeInactive: boolean,
  db: CompositionStore,
): Promise<CompositionRecord> => {
  const composition = await db.composition.findUnique({
    where: { id },
    include: compositionSaltInclude,
  });
  if (!composition || (!includeInactive && !composition.active)) {
    throw compositionNotFound();
  }
  return composition;
};

export const listCompositions = async (
  input: ListCompositionsInput,
  db: CompositionStore = prisma,
): Promise<PublicComposition[]> => {
  const compositions = await db.composition.findMany({
    where: input.includeInactive ? {} : { active: true },
    include: compositionSaltInclude,
    orderBy: { displayText: 'asc' },
  });
  return compositions.map(toPublicComposition);
};

export const getComposition = async (
  id: string,
  includeInactive: boolean,
  db: CompositionStore = prisma,
): Promise<PublicComposition> =>
  toPublicComposition(await getCompositionOrThrow(id, includeInactive, db));

export const createComposition = async (
  input: CreateCompositionInput,
  db: CompositionStore = prisma,
): Promise<PublicComposition> => {
  await ensureCompositionSaltsExist(input.compositionSaltIds, db);

  return db.$transaction(async (transaction) => {
    const composition = await transaction.composition.create({
      data: {
        displayText: input.displayText,
        description: input.description ?? null,
        active: true,
      },
    });
    await transaction.compositionCompositionSalt.createMany({
      data: input.compositionSaltIds.map((compositionSaltId) => ({
        compositionId: composition.id,
        compositionSaltId,
      })),
    });
    const created = await transaction.composition.findUnique({
      where: { id: composition.id },
      include: compositionSaltInclude,
    });
    if (!created) {
      throw compositionNotFound();
    }
    return toPublicComposition(created);
  });
};

export const updateComposition = async (
  id: string,
  input: UpdateCompositionInput,
  db: CompositionStore = prisma,
): Promise<PublicComposition> => {
  await getCompositionOrThrow(id, true, db);
  if (input.compositionSaltIds !== undefined) {
    await ensureCompositionSaltsExist(input.compositionSaltIds, db);
  }

  return db.$transaction(async (transaction) => {
    await transaction.composition.update({
      where: { id },
      data: {
        ...(input.displayText === undefined ? {} : { displayText: input.displayText }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.active === undefined ? {} : { active: input.active }),
      },
    });

    if (input.compositionSaltIds !== undefined) {
      await transaction.compositionCompositionSalt.deleteMany({ where: { compositionId: id } });
      await transaction.compositionCompositionSalt.createMany({
        data: input.compositionSaltIds.map((compositionSaltId) => ({
          compositionId: id,
          compositionSaltId,
        })),
      });
    }

    const updated = await transaction.composition.findUnique({
      where: { id },
      include: compositionSaltInclude,
    });
    if (!updated) {
      throw compositionNotFound();
    }
    return toPublicComposition(updated);
  });
};

export const deactivateComposition = async (
  id: string,
  db: CompositionStore = prisma,
): Promise<PublicComposition> => {
  await getCompositionOrThrow(id, true, db);
  return db.$transaction(async (transaction) => {
    await transaction.composition.update({ where: { id }, data: { active: false } });
    const deactivated = await transaction.composition.findUnique({
      where: { id },
      include: compositionSaltInclude,
    });
    if (!deactivated) {
      throw compositionNotFound();
    }
    return toPublicComposition(deactivated);
  });
};
