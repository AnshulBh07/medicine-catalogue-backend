import { Prisma, type DealStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../common/errors/app-error.js';
import type {
  CreateDealInput,
  ListDealsInput,
  UpdateDealInput,
} from './deal.schemas.js';

export interface PublicDeal {
  id: string;
  medicineId: string;
  medicine: {
    id: string;
    name: string;
    form: string;
    packQuantity: number;
    packUnit: string;
    manufacturer: {
      id: string;
      name: string;
    } | null;
  };
  mrId: string;
  mr: {
    id: string;
    name: string;
    company: string | null;
    phone: string | null;
    email: string | null;
  };
  dealDate: string;
  agreedMrp: number;
  agreedScheme: string;
  agreedBillDiscount: number;
  mrPhoneSnapshot: string | null;
  status: DealStatus;
  notes: string | null;
  createdById: string | null;
  createdBy: {
    id: string;
    name: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

const dealInclude = {
  medicine: {
    select: {
      id: true,
      name: true,
      form: true,
      packQuantity: true,
      packUnit: true,
      manufacturer: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
  mr: {
    select: {
      id: true,
      name: true,
      company: true,
      phone: true,
      email: true,
    },
  },
  createdBy: {
    select: {
      id: true,
      name: true,
    },
  },
} as const;

type DealRecordWithRelations = Prisma.DealGetPayload<{
  include: typeof dealInclude;
}>;

const toPublicDeal = (deal: DealRecordWithRelations): PublicDeal => ({
  id: deal.id,
  medicineId: deal.medicineId,
  medicine: {
    id: deal.medicine.id,
    name: deal.medicine.name,
    form: deal.medicine.form,
    packQuantity: Number(deal.medicine.packQuantity),
    packUnit: deal.medicine.packUnit,
    manufacturer: deal.medicine.manufacturer
      ? {
          id: deal.medicine.manufacturer.id,
          name: deal.medicine.manufacturer.name,
        }
      : null,
  },
  mrId: deal.mrId,
  mr: {
    id: deal.mr.id,
    name: deal.mr.name,
    company: deal.mr.company,
    phone: deal.mr.phone,
    email: deal.mr.email,
  },
  dealDate: deal.dealDate.toISOString(),
  agreedMrp: Number(deal.agreedMrp),
  agreedScheme: deal.agreedScheme,
  agreedBillDiscount: Number(deal.agreedBillDiscount),
  mrPhoneSnapshot: deal.mrPhoneSnapshot,
  status: deal.status,
  notes: deal.notes,
  createdById: deal.createdById,
  createdBy: deal.createdBy
    ? {
        id: deal.createdBy.id,
        name: deal.createdBy.name,
      }
    : null,
  createdAt: deal.createdAt.toISOString(),
  updatedAt: deal.updatedAt.toISOString(),
});

export const checkPendingDeal = async (
  medicineId: string,
  mrId: string,
  db = prisma,
): Promise<{ hasPendingDeal: boolean; deal: PublicDeal | null }> => {
  const pendingDeal = await db.deal.findFirst({
    where: {
      medicineId,
      mrId,
      status: 'PENDING',
    },
    include: dealInclude,
    orderBy: { createdAt: 'desc' },
  });

  return {
    hasPendingDeal: pendingDeal !== null,
    deal: pendingDeal ? toPublicDeal(pendingDeal) : null,
  };
};

export const createDeal = async (
  input: CreateDealInput,
  createdById?: string,
  db = prisma,
): Promise<{ deal: PublicDeal; warning?: string }> => {
  const medicine = await db.medicine.findUnique({
    where: { id: input.medicineId },
    select: { id: true, name: true },
  });
  if (!medicine) {
    throw new AppError(404, 'NOT_FOUND', 'Medicine not found');
  }

  const mr = await db.mR.findUnique({
    where: { id: input.mrId },
    select: { id: true, name: true, phone: true },
  });
  if (!mr) {
    throw new AppError(404, 'NOT_FOUND', 'Medical representative not found');
  }

  const existingPending = await db.deal.findFirst({
    where: {
      medicineId: input.medicineId,
      mrId: input.mrId,
      status: 'PENDING',
    },
    select: { id: true, dealDate: true },
  });

  const effectivePhoneSnapshot =
    input.mrPhoneSnapshot !== undefined
      ? input.mrPhoneSnapshot
      : mr.phone || null;

  const deal = await db.deal.create({
    data: {
      medicineId: input.medicineId,
      mrId: input.mrId,
      dealDate: input.dealDate ?? new Date(),
      agreedMrp: input.agreedMrp,
      agreedScheme: input.agreedScheme,
      agreedBillDiscount: input.agreedBillDiscount,
      mrPhoneSnapshot: effectivePhoneSnapshot,
      status: input.status ?? 'PENDING',
      notes: input.notes ?? null,
      createdById: createdById ?? null,
    },
    include: dealInclude,
  });

  let warning: string | undefined;
  if (existingPending) {
    const formattedDate = existingPending.dealDate.toISOString().split('T')[0];
    warning = `Note: An existing pending deal for ${medicine.name} with ${mr.name} is already on record (created on ${formattedDate}).`;
  }

  return {
    deal: toPublicDeal(deal),
    ...(warning ? { warning } : {}),
  };
};

export const getDeal = async (
  id: string,
  db = prisma,
): Promise<PublicDeal> => {
  const deal = await db.deal.findUnique({
    where: { id },
    include: dealInclude,
  });
  if (!deal) {
    throw new AppError(404, 'NOT_FOUND', 'Deal not found');
  }
  return toPublicDeal(deal);
};

export const listDeals = async (
  input: ListDealsInput,
  db = prisma,
): Promise<{
  deals: PublicDeal[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  summary: {
    total: number;
    pending: number;
    received: number;
    cancelled: number;
  };
}> => {
  const page = input.page ?? 1;
  const limit = input.limit ?? 50;
  const skip = (page - 1) * limit;

  const where: Prisma.DealWhereInput = {};

  if (input.medicineId) {
    where.medicineId = input.medicineId;
  }

  if (input.mrId) {
    where.mrId = input.mrId;
  }

  if (input.status && input.status !== 'ALL') {
    where.status = input.status as DealStatus;
  }

  if (input.search) {
    const search = input.search.trim();
    where.OR = [
      { medicine: { name: { contains: search, mode: 'insensitive' } } },
      { mr: { name: { contains: search, mode: 'insensitive' } } },
      { mr: { company: { contains: search, mode: 'insensitive' } } },
      { notes: { contains: search, mode: 'insensitive' } },
      { agreedScheme: { contains: search, mode: 'insensitive' } },
    ];
  }

  let orderBy: Prisma.DealOrderByWithRelationInput;
  switch (input.sortBy) {
    case 'medicineName':
      orderBy = { medicine: { name: input.sortOrder ?? 'asc' } };
      break;
    case 'mrName':
      orderBy = { mr: { name: input.sortOrder ?? 'asc' } };
      break;
    case 'createdAt':
      orderBy = { createdAt: input.sortOrder ?? 'desc' };
      break;
    case 'dealDate':
    default:
      orderBy = { dealDate: input.sortOrder ?? 'desc' };
      break;
  }

  // Base where for summary counters matching medicineId and mrId if provided
  const baseFilter: Prisma.DealWhereInput = {};
  if (input.medicineId) baseFilter.medicineId = input.medicineId;
  if (input.mrId) baseFilter.mrId = input.mrId;
  if (input.search) {
    const search = input.search.trim();
    baseFilter.OR = [
      { medicine: { name: { contains: search, mode: 'insensitive' } } },
      { mr: { name: { contains: search, mode: 'insensitive' } } },
      { mr: { company: { contains: search, mode: 'insensitive' } } },
      { notes: { contains: search, mode: 'insensitive' } },
      { agreedScheme: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [deals, totalMatching, totalAll, pendingCount, receivedCount, cancelledCount] =
    await Promise.all([
      db.deal.findMany({
        where,
        include: dealInclude,
        orderBy,
        skip,
        take: limit,
      }),
      db.deal.count({ where }),
      db.deal.count({ where: baseFilter }),
      db.deal.count({ where: { ...baseFilter, status: 'PENDING' } }),
      db.deal.count({ where: { ...baseFilter, status: 'RECEIVED' } }),
      db.deal.count({ where: { ...baseFilter, status: 'CANCELLED' } }),
    ]);

  return {
    deals: deals.map(toPublicDeal),
    pagination: {
      total: totalMatching,
      page,
      limit,
      totalPages: Math.ceil(totalMatching / limit) || 1,
    },
    summary: {
      total: totalAll,
      pending: pendingCount,
      received: receivedCount,
      cancelled: cancelledCount,
    },
  };
};

export const updateDeal = async (
  id: string,
  input: UpdateDealInput,
  db = prisma,
): Promise<PublicDeal> => {
  const existing = await db.deal.findUnique({
    where: { id },
  });
  if (!existing) {
    throw new AppError(404, 'NOT_FOUND', 'Deal not found');
  }

  if (input.medicineId && input.medicineId !== existing.medicineId) {
    const medicine = await db.medicine.findUnique({
      where: { id: input.medicineId },
      select: { id: true },
    });
    if (!medicine) {
      throw new AppError(404, 'NOT_FOUND', 'Medicine not found');
    }
  }

  if (input.mrId && input.mrId !== existing.mrId) {
    const mr = await db.mR.findUnique({
      where: { id: input.mrId },
      select: { id: true },
    });
    if (!mr) {
      throw new AppError(404, 'NOT_FOUND', 'Medical representative not found');
    }
  }

  const updated = await db.deal.update({
    where: { id },
    data: {
      ...(input.medicineId !== undefined ? { medicineId: input.medicineId } : {}),
      ...(input.mrId !== undefined ? { mrId: input.mrId } : {}),
      ...(input.dealDate !== undefined ? { dealDate: input.dealDate } : {}),
      ...(input.agreedMrp !== undefined ? { agreedMrp: input.agreedMrp } : {}),
      ...(input.agreedScheme !== undefined ? { agreedScheme: input.agreedScheme } : {}),
      ...(input.agreedBillDiscount !== undefined ? { agreedBillDiscount: input.agreedBillDiscount } : {}),
      ...(input.mrPhoneSnapshot !== undefined ? { mrPhoneSnapshot: input.mrPhoneSnapshot } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
    include: dealInclude,
  });

  return toPublicDeal(updated);
};

export const updateDealStatus = async (
  id: string,
  status: DealStatus,
  db = prisma,
): Promise<PublicDeal> => {
  const existing = await db.deal.findUnique({
    where: { id },
  });
  if (!existing) {
    throw new AppError(404, 'NOT_FOUND', 'Deal not found');
  }

  const updated = await db.deal.update({
    where: { id },
    data: { status },
    include: dealInclude,
  });

  return toPublicDeal(updated);
};

export const deleteDeal = async (
  id: string,
  db = prisma,
): Promise<{ message: string; id: string }> => {
  const existing = await db.deal.findUnique({
    where: { id },
  });
  if (!existing) {
    throw new AppError(404, 'NOT_FOUND', 'Deal not found');
  }

  await db.deal.delete({
    where: { id },
  });

  return { message: 'Deal deleted successfully', id };
};
