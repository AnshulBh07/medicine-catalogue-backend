import { Prisma, type Batch, type CommercialDetails, type Composition, type CompositionSalt, type Manufacturer, type Medicine, type MR, type User } from '@prisma/client/index';
import { AppError } from '../../common/errors/app-error.js';
import { prisma } from '../../lib/prisma.js';
import { r2StorageService } from '../../services/storage/r2.service.js';
import { getLatestBatchForMedicine } from '../batches/batch.service.js';
import { formatCompositionDisplayText } from '../compositions/composition.utils.js';
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
type UserReference = Pick<User, 'id' | 'name'>;

type CommercialDetailsRecord = CommercialDetails & {
  updatedByUser: UserReference;
};

type BatchWithCommercial = Batch & {
  commercialDetails: CommercialDetailsRecord | null;
};

type MedicineRecord = Medicine & {
  composition: CompositionReference;
  manufacturer: ManufacturerReference;
  mr: MrReference | null;
  batches: BatchWithCommercial[];
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
  batches: {
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    include: {
      commercialDetails: {
        include: {
          updatedByUser: { select: { id: true, name: true } },
        },
      },
    },
  },
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
        batches?: {
          some?: {
            commercialDetails?: {
              mrp?: {
                gte?: number;
                lte?: number;
              };
            };
          };
        };
      };
      include: typeof medicineInclude;
      orderBy?:
        | { name?: 'asc' | 'desc' }
        | { packQuantity?: 'asc' | 'desc' }
        | { createdAt?: 'asc' | 'desc' }
        | { updatedAt?: 'asc' | 'desc' }
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

const toPublicMedicine = (medicine: MedicineRecord): PublicMedicine => {
  const latestBatch = medicine.batches && medicine.batches.length > 0 ? medicine.batches[0] : null;
  const commDetails = latestBatch?.commercialDetails || null;

  return {
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
    mrp: commDetails ? Number(commDetails.mrp) : null,
    createdAt: medicine.createdAt,
    updatedAt: medicine.updatedAt,
  };
};

const medicineNotFound = (): AppError =>
  new AppError(404, 'MEDICINE_NOT_FOUND', 'Medicine not found');

const referenceNotFound = (reference: string): AppError =>
  new AppError(404, `${reference.toUpperCase()}_NOT_FOUND`, `${reference} not found`);

const inactiveReference = (reference: string): AppError =>
  new AppError(409, `INACTIVE_${reference.toUpperCase()}`, `${reference} must be active`);

const getOrderBy = (
  sortBy: MedicineSortField = 'name',
  sortOrder: SortOrder = 'asc',
) => {
  switch (sortBy) {
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
            batches: {
              some: {
                commercialDetails: {
                  ...(minPrice !== undefined ? { mrp: { gte: minPrice } } : {}),
                  ...(maxPrice !== undefined ? { mrp: { lte: maxPrice } } : {}),
                },
              },
            },
          }
        : {}),
    },
    include: medicineInclude,
    orderBy: getOrderBy(sortBy, sortOrder),
  });

  const publicList = medicines.map(toPublicMedicine);

  if (sortBy === 'mrp') {
    publicList.sort((a, b) => {
      if (a.mrp === null && b.mrp === null) return 0;
      if (a.mrp === null) return 1;
      if (b.mrp === null) return -1;
      return sortOrder === 'desc' ? b.mrp - a.mrp : a.mrp - b.mrp;
    });
  }

  return publicList;
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

const resolveManufacturer = async (
  tx: Prisma.TransactionClient,
  input: { manufacturerId?: string; manufacturerName?: string },
): Promise<string> => {
  const rawName = input.manufacturerName?.trim();

  if (input.manufacturerId) {
    const manufacturer = await tx.manufacturer.findUnique({
      where: { id: input.manufacturerId },
      select: { id: true, name: true, active: true },
    });
    if (manufacturer) {
      if (!manufacturer.active) throw inactiveReference('manufacturer');
      if (!rawName || manufacturer.name.toLowerCase() === rawName.toLowerCase()) {
        return manufacturer.id;
      }
    } else if (!rawName) {
      throw referenceNotFound('manufacturer');
    }
  }

  if (rawName) {
    const existing = await tx.manufacturer.findFirst({
      where: { name: { equals: rawName, mode: 'insensitive' } },
      select: { id: true, name: true, active: true },
    });

    if (existing) {
      if (!existing.active) {
        throw inactiveReference('manufacturer');
      }
      return existing.id;
    }

    try {
      const created = await tx.manufacturer.create({
        data: {
          name: rawName,
          active: true,
        },
        select: { id: true, name: true, active: true },
      });
      return created.id;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const fallback = await tx.manufacturer.findFirst({
          where: { name: { equals: rawName, mode: 'insensitive' } },
          select: { id: true, name: true, active: true },
        });
        if (fallback) {
          if (!fallback.active) throw inactiveReference('manufacturer');
          return fallback.id;
        }
      }
      throw err;
    }
  }

  throw referenceNotFound('manufacturer');
};

