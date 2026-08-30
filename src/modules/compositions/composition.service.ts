import type { $Enums, Composition, CompositionCompositionSalt, CompositionSalt, Prisma, Salt } from '@prisma/client/index';
import { AppError } from '../../common/errors/app-error.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import {
  formatCompositionDisplayText,
  type SaltStrengthItem,
} from './composition.utils.js';
import type {
  CreateCompositionInput,
  ListCompositionsInput,
  SaltItemInput,
  UpdateCompositionInput,
} from './composition.schemas.js';

type CompositionSaltWithSalt = CompositionSalt & {
  salt: Pick<Salt, 'id' | 'name' | 'active'>;
};

type CompositionLink = CompositionCompositionSalt & {
  compositionSalt: CompositionSaltWithSalt;
};

type CompositionRecord = Composition & {
  compositionSaltLinks: CompositionLink[];
  _count?: {
    medicines: number;
  };
};

export type PublicComposition = {
  id: string;
  displayText: string;
  description: string | null;
  active: boolean;
  medicinesCount: number;
  compositionSalts: Array<{
    id: string;
    salt: Pick<Salt, 'id' | 'name'>;
    amount: number;
    unit: $Enums.CompositionSaltUnit;
  }>;
  createdAt: Date;
  updatedAt: Date;
};

export type CompositionImpactReport = {
  composition: PublicComposition;
  medicinesCount: number;
  medicines: Array<{ id: string; name: string; active: boolean }>;
};

const compositionSaltInclude = {
  compositionSaltLinks: {
    include: {
      compositionSalt: {
        include: { salt: { select: { id: true, name: true, active: true } } },
      },
    },
  },
  _count: {
    select: { medicines: true },
  },
} as const;

const compositionNotFound = (): AppError =>
  new AppError(404, 'COMPOSITION_NOT_FOUND', 'Composition not found');

const duplicateCompositionError = (): AppError =>
  new AppError(
    409,
    'DUPLICATE_COMPOSITION',
    'A composition with this exact formula already exists',
  );

const toPublicComposition = (composition: CompositionRecord): PublicComposition => ({
  id: composition.id,
  displayText: composition.displayText,
  description: composition.description,
  active: composition.active,
  medicinesCount: composition._count?.medicines ?? 0,
  compositionSalts: composition.compositionSaltLinks.map(({ compositionSalt }) => ({
    id: compositionSalt.id,
    salt: { id: compositionSalt.salt.id, name: compositionSalt.salt.name },
    amount: Number(compositionSalt.amount),
    unit: compositionSalt.unit,
  })),
  createdAt: composition.createdAt,
  updatedAt: composition.updatedAt,
});

/**
 * Resolves salt items into active Salt records and CompositionSalt IDs.
 */
const resolveSaltsToCompositionSalts = async (
  tx: Prisma.TransactionClient,
  salts: SaltItemInput[],
): Promise<{ compositionSaltIds: string[]; saltStrengthItems: SaltStrengthItem[] }> => {
  const resolvedSalts: SaltStrengthItem[] = [];

  for (const item of salts) {
    let saltRecord: { id: string; name: string; active: boolean } | null = null;

    if (item.saltId) {
      saltRecord = await tx.salt.findUnique({
        where: { id: item.saltId },
        select: { id: true, name: true, active: true },
      });
      if (!saltRecord) {
        throw new AppError(404, 'SALT_NOT_FOUND', `Referenced salt with ID '${item.saltId}' was not found`);
      }
    } else if (item.name) {
      const normalizedName = item.name.trim().replace(/\s+/g, ' ');
      saltRecord = await tx.salt.findFirst({
        where: { name: { equals: normalizedName, mode: 'insensitive' } },
        select: { id: true, name: true, active: true },
      });
      if (!saltRecord) {
        saltRecord = await tx.salt.create({
          data: { name: normalizedName, active: true },
          select: { id: true, name: true, active: true },
        });
      }
    }

    if (!saltRecord) {
      throw new AppError(400, 'INVALID_SALT_INPUT', 'Salt information missing');
    }

    if (!saltRecord.active) {
      throw new AppError(409, 'INACTIVE_SALT_REFERENCE', `Cannot use deactivated salt '${saltRecord.name}' in composition`);
    }

    resolvedSalts.push({
      saltId: saltRecord.id,
      name: saltRecord.name,
      amount: item.amount,
      unit: item.unit as $Enums.CompositionSaltUnit,
    });
  }

  // Ensure unique salt IDs within this single composition
  const seenSaltIds = new Set<string>();
  for (const s of resolvedSalts) {
    if (seenSaltIds.has(s.saltId!)) {
      throw new AppError(
        400,
        'DUPLICATE_SALT_IN_COMPOSITION',
        `Duplicate salt '${s.name}' provided in composition. Each salt in a composition must be unique`,
      );
    }
    seenSaltIds.add(s.saltId!);
  }

  const compositionSaltIds: string[] = [];
  for (const item of resolvedSalts) {
    let compSalt = await tx.compositionSalt.findFirst({
      where: {
        saltId: item.saltId!,
        amount: item.amount,
        unit: item.unit as $Enums.CompositionSaltUnit,
      },
      select: { id: true },
    });

    if (!compSalt) {
      compSalt = await tx.compositionSalt.create({
        data: {
          saltId: item.saltId!,
          amount: item.amount,
          unit: item.unit as $Enums.CompositionSaltUnit,
        },
        select: { id: true },
      });
    }

    compositionSaltIds.push(compSalt.id);
  }

  return { compositionSaltIds, saltStrengthItems: resolvedSalts };
};

