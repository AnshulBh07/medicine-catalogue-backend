import { Prisma, type Salt } from '@prisma/client/index';
import { AppError } from '../../common/errors/app-error.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { formatCompositionDisplayText } from '../compositions/composition.utils.js';
import type { CreateSaltInput, ListSaltsInput, UpdateSaltInput } from './salt.schemas.js';

export type PublicSalt = Pick<Salt, 'id' | 'name' | 'description' | 'active' | 'createdAt' | 'updatedAt'> & {
  compositionsCount?: number;
  medicinesCount?: number;
};

export type SaltImpactReport = {
  salt: PublicSalt;
  compositionsCount: number;
  medicinesCount: number;
  compositions: Array<{ id: string; displayText: string; active: boolean }>;
  medicines: Array<{ id: string; name: string; active: boolean }>;
};

const duplicateSaltError = (): AppError =>
  new AppError(409, 'DUPLICATE_SALT', 'A salt with this name already exists');

const saltNotFoundError = (): AppError =>
  new AppError(404, 'SALT_NOT_FOUND', 'Salt not found');

const ensureUniqueName = async (
  name: string,
  tx: Prisma.TransactionClient | typeof prisma,
  id?: string,
): Promise<void> => {
  const existing = await tx.salt.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
  });
  if (existing && existing.id !== id) {
    throw duplicateSaltError();
  }
};