type SaltInputItem = {
  saltId?: string;
  name?: string;
  saltName?: string;
  amount: number;
  unit: CompositionSalt['unit'];
};

const resolveCompositionFromSalts = async (
  tx: Prisma.TransactionClient,
  saltInputs: SaltInputItem[],
): Promise<string> => {
  const resolvedSalts: Array<{ id: string; name: string; amount: number; unit: CompositionSalt['unit'] }> = [];

  for (const item of saltInputs) {
    const rawName = (item.name || item.saltName)?.trim();
    let saltRecord: { id: string; name: string; active: boolean } | null = null;

    if (item.saltId) {
      saltRecord = await tx.salt.findUnique({
        where: { id: item.saltId },
        select: { id: true, name: true, active: true },
      });
      if (saltRecord && rawName && saltRecord.name.toLowerCase() !== rawName.toLowerCase()) {
        saltRecord = null;
      }
    }

    if (!saltRecord && rawName) {
      saltRecord = await tx.salt.findFirst({
        where: { name: { equals: rawName, mode: 'insensitive' } },
        select: { id: true, name: true, active: true },
      });

      if (!saltRecord) {
        try {
          saltRecord = await tx.salt.create({
            data: {
              name: rawName,
              description: null,
              active: true,
            },
            select: { id: true, name: true, active: true },
          });
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            saltRecord = await tx.salt.findFirst({
              where: { name: { equals: rawName, mode: 'insensitive' } },
              select: { id: true, name: true, active: true },
            });
          } else {
            throw err;
          }
        }
      }
    }

    if (!saltRecord) {
      throw referenceNotFound('salt');
    }

    if (!saltRecord.active) {
      throw inactiveReference('salt');
    }

    resolvedSalts.push({
      id: saltRecord.id,
      name: saltRecord.name,
      amount: item.amount,
      unit: item.unit,
    });
  }

  const seenSaltIds = new Set<string>();
  for (const salt of resolvedSalts) {
    if (seenSaltIds.has(salt.id)) {
      throw new AppError(
        400,
        'DUPLICATE_SALT_IN_COMPOSITION',
        `Duplicate salt '${salt.name}' provided in composition. Each salt in a composition must be unique`,
      );
    }
    seenSaltIds.add(salt.id);
  }

  const compositionSaltIds: string[] = [];
  for (const item of resolvedSalts) {
    let compSalt = await tx.compositionSalt.findFirst({
      where: {
        saltId: item.id,
        amount: item.amount,
        unit: item.unit,
      },
      select: { id: true },
    });
    if (!compSalt) {
      compSalt = await tx.compositionSalt.create({
        data: {
          saltId: item.id,
          amount: item.amount,
          unit: item.unit,
        },
        select: { id: true },
      });
    }
    compositionSaltIds.push(compSalt.id);
  }

  const candidateCompositions = await tx.composition.findMany({
    where: {
      active: true,
      compositionSaltLinks: {
        some: {
          compositionSaltId: { in: compositionSaltIds },
        },
      },
    },
    include: {
      compositionSaltLinks: { select: { compositionSaltId: true } },
    },
  });

  const matchingComp = candidateCompositions.find((comp: { compositionSaltLinks: Array<{ compositionSaltId: string }> }) => {
    if (comp.compositionSaltLinks.length !== compositionSaltIds.length) return false;
    const linkedIds = new Set(comp.compositionSaltLinks.map((l) => l.compositionSaltId));
    return compositionSaltIds.every((id) => linkedIds.has(id));
  });

  if (matchingComp) {
    return matchingComp.id;
  }

  const displayText = formatCompositionDisplayText(resolvedSalts);

  const newComp = await tx.composition.create({
    data: {
      displayText,
      description: null,
      active: true,
    },
  });

  await tx.compositionCompositionSalt.createMany({
    data: compositionSaltIds.map((compositionSaltId) => ({
      compositionId: newComp.id,
      compositionSaltId,
    })),
  });

  return newComp.id;
};

