import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../common/errors/app-error.js';
import type { ShortageStatus, ShortageUnit, Prisma } from '@prisma/client';
import type {
  CreateShortageItemInput,
  PatchShortageItemInput,
  ShortageDateQuery,
} from './shortage.schemas.js';

export function getUtcDateString(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function parseDateToUtc(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

export interface ShortageSummaryCounts {
  total: number;
  pending: number;
  ordered: number;
  completed: number;
}

export interface FormattedShortageItem {
  id: string;
  medicineId: string;
  date: string;
  quantity: number;
  unit: ShortageUnit;
  status: ShortageStatus;
  note: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  medicine: {
    id: string;
    name: string;
    form: string;
    packQuantity: number;
    packUnit: string;
    imageUrl: string | null;
    shortDescription: string | null;
    composition: {
      id: string;
      displayText: string;
    };
    manufacturer: {
      id: string;
      name: string;
    };
    mr: {
      id: string;
      name: string;
      company: string | null;
      phone: string | null;
      email: string | null;
      active: boolean;
    } | null;
  };
  createdBy: {
    id: string;
    name: string;
    email: string | null;
    role: string;
  } | null;
}

export interface DailyShortageResult {
  date: string;
  summary: ShortageSummaryCounts;
  items: FormattedShortageItem[];
}

function formatShortageItem(
  item: Prisma.ShortageItemGetPayload<{
    include: {
      medicine: {
        include: {
          manufacturer: true;
          composition: true;
          mr: true;
        };
      };
      createdBy: {
        select: {
          id: true;
          name: true;
          email: true;
          role: true;
        };
      };
    };
  }>,
): FormattedShortageItem {
  const dateStr = item.date instanceof Date ? item.date.toISOString().slice(0, 10) : String(item.date);

  return {
    id: item.id,
    medicineId: item.medicineId,
    date: dateStr,
    quantity: item.quantity,
    unit: item.unit,
    status: item.status,
    note: item.note,
    createdById: item.createdById,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    medicine: {
      id: item.medicine.id,
      name: item.medicine.name,
      form: item.medicine.form,
      packQuantity: Number(item.medicine.packQuantity),
      packUnit: item.medicine.packUnit,
      imageUrl: item.medicine.imageUrl,
      shortDescription: item.medicine.shortDescription,
      composition: {
        id: item.medicine.composition.id,
        displayText: item.medicine.composition.displayText,
      },
      manufacturer: {
        id: item.medicine.manufacturer.id,
        name: item.medicine.manufacturer.name,
      },
      mr: item.medicine.mr
        ? {
            id: item.medicine.mr.id,
            name: item.medicine.mr.name,
            company: item.medicine.mr.company,
            phone: item.medicine.mr.phone,
            email: item.medicine.mr.email,
            active: item.medicine.mr.active,
          }
        : null,
    },
    createdBy: item.createdBy
      ? {
          id: item.createdBy.id,
          name: item.createdBy.name,
          email: item.createdBy.email,
          role: item.createdBy.role,
        }
      : null,
  };
}

export const shortageService = {
  async getDailyShortages(query: ShortageDateQuery): Promise<DailyShortageResult> {
    const targetDateStr = query.date || getUtcDateString();
    const targetDate = parseDateToUtc(targetDateStr);

    // 1. Calculate overall summary counts for target date (unfiltered by search/status)
    const allDateItems = await prisma.shortageItem.findMany({
      where: { date: targetDate },
      select: { status: true },
    });

    const summary: ShortageSummaryCounts = {
      total: allDateItems.length,
      pending: allDateItems.filter((i) => i.status === 'PENDING').length,
      ordered: allDateItems.filter((i) => i.status === 'ORDERED').length,
      completed: allDateItems.filter((i) => i.status === 'COMPLETED').length,
    };

    // 2. Build where filter for items list
    const where: Prisma.ShortageItemWhereInput = {
      date: targetDate,
    };

    if (query.status) {
      where.status = query.status as ShortageStatus;
    }

    if (query.search) {
      const search = query.search.trim();
      where.OR = [
        {
          medicine: {
            name: {
              contains: search,
              mode: 'insensitive',
            },
          },
        },
        {
          medicine: {
            manufacturer: {
              name: {
                contains: search,
                mode: 'insensitive',
              },
            },
          },
        },
        {
          medicine: {
            composition: {
              displayText: {
                contains: search,
                mode: 'insensitive',
              },
            },
          },
        },
      ];
    }

    const items = await prisma.shortageItem.findMany({
      where,
      include: {
        medicine: {
          include: {
            manufacturer: true,
            composition: true,
            mr: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
      orderBy: [
        { createdAt: 'asc' },
      ],
    });

    return {
      date: targetDateStr,
      summary,
      items: items.map(formatShortageItem),
    };
  },

  async getShortageItemById(id: string): Promise<FormattedShortageItem> {
    const item = await prisma.shortageItem.findUnique({
      where: { id },
      include: {
        medicine: {
          include: {
            manufacturer: true,
            composition: true,
            mr: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
    });

    if (!item) {
      throw new AppError(404, 'NOT_FOUND', 'Shortage item not found');
    }

    return formatShortageItem(item);
  },

  async createShortageItem(
    userId: string,
    input: CreateShortageItemInput,
  ): Promise<FormattedShortageItem> {
    const targetDateStr = input.date || getUtcDateString();
    const todayStr = getUtcDateString();

    if (targetDateStr < todayStr) {
      throw new AppError(
        400,
        'PAST_DATE_NOT_ALLOWED',
        'Cannot add shortage items for past dates',
      );
    }

    const targetDate = parseDateToUtc(targetDateStr);

    // Verify medicine exists and is active
    const medicine = await prisma.medicine.findUnique({
      where: { id: input.medicineId },
      select: { id: true, name: true, active: true },
    });

    if (!medicine) {
      throw new AppError(404, 'NOT_FOUND', 'Medicine not found');
    }

    if (!medicine.active) {
      throw new AppError(
        400,
        'INACTIVE_MEDICINE',
        'Cannot add an inactive medicine to the shortage list',
      );
    }

    // Check for duplicate on the same day
    const existing = await prisma.shortageItem.findUnique({
      where: {
        medicineId_date: {
          medicineId: input.medicineId,
          date: targetDate,
        },
      },
    });

    if (existing) {
      throw new AppError(
        409,
        'DUPLICATE_SHORTAGE_ITEM',
        `${medicine.name} is already on the shortage list for ${targetDateStr}. You can update its quantity instead.`,
      );
    }

    const created = await prisma.shortageItem.create({
      data: {
        medicineId: input.medicineId,
        date: targetDate,
        quantity: input.quantity,
        unit: (input.unit as ShortageUnit) || 'PACK',
        note: input.note ? input.note.trim() : null,
        status: (input.status as ShortageStatus) || 'PENDING',
        createdById: userId,
      },
      include: {
        medicine: {
          include: {
            manufacturer: true,
            composition: true,
            mr: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
    });

    return formatShortageItem(created);
  },

  async patchShortageItem(
    id: string,
    input: PatchShortageItemInput,
  ): Promise<FormattedShortageItem> {
    const existing = await prisma.shortageItem.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new AppError(404, 'NOT_FOUND', 'Shortage item not found');
    }

    const updateData: Prisma.ShortageItemUpdateInput = {};

    if (input.quantity !== undefined) {
      updateData.quantity = input.quantity;
    }

    if (input.unit !== undefined) {
      updateData.unit = input.unit as ShortageUnit;
    }

    if (input.status !== undefined) {
      updateData.status = input.status as ShortageStatus;
    }

    if (input.note !== undefined) {
      updateData.note = input.note ? input.note.trim() : null;
    }

    const updated = await prisma.shortageItem.update({
      where: { id },
      data: updateData,
      include: {
        medicine: {
          include: {
            manufacturer: true,
            composition: true,
            mr: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
    });

    return formatShortageItem(updated);
  },

  async deleteShortageItem(id: string): Promise<{ message: string }> {
    const existing = await prisma.shortageItem.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new AppError(404, 'NOT_FOUND', 'Shortage item not found');
    }

    await prisma.shortageItem.delete({
      where: { id },
    });

    return { message: 'Shortage item removed successfully' };
  },
};