export const listCompositions = async (
  input: ListCompositionsInput,
  db = prisma,
): Promise<PublicComposition[]> => {
  const where: Prisma.CompositionWhereInput = {
    ...(input.includeInactive ? {} : { active: true }),
    ...(input.search
      ? {
          OR: [
            { displayText: { contains: input.search, mode: 'insensitive' } },
            {
              compositionSaltLinks: {
                some: {
                  compositionSalt: {
                    salt: { name: { contains: input.search, mode: 'insensitive' } },
                  },
                },
              },
            },
          ],
        }
      : {}),
  };

  const compositions = await db.composition.findMany({
    where,
    include: compositionSaltInclude,
    orderBy: { displayText: 'asc' },
  });

  return compositions.map(toPublicComposition);
};

export const getComposition = async (
  id: string,
  includeInactive = true,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<PublicComposition> => {
  const composition = await db.composition.findUnique({
    where: { id },
    include: compositionSaltInclude,
  });

  if (!composition || (!includeInactive && !composition.active)) {
    throw compositionNotFound();
  }

  return toPublicComposition(composition);
};

export const getCompositionImpact = async (
  id: string,
  db = prisma,
): Promise<CompositionImpactReport> => {
  const composition = await db.composition.findUnique({
    where: { id },
    include: {
      ...compositionSaltInclude,
      medicines: {
        select: { id: true, name: true, active: true },
        orderBy: { name: 'asc' },
      },
    },
  });

  if (!composition) {
    throw compositionNotFound();
  }

  return {
    composition: toPublicComposition(composition),
    medicinesCount: composition.medicines.length,
    medicines: composition.medicines,
  };
};

export const createComposition = async (
  input: CreateCompositionInput,
  db = prisma,
): Promise<PublicComposition> => {
  return (db as unknown as typeof prisma).$transaction(async (tx) => {
    let compositionSaltIds: string[] = [];
    let saltStrengthItems: SaltStrengthItem[] = [];

    if (input.salts && input.salts.length > 0) {
      const resolved = await resolveSaltsToCompositionSalts(tx, input.salts);
      compositionSaltIds = resolved.compositionSaltIds;
      saltStrengthItems = resolved.saltStrengthItems;
    } else if (input.compositionSaltIds && input.compositionSaltIds.length > 0) {
      const existingCompSalts = await tx.compositionSalt.findMany({
        where: { id: { in: input.compositionSaltIds } },
        include: { salt: { select: { id: true, name: true, active: true } } },
      });

      if (existingCompSalts.length !== input.compositionSaltIds.length) {
        throw new AppError(404, 'COMPOSITION_SALT_NOT_FOUND', 'One or more CompositionSalts were not found');
      }

      if (existingCompSalts.some((r) => !r.salt.active)) {
        throw new AppError(409, 'INACTIVE_SALT_REFERENCE', 'Composition cannot reference a deactivated salt');
      }

      compositionSaltIds = input.compositionSaltIds;
      saltStrengthItems = existingCompSalts.map((cs) => ({
        saltId: cs.salt.id,
        name: cs.salt.name,
        amount: cs.amount,
        unit: cs.unit,
      }));
    }

    const canonicalDisplayText =
      input.displayText?.trim() || formatCompositionDisplayText(saltStrengthItems);

    // Canonical order-independent duplicate check
    const candidateCompositions = await tx.composition.findMany({
      where: {
        compositionSaltLinks: {
          some: { compositionSaltId: { in: compositionSaltIds } },
        },
      },
      include: {
        compositionSaltLinks: { select: { compositionSaltId: true } },
      },
    });

    const exactMatch = candidateCompositions.find((c) => {
      if (c.compositionSaltLinks.length !== compositionSaltIds.length) return false;
      const linked = new Set(c.compositionSaltLinks.map((l) => l.compositionSaltId));
      return compositionSaltIds.every((id) => linked.has(id));
    });

    if (exactMatch) {
      if (exactMatch.active) {
        throw duplicateCompositionError();
      }
      // If inactive, reactivate and update description
      await tx.composition.update({
        where: { id: exactMatch.id },
        data: { active: true, description: input.description ?? null, displayText: canonicalDisplayText },
      });
      const reactivated = await tx.composition.findUnique({
        where: { id: exactMatch.id },
        include: compositionSaltInclude,
      });
      return toPublicComposition(reactivated!);
    }

    const createdComp = await tx.composition.create({
      data: {
        displayText: canonicalDisplayText,
        description: input.description ?? null,
        active: true,
      },
    });

    await tx.compositionCompositionSalt.createMany({
      data: compositionSaltIds.map((compositionSaltId) => ({
        compositionId: createdComp.id,
        compositionSaltId,
      })),
    });

    const fullCreated = await tx.composition.findUnique({
      where: { id: createdComp.id },
      include: compositionSaltInclude,
    });

    return toPublicComposition(fullCreated!);
  });
};

export const updateComposition = async (
  id: string,
  input: UpdateCompositionInput,
  db = prisma,
): Promise<PublicComposition> => {
  return (db as unknown as typeof prisma).$transaction(async (tx) => {
    const existing = await tx.composition.findUnique({
      where: { id },
      include: compositionSaltInclude,
    });

    if (!existing) {
      throw compositionNotFound();
    }

    let compositionSaltIds: string[] | undefined;
    let saltStrengthItems: SaltStrengthItem[] | undefined;

    if (input.salts && input.salts.length > 0) {
      const resolved = await resolveSaltsToCompositionSalts(tx, input.salts);
      compositionSaltIds = resolved.compositionSaltIds;
      saltStrengthItems = resolved.saltStrengthItems;
    } else if (input.compositionSaltIds && input.compositionSaltIds.length > 0) {
      const existingCompSalts = await tx.compositionSalt.findMany({
        where: { id: { in: input.compositionSaltIds } },
        include: { salt: { select: { id: true, name: true, active: true } } },
      });

      if (existingCompSalts.length !== input.compositionSaltIds.length) {
        throw new AppError(404, 'COMPOSITION_SALT_NOT_FOUND', 'One or more CompositionSalts were not found');
      }

      if (existingCompSalts.some((r) => !r.salt.active)) {
        throw new AppError(409, 'INACTIVE_SALT_REFERENCE', 'Composition cannot reference a deactivated salt');
      }

      compositionSaltIds = input.compositionSaltIds;
      saltStrengthItems = existingCompSalts.map((cs) => ({
        saltId: cs.salt.id,
        name: cs.salt.name,
        amount: cs.amount,
        unit: cs.unit,
      }));
    }

    let nextDisplayText = input.displayText?.trim();
    if (saltStrengthItems && saltStrengthItems.length > 0) {
      nextDisplayText = formatCompositionDisplayText(saltStrengthItems);
    }

    if (compositionSaltIds) {
      await tx.compositionCompositionSalt.deleteMany({
        where: { compositionId: id },
      });

      await tx.compositionCompositionSalt.createMany({
        data: compositionSaltIds.map((compositionSaltId) => ({
          compositionId: id,
          compositionSaltId,
        })),
      });
    }

    await tx.composition.update({
      where: { id },
      data: {
        ...(nextDisplayText !== undefined ? { displayText: nextDisplayText } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
    });

    const updated = await tx.composition.findUnique({
      where: { id },
      include: compositionSaltInclude,
    });

    logger.info(
      {
        compositionId: id,
        oldDisplayText: existing.displayText,
        newDisplayText: updated?.displayText,
        affectedMedicinesCount: existing._count?.medicines ?? 0,
      },
      'Updated composition formula and links',
    );

    return toPublicComposition(updated!);
  });
};

export const deleteComposition = async (
  id: string,
  db = prisma,
): Promise<{ success: true; deletedCompositionId: string; displayText: string }> => {
  return (db as unknown as typeof prisma).$transaction(async (tx) => {
    const existing = await tx.composition.findUnique({
      where: { id },
      include: {
        ...compositionSaltInclude,
        _count: { select: { medicines: true } },
      },
    });

    if (!existing) {
      throw compositionNotFound();
    }

    const medicinesCount = existing._count?.medicines ?? 0;
    if (medicinesCount > 0) {
      throw new AppError(
        409,
        'COMPOSITION_IN_USE',
        `This composition cannot be deleted because it is currently used by ${medicinesCount} medicine(s). Deactivate the composition instead to prevent its selection in new medicines while preserving existing catalogue records.`,
        {
          medicineCount: medicinesCount,
        },
      );
    }

    // Clean up junction links
    await tx.compositionCompositionSalt.deleteMany({
      where: { compositionId: id },
    });

    // Hard delete the composition
    await tx.composition.delete({
      where: { id },
    });

    logger.info({ compositionId: id, displayText: existing.displayText }, 'Hard-deleted unused composition record');

    return {
      success: true,
      deletedCompositionId: id,
      displayText: existing.displayText,
    };
  });
};

export const deactivateComposition = async (
  id: string,
  db = prisma,
): Promise<PublicComposition> => {
  return updateComposition(id, { active: false }, db);
};

export const reactivateComposition = async (
  id: string,
  db = prisma,
): Promise<PublicComposition> => {
  return updateComposition(id, { active: true }, db);
};