export const createMedicine = async (
  input: CreateMedicineInput,
  userId?: string,
  db = prisma,
): Promise<PublicMedicine> => {
  const saltInputs = input.salts ?? input.compositionSalts;

  return (db as unknown as typeof prisma).$transaction(async (tx) => {
    const resolvedManufacturerId = await resolveManufacturer(tx, {
      manufacturerId: input.manufacturerId,
      manufacturerName: input.manufacturerName,
    });

    if (input.mrId) {
      const mr = await tx.mR.findUnique({
        where: { id: input.mrId },
        select: { id: true, name: true, company: true, phone: true, active: true },
      });
      if (!mr) throw referenceNotFound('mr');
      if (!mr.active) throw inactiveReference('mr');
    }

    let resolvedCompositionId = input.compositionId;

    if (saltInputs && saltInputs.length > 0) {
      resolvedCompositionId = await resolveCompositionFromSalts(tx, saltInputs);
    } else if (resolvedCompositionId) {
      const composition = await tx.composition.findUnique({
        where: { id: resolvedCompositionId },
        select: { id: true, displayText: true, active: true },
      });
      if (!composition) throw referenceNotFound('composition');
      if (!composition.active) throw inactiveReference('composition');
    } else {
      throw referenceNotFound('composition');
    }

    let createdMedicine: MedicineRecord;
    try {
      createdMedicine = (await tx.medicine.create({
        data: {
          name: input.name,
          compositionId: resolvedCompositionId,
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
          manufacturerId: resolvedManufacturerId,
          mrId: input.mrId ?? null,
          active: true,
        },
        include: medicineInclude,
      })) as MedicineRecord;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppError(409, 'DUPLICATE_BARCODE', 'A medicine with this barcode already exists');
      }
      throw error;
    }

    // Determine First Batch Information
    let batchNumber: string | undefined;
    let manufacturingDate: Date | null = null;
    let expiryDate: Date | undefined;
    let commData: {
      purchaseRate: number;
      mrp: number;
      discountPercent: number;
      scheme?: Prisma.InputJsonValue | null;
      privateNotes?: string | null;
    } | undefined;

    if (input.firstBatch) {
      batchNumber = input.firstBatch.batchNumber;
      manufacturingDate = input.firstBatch.manufacturingDate ?? null;
      expiryDate = input.firstBatch.expiryDate;
      const fbComm = input.firstBatch.commercialDetails;
      if (fbComm) {
        commData = {
          purchaseRate: fbComm.purchaseRate ?? 0,
          mrp: fbComm.mrp,
          discountPercent: fbComm.discountPercent ?? 0,
          scheme: fbComm.scheme as Prisma.InputJsonValue,
          privateNotes: fbComm.privateNotes,
        };
      } else if (input.firstBatch.mrp !== undefined) {
        commData = {
          purchaseRate: input.firstBatch.purchaseRate ?? 0,
          mrp: input.firstBatch.mrp,
          discountPercent: input.firstBatch.discountPercent ?? 0,
          scheme: input.firstBatch.scheme as Prisma.InputJsonValue,
          privateNotes: input.firstBatch.privateNotes,
        };
      }
    } else if (input.batchNumber && input.expiryDate) {
      batchNumber = input.batchNumber;
      manufacturingDate = input.manufacturingDate ?? null;
      expiryDate = input.expiryDate;
      if (input.commercialDetails) {
        commData = {
          purchaseRate: input.commercialDetails.purchaseRate ?? 0,
          mrp: input.commercialDetails.mrp,
          discountPercent: input.commercialDetails.discountPercent ?? 0,
          scheme: input.commercialDetails.scheme as Prisma.InputJsonValue,
          privateNotes: input.commercialDetails.privateNotes,
        };
      } else if (input.mrp !== undefined) {
        commData = {
          purchaseRate: input.purchaseRate ?? 0,
          mrp: input.mrp,
          discountPercent: input.discountPercent ?? 0,
          scheme: input.scheme as Prisma.InputJsonValue,
          privateNotes: input.privateNotes,
        };
      }
    } else if (input.commercialDetails || input.mrp !== undefined) {
      batchNumber = 'BATCH-001';
      manufacturingDate = input.manufacturingDate ?? null;
      expiryDate = input.expiryDate ?? new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000);
      if (input.commercialDetails) {
        commData = {
          purchaseRate: input.commercialDetails.purchaseRate ?? 0,
          mrp: input.commercialDetails.mrp,
          discountPercent: input.commercialDetails.discountPercent ?? 0,
          scheme: input.commercialDetails.scheme as Prisma.InputJsonValue,
          privateNotes: input.commercialDetails.privateNotes,
        };
      } else {
        commData = {
          purchaseRate: input.purchaseRate ?? 0,
          mrp: input.mrp!,
          discountPercent: input.discountPercent ?? 0,
          scheme: input.scheme as Prisma.InputJsonValue,
          privateNotes: input.privateNotes,
        };
      }
    }

    if (batchNumber && expiryDate) {
      if (manufacturingDate && expiryDate <= manufacturingDate) {
        throw new AppError(400, 'INVALID_DATES', 'Expiry date must be after manufacturing date');
      }

      const createdBatch = await tx.batch.create({
        data: {
          medicineId: createdMedicine.id,
          batchNumber,
          manufacturingDate,
          expiryDate,
        },
      });

      if (commData && userId) {
        await tx.commercialDetails.create({
          data: {
            batchId: createdBatch.id,
            purchaseRate: commData.purchaseRate ?? 0,
            mrp: commData.mrp,
            discountPercent: commData.discountPercent ?? 0,
            scheme:
              commData.scheme === undefined || commData.scheme === null
                ? Prisma.DbNull
                : (commData.scheme as Prisma.InputJsonValue),
            privateNotes: commData.privateNotes ?? null,
            updatedBy: userId,
          },
        });
      }

      const refreshed = await tx.medicine.findUnique({
        where: { id: createdMedicine.id },
        include: medicineInclude,
      });
      if (refreshed) {
        createdMedicine = refreshed as MedicineRecord;
      }
    }

    return toPublicMedicine(createdMedicine);
  });
};