export const listSalts = async (
  input: ListSaltsInput,
  db = prisma,
): Promise<PublicSalt[]> => {
  const where: Prisma.SaltWhereInput = {
    ...(input.active === 'active' ? { active: true } : {}),
    ...(input.active === 'inactive' ? { active: false } : {}),
    ...(input.search ? { name: { contains: input.search, mode: 'insensitive' } } : {}),
  };

  const salts = await db.salt.findMany({
    where,
    orderBy: { name: 'asc' },
    include: {
      compositionSalts: {
        select: {
          id: true,
          compositionLinks: {
            select: {
              compositionId: true,
              composition: {
                select: {
                  id: true,
                  active: true,
                  _count: {
                    select: { medicines: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  return salts.map((s) => {
    const uniqueCompIds = new Set<string>();
    let medicinesCount = 0;

    for (const cs of s.compositionSalts) {
      for (const link of cs.compositionLinks) {
        if (!uniqueCompIds.has(link.compositionId)) {
          uniqueCompIds.add(link.compositionId);
          medicinesCount += link.composition._count?.medicines ?? 0;
        }
      }
    }

    return {
      id: s.id,
      name: s.name,
      description: s.description,
      active: s.active,
      compositionsCount: uniqueCompIds.size,
      medicinesCount,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  });
};

export const getSalt = async (
  id: string,
  includeInactive = true,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<PublicSalt> => {
  const s = await db.salt.findUnique({
    where: { id },
    include: {
      compositionSalts: {
        select: {
          id: true,
          compositionLinks: {
            select: {
              compositionId: true,
              composition: {
                select: {
                  id: true,
                  active: true,
                  _count: {
                    select: { medicines: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!s || (!includeInactive && !s.active)) {
    throw saltNotFoundError();
  }

  const uniqueCompIds = new Set<string>();
  let medicinesCount = 0;

  for (const cs of s.compositionSalts) {
    for (const link of cs.compositionLinks) {
      if (!uniqueCompIds.has(link.compositionId)) {
        uniqueCompIds.add(link.compositionId);
        medicinesCount += link.composition._count?.medicines ?? 0;
      }
    }
  }

  return {
    id: s.id,
    name: s.name,
    description: s.description,
    active: s.active,
    compositionsCount: uniqueCompIds.size,
    medicinesCount,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
};

export const getSaltImpact = async (
  id: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<SaltImpactReport> => {
  const s = await db.salt.findUnique({
    where: { id },
    include: {
      compositionSalts: {
        select: {
          id: true,
          compositionLinks: {
            select: {
              compositionId: true,
              composition: {
                select: {
                  id: true,
                  displayText: true,
                  active: true,
                  medicines: {
                    select: {
                      id: true,
                      name: true,
                      active: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!s) {
    throw saltNotFoundError();
  }

  const compMap = new Map<string, { id: string; displayText: string; active: boolean }>();
  const medMap = new Map<string, { id: string; name: string; active: boolean }>();

  for (const cs of s.compositionSalts) {
    for (const link of cs.compositionLinks) {
      const comp = link.composition;
      if (!compMap.has(comp.id)) {
        compMap.set(comp.id, {
          id: comp.id,
          displayText: comp.displayText,
          active: comp.active,
        });
      }
      for (const med of comp.medicines) {
        if (!medMap.has(med.id)) {
          medMap.set(med.id, {
            id: med.id,
            name: med.name,
            active: med.active,
          });
        }
      }
    }
  }

  const compositions = Array.from(compMap.values());
  const medicines = Array.from(medMap.values());

  return {
    salt: {
      id: s.id,
      name: s.name,
      description: s.description,
      active: s.active,
      compositionsCount: compositions.length,
      medicinesCount: medicines.length,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    },
    compositionsCount: compositions.length,
    medicinesCount: medicines.length,
    compositions,
    medicines,
  };
};

export const createSalt = async (
  input: CreateSaltInput,
  db = prisma,
): Promise<PublicSalt> => {
  const normalizedName = input.name.trim().replace(/\s+/g, ' ');
  await ensureUniqueName(normalizedName, db);

  try {
    const created = await db.salt.create({
      data: {
        name: normalizedName,
        description: input.description ?? null,
        active: true,
      },
    });

    return {
      id: created.id,
      name: created.name,
      description: created.description,
      active: created.active,
      compositionsCount: 0,
      medicinesCount: 0,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    };
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
  db = prisma,
): Promise<PublicSalt> => {
  return (db as unknown as typeof prisma).$transaction(async (tx) => {
    const existing = await tx.salt.findUnique({ where: { id } });
    if (!existing) {
      throw saltNotFoundError();
    }

    let normalizedName: string | undefined;
    if (input.name !== undefined) {
      normalizedName = input.name.trim().replace(/\s+/g, ' ');
      await ensureUniqueName(normalizedName, tx, id);
    }

    await tx.salt.update({
      where: { id },
      data: {
        ...(normalizedName !== undefined ? { name: normalizedName } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
    });

    // If salt name changed, propagate the updated formula to all dependent compositions
    if (normalizedName !== undefined && normalizedName !== existing.name) {
      const compSalts = await tx.compositionSalt.findMany({
        where: { saltId: id },
        select: {
          id: true,
          compositionLinks: {
            select: { compositionId: true },
          },
        },
      });

      const affectedCompIds = new Set<string>();
      for (const cs of compSalts) {
        for (const link of cs.compositionLinks) {
          affectedCompIds.add(link.compositionId);
        }
      }

      for (const compId of affectedCompIds) {
        const fullComp = await tx.composition.findUnique({
          where: { id: compId },
          include: {
            compositionSaltLinks: {
              include: {
                compositionSalt: {
                  include: {
                    salt: { select: { id: true, name: true } },
                  },
                },
              },
            },
          },
        });

        if (fullComp) {
          const saltItems = fullComp.compositionSaltLinks.map((l) => ({
            name: l.compositionSalt.salt.id === id ? normalizedName! : l.compositionSalt.salt.name,
            amount: l.compositionSalt.amount,
            unit: l.compositionSalt.unit,
          }));

          const regeneratedDisplayText = formatCompositionDisplayText(saltItems);

          await tx.composition.update({
            where: { id: compId },
            data: { displayText: regeneratedDisplayText },
          });
        }
      }

      logger.info(
        {
          saltId: id,
          oldName: existing.name,
          newName: normalizedName,
          affectedCompositionsCount: affectedCompIds.size,
        },
        'Propagated salt rename across dependent compositions',
      );
    }

    return getSalt(id, true, tx);
  });
};

export const deleteSalt = async (
  id: string,
  db = prisma,
): Promise<{ success: true; deletedSaltId: string; name: string }> => {
  return (db as unknown as typeof prisma).$transaction(async (tx) => {
    const existing = await tx.salt.findUnique({
      where: { id },
      include: {
        compositionSalts: {
          include: {
            compositionLinks: {
              include: {
                composition: {
                  include: {
                    _count: { select: { medicines: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!existing) {
      throw saltNotFoundError();
    }

    const uniqueCompIds = new Set<string>();
    let medicinesCount = 0;

    for (const cs of existing.compositionSalts) {
      for (const link of cs.compositionLinks) {
        if (!uniqueCompIds.has(link.compositionId)) {
          uniqueCompIds.add(link.compositionId);
          medicinesCount += link.composition._count?.medicines ?? 0;
        }
      }
    }

    const compositionsCount = uniqueCompIds.size;

    // Hard delete is ONLY permitted if the salt has zero composition references and zero medicines
    if (compositionsCount > 0 || medicinesCount > 0) {
      throw new AppError(
        409,
        'SALT_IN_USE',
        `This salt cannot be deleted because it is currently in use by ${compositionsCount} composition(s) and ${medicinesCount} medicine(s). Deactivate the salt instead to prevent its selection in new medicines while preserving existing catalogue records.`,
        {
          compositionCount: compositionsCount,
          medicineCount: medicinesCount,
        },
      );
    }

    // Clean up any unlinked compositionSalts junction records if any exist without composition links
    await tx.compositionSalt.deleteMany({
      where: { saltId: id },
    });

    // Hard delete the salt record
    await tx.salt.delete({
      where: { id },
    });

    logger.info({ saltId: id, name: existing.name }, 'Hard-deleted unused salt record');

    return {
      success: true,
      deletedSaltId: id,
      name: existing.name,
    };
  });
};

export const deactivateSalt = async (
  id: string,
  db = prisma,
): Promise<PublicSalt> => {
  return updateSalt(id, { active: false }, db);
};

export const reactivateSalt = async (
  id: string,
  db = prisma,
): Promise<PublicSalt> => {
  return updateSalt(id, { active: true }, db);
};