export const updateMedicine = async (
  id: string,
  input: UpdateMedicineInput,
  userId?: string,
  db: MedicineStore = prisma,
): Promise<PublicMedicine> => {
  let oldImageUrlToDelete: string | null = null;

  const runUpdate = async (tx: Prisma.TransactionClient): Promise<PublicMedicine> => {
    const existing = await tx.medicine.findUnique({ where: { id }, include: medicineInclude });
    if (!existing) throw medicineNotFound();

    if (
      input.imageUrl !== undefined &&
      input.imageUrl !== existing.imageUrl &&
      existing.imageUrl
    ) {
      oldImageUrlToDelete = existing.imageUrl;
    }

    let resolvedManufacturerId: string | undefined;
    if (input.manufacturerId !== undefined || input.manufacturerName !== undefined) {
      resolvedManufacturerId = await resolveManufacturer(tx, {
        manufacturerId: input.manufacturerId,
        manufacturerName: input.manufacturerName,
      });
    }

    if (input.mrId !== undefined && input.mrId !== null) {
      const mr = await tx.mR.findUnique({
        where: { id: input.mrId },
        select: { id: true, name: true, company: true, phone: true, active: true },
      });
      if (!mr) throw referenceNotFound('mr');
      if (!mr.active) throw inactiveReference('mr');
    }

    let resolvedCompositionId = input.compositionId;
    const saltInputs = input.salts ?? input.compositionSalts;

    if (saltInputs && saltInputs.length > 0) {
      resolvedCompositionId = await resolveCompositionFromSalts(tx, saltInputs);
    } else if (input.compositionId !== undefined) {
      const composition = await tx.composition.findUnique({
        where: { id: input.compositionId },
        select: { id: true, displayText: true, active: true },
      });
      if (!composition) throw referenceNotFound('composition');
      if (!composition.active) throw inactiveReference('composition');
    }

    const barcode =
      input.barcode !== undefined
        ? input.barcode
          ? input.barcode.trim() || null
          : null
        : undefined;

    const dataToUpdate: Record<string, unknown> = {};
    if (input.name !== undefined) dataToUpdate.name = input.name;
    if (input.form !== undefined) dataToUpdate.form = input.form;
    if (input.packQuantity !== undefined) dataToUpdate.packQuantity = input.packQuantity;
    if (input.packUnit !== undefined) dataToUpdate.packUnit = input.packUnit;
    if (input.shortDescription !== undefined) dataToUpdate.shortDescription = input.shortDescription;
    if (input.imageUrl !== undefined) dataToUpdate.imageUrl = input.imageUrl;
    if (input.uses !== undefined) dataToUpdate.uses = input.uses;
    if (input.recommendedAgeGroup !== undefined) dataToUpdate.recommendedAgeGroup = input.recommendedAgeGroup;
    if (input.directions !== undefined) dataToUpdate.directions = input.directions;
    if (input.warnings !== undefined) dataToUpdate.warnings = input.warnings;
    if (input.storageInstructions !== undefined) dataToUpdate.storageInstructions = input.storageInstructions;
    if (input.prescriptionRequired !== undefined) dataToUpdate.prescriptionRequired = input.prescriptionRequired;
    if (input.active !== undefined) dataToUpdate.active = input.active;
    if (barcode !== undefined) dataToUpdate.barcode = barcode;
    if (resolvedManufacturerId !== undefined) dataToUpdate.manufacturerId = resolvedManufacturerId;
    if (input.mrId !== undefined) dataToUpdate.mrId = input.mrId;
    if (resolvedCompositionId !== undefined) dataToUpdate.compositionId = resolvedCompositionId;

    let updatedMedicine: MedicineRecord;
    try {
      updatedMedicine = (await tx.medicine.update({
        where: { id },
        data: dataToUpdate,
        include: medicineInclude,
      })) as MedicineRecord;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppError(409, 'DUPLICATE_BARCODE', 'A medicine with this barcode already exists');
      }
      throw error;
    }

    const commData = input.commercialDetails || (input.mrp !== undefined ? {
      purchaseRate: input.purchaseRate,
      mrp: input.mrp,
      discountPercent: input.discountPercent,
      scheme: input.scheme,
      privateNotes: input.privateNotes,
    } : undefined);

    if (commData && userId) {
      let latestBatch = await getLatestBatchForMedicine(id, tx as unknown as typeof prisma);
      if (!latestBatch) {
        latestBatch = await tx.batch.create({
          data: {
            medicineId: id,
            batchNumber: 'BATCH-001',
            manufacturingDate: new Date(),
            expiryDate: new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000),
          },
          include: {
            medicine: { select: { id: true, name: true, active: true } },
            commercialDetails: {
              include: {
                updatedByUser: { select: { id: true, name: true } },
              },
            },
          },
        });
      }

      if (latestBatch.commercialDetails) {
        await tx.commercialDetails.update({
          where: { batchId: latestBatch.id },
          data: {
            purchaseRate: commData.purchaseRate !== undefined
              ? commData.purchaseRate
              : latestBatch.commercialDetails.purchaseRate,
            mrp: commData.mrp !== undefined ? commData.mrp : latestBatch.commercialDetails.mrp,
            discountPercent: commData.discountPercent !== undefined
              ? commData.discountPercent
              : latestBatch.commercialDetails.discountPercent,
            scheme:
              commData.scheme === undefined
                ? (latestBatch.commercialDetails.scheme === null
                  ? Prisma.DbNull
                  : (latestBatch.commercialDetails.scheme as Prisma.InputJsonValue))
                : commData.scheme === null
                ? Prisma.DbNull
                : (commData.scheme as Prisma.InputJsonValue),
            privateNotes:
              commData.privateNotes !== undefined
                ? commData.privateNotes
                : latestBatch.commercialDetails.privateNotes,
            updatedBy: userId,
          },
        });
      } else if (commData.mrp !== undefined) {
        await tx.commercialDetails.create({
          data: {
            batchId: latestBatch.id,
            purchaseRate: commData.purchaseRate ?? 0,
            mrp: commData.mrp,
            discountPercent: commData.discountPercent ?? 0,
            scheme:
              commData.scheme === undefined || commData.scheme === null
                ? Prisma.DbNull
                : (commData.scheme as Prisma.InputJsonValue),
            privateNotes: commData.privateNotes ?? null,
            updatedBy: userId,
          },
        });
      }

      const refreshed = await tx.medicine.findUnique({
        where: { id },
        include: medicineInclude,
      });
      if (refreshed) {
        updatedMedicine = refreshed as MedicineRecord;
      }
    }

    return toPublicMedicine(updatedMedicine);
  };

  const result = await (db as unknown as typeof prisma).$transaction(runUpdate);

  if (oldImageUrlToDelete) {
    await r2StorageService.deleteObjectByPublicUrl(oldImageUrlToDelete);
  }

  return result;
};

export const deactivateMedicine = async (
  id: string,
  db: MedicineStore = prisma,
): Promise<PublicMedicine> => {
  const existing = await db.medicine.findUnique({ where: { id }, include: medicineInclude });
  if (!existing) throw medicineNotFound();
  if (!existing.active) return toPublicMedicine(existing);

  const result = toPublicMedicine((await db.medicine.update({
    where: { id },
    data: { active: false },
    include: medicineInclude,
  })) as MedicineRecord);

  if (existing.imageUrl) {
    await r2StorageService.deleteObjectByPublicUrl(existing.imageUrl);
  }

  return result;
};
