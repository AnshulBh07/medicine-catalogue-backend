import type { MedicineForm } from '@prisma/client';
import { AppError } from '../../common/errors/app-error.js';
import { prisma } from '../../lib/prisma.js';
import { NotificationService } from '../notifications/notification.service.js';
import type {
  CreateMedicineAlternativeInput,
  ListMedicineAlternativesQueryInput,
  UpdateMedicineAlternativeInput,
} from './medicine-alternative.schemas.js';

export interface AlternativeMedicineSummary {
  id: string;
  name: string;
  form: MedicineForm;
  packQuantity: number;
  packUnit: string;
  compositionText: string;
  active: boolean;
}

export interface PublicAlternativeGroup {
  sourceMedicine: AlternativeMedicineSummary;
  alternatives: Array<{
    id: string;
    medicine: AlternativeMedicineSummary;
    createdAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

const medicineSelect = {
  id: true,
  name: true,
  form: true,
  packQuantity: true,
  packUnit: true,
  active: true,
  composition: {
    select: {
      id: true,
      displayText: true,
    },
  },
};

export class MedicineAlternativeService {
  /**
   * List all medicine alternative groups with optional search and filtering.
   */
  static async listAlternatives(
    query?: ListMedicineAlternativesQueryInput,
  ): Promise<PublicAlternativeGroup[]> {
    const rawItems = await prisma.medicineAlternative.findMany({
      where: {
        ...(query?.sourceMedicineId ? { sourceMedicineId: query.sourceMedicineId } : {}),
      },
      include: {
        sourceMedicine: { select: medicineSelect },
        alternativeMedicine: { select: medicineSelect },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Group items by sourceMedicineId
    const groupMap = new Map<string, PublicAlternativeGroup>();

    for (const item of rawItems) {
      const sourceId = item.sourceMedicineId;
      if (!groupMap.has(sourceId)) {
        groupMap.set(sourceId, {
          sourceMedicine: {
            id: item.sourceMedicine.id,
            name: item.sourceMedicine.name,
            form: item.sourceMedicine.form,
            packQuantity: Number(item.sourceMedicine.packQuantity),
            packUnit: item.sourceMedicine.packUnit,
            compositionText: item.sourceMedicine.composition.displayText,
            active: item.sourceMedicine.active,
          },
          alternatives: [],
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
        });
      }

      const group = groupMap.get(sourceId)!;
      group.alternatives.push({
        id: item.id,
        medicine: {
          id: item.alternativeMedicine.id,
          name: item.alternativeMedicine.name,
          form: item.alternativeMedicine.form,
          packQuantity: Number(item.alternativeMedicine.packQuantity),
          packUnit: item.alternativeMedicine.packUnit,
          compositionText: item.alternativeMedicine.composition.displayText,
          active: item.alternativeMedicine.active,
        },
        createdAt: item.createdAt.toISOString(),
      });

      // Keep latest updatedAt on group
      if (new Date(item.updatedAt).getTime() > new Date(group.updatedAt).getTime()) {
        group.updatedAt = item.updatedAt.toISOString();
      }
    }

    let groups = Array.from(groupMap.values());

    // Apply search filter across source name, source composition, and alternatives
    const search = query?.search?.trim().toLowerCase();
    if (search) {
      groups = groups.filter((group) => {
        const sourceNameMatch = group.sourceMedicine.name.toLowerCase().includes(search);
        const sourceCompMatch = group.sourceMedicine.compositionText.toLowerCase().includes(search);
        const altMatch = group.alternatives.some(
          (alt) =>
            alt.medicine.name.toLowerCase().includes(search) ||
            alt.medicine.compositionText.toLowerCase().includes(search),
        );
        return sourceNameMatch || sourceCompMatch || altMatch;
      });
    }

    return groups;
  }

  /**
   * Get alternative status for a specific medicine (both as source and as target).
   */
  static async getByMedicineId(medicineId: string): Promise<{
    doNotUse: PublicAlternativeGroup | null;
    isAlternativeFor: Array<{
      sourceMedicineId: string;
      sourceMedicineName: string;
      sourceForm: MedicineForm;
      sourceCompositionText: string;
    }>;
  }> {
    const [sourceAlternatives, targetAlternatives] = await Promise.all([
      prisma.medicineAlternative.findMany({
        where: { sourceMedicineId: medicineId },
        include: {
          sourceMedicine: { select: medicineSelect },
          alternativeMedicine: { select: medicineSelect },
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.medicineAlternative.findMany({
        where: { alternativeMedicineId: medicineId },
        include: {
          sourceMedicine: { select: medicineSelect },
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    let doNotUse: PublicAlternativeGroup | null = null;
    if (sourceAlternatives.length > 0) {
      const first = sourceAlternatives[0];
      const last = sourceAlternatives[sourceAlternatives.length - 1];
      if (first && last) {
        doNotUse = {
          sourceMedicine: {
            id: first.sourceMedicine.id,
            name: first.sourceMedicine.name,
            form: first.sourceMedicine.form,
            packQuantity: Number(first.sourceMedicine.packQuantity),
            packUnit: first.sourceMedicine.packUnit,
            compositionText: first.sourceMedicine.composition.displayText,
            active: first.sourceMedicine.active,
          },
          alternatives: sourceAlternatives.map((item) => ({
            id: item.id,
            medicine: {
              id: item.alternativeMedicine.id,
              name: item.alternativeMedicine.name,
              form: item.alternativeMedicine.form,
              packQuantity: Number(item.alternativeMedicine.packQuantity),
              packUnit: item.alternativeMedicine.packUnit,
              compositionText: item.alternativeMedicine.composition.displayText,
              active: item.alternativeMedicine.active,
            },
            createdAt: item.createdAt.toISOString(),
          })),
          createdAt: first.createdAt.toISOString(),
          updatedAt: last.updatedAt.toISOString(),
        };
      }
    }

    const isAlternativeFor = targetAlternatives.map((item) => ({
      sourceMedicineId: item.sourceMedicine.id,
      sourceMedicineName: item.sourceMedicine.name,
      sourceForm: item.sourceMedicine.form,
      sourceCompositionText: item.sourceMedicine.composition.displayText,
    }));

    return { doNotUse, isAlternativeFor };
  }

  /**
   * Create approved alternatives for a source medicine (Admin only).
   */
  static async createAlternatives(
    userId: string,
    input: CreateMedicineAlternativeInput,
  ): Promise<PublicAlternativeGroup> {
    // 1. Verify source medicine exists and is active
    const sourceMedicine = await prisma.medicine.findUnique({
      where: { id: input.sourceMedicineId },
      select: medicineSelect,
    });
    if (!sourceMedicine || !sourceMedicine.active) {
      throw new AppError(404, 'NOT_FOUND', 'Source medicine not found or inactive');
    }

    // 2. Check if source medicine already has alternatives configured
    const existingCount = await prisma.medicineAlternative.count({
      where: { sourceMedicineId: input.sourceMedicineId },
    });
    if (existingCount > 0) {
      throw new AppError(
        409,
        'CONFLICT',
        'Approved alternatives already exist for this medicine. Please edit the existing entry.',
      );
    }

    // 3. Verify all alternative medicines exist and are active
    const altMedicines = await prisma.medicine.findMany({
      where: {
        id: { in: input.alternativeMedicineIds },
        active: true,
      },
      select: medicineSelect,
    });

    if (altMedicines.length !== input.alternativeMedicineIds.length) {
      throw new AppError(
        400,
        'BAD_REQUEST',
        'One or more selected alternative medicines could not be found or are inactive',
      );
    }

    // 4. Create in transaction
    const createdItems = await prisma.$transaction(async (tx) => {
      const items = [];
      for (const altId of input.alternativeMedicineIds) {
        const item = await tx.medicineAlternative.create({
          data: {
            sourceMedicineId: input.sourceMedicineId,
            alternativeMedicineId: altId,
            createdById: userId,
          },
          include: {
            sourceMedicine: { select: medicineSelect },
            alternativeMedicine: { select: medicineSelect },
          },
        });
        items.push(item);
      }
      return items;
    });

    // 5. Send exactly one notification to all active users
    const altNames = altMedicines.map((m) => m.name);
    try {
      await NotificationService.createForRole('ALL', {
        type: 'MEDICINE_ALTERNATIVE_CREATED',
        priority: 'UPDATE',
        title: 'Medicine Alternative Added',
        message: `Do Not Use: ${sourceMedicine.name} → Approved Alternative(s): ${altNames.join(', ')}`,
        entityType: 'MEDICINE_ALTERNATIVE',
        entityId: input.sourceMedicineId,
        metadata: {
          sourceMedicineId: input.sourceMedicineId,
          sourceMedicineName: sourceMedicine.name,
          alternativeMedicineIds: input.alternativeMedicineIds,
          alternativeMedicineNames: altNames,
        },
      });
    } catch {
      // Non-blocking notification error logging
    }

    const first = createdItems[0];
    if (!first) {
      throw new AppError(500, 'INTERNAL_SERVER_ERROR', 'Failed to create alternative items');
    }

    return {
      sourceMedicine: {
        id: first.sourceMedicine.id,
        name: first.sourceMedicine.name,
        form: first.sourceMedicine.form,
        packQuantity: Number(first.sourceMedicine.packQuantity),
        packUnit: first.sourceMedicine.packUnit,
        compositionText: first.sourceMedicine.composition.displayText,
        active: first.sourceMedicine.active,
      },
      alternatives: createdItems.map((item) => ({
        id: item.id,
        medicine: {
          id: item.alternativeMedicine.id,
          name: item.alternativeMedicine.name,
          form: item.alternativeMedicine.form,
          packQuantity: Number(item.alternativeMedicine.packQuantity),
          packUnit: item.alternativeMedicine.packUnit,
          compositionText: item.alternativeMedicine.composition.displayText,
          active: item.alternativeMedicine.active,
        },
        createdAt: item.createdAt.toISOString(),
      })),
      createdAt: first.createdAt.toISOString(),
      updatedAt: first.updatedAt.toISOString(),
    };
  }

  /**
   * Update approved alternatives for a source medicine (Admin only).
   */
  static async updateAlternatives(
    userId: string,
    sourceMedicineId: string,
    input: UpdateMedicineAlternativeInput,
  ): Promise<PublicAlternativeGroup> {
    // 1. Verify source medicine exists
    const sourceMedicine = await prisma.medicine.findUnique({
      where: { id: sourceMedicineId },
      select: medicineSelect,
    });
    if (!sourceMedicine || !sourceMedicine.active) {
      throw new AppError(404, 'NOT_FOUND', 'Source medicine not found or inactive');
    }

    if (input.alternativeMedicineIds.includes(sourceMedicineId)) {
      throw new AppError(400, 'BAD_REQUEST', 'A medicine cannot be an alternative to itself');
    }

    // 2. Check that alternatives currently exist for this source
    const existingCount = await prisma.medicineAlternative.count({
      where: { sourceMedicineId },
    });
    if (existingCount === 0) {
      throw new AppError(404, 'NOT_FOUND', 'No existing alternatives found for this medicine');
    }

    // 3. Verify all alternative medicines exist and are active
    const altMedicines = await prisma.medicine.findMany({
      where: {
        id: { in: input.alternativeMedicineIds },
        active: true,
      },
      select: medicineSelect,
    });

    if (altMedicines.length !== input.alternativeMedicineIds.length) {
      throw new AppError(
        400,
        'BAD_REQUEST',
        'One or more selected alternative medicines could not be found or are inactive',
      );
    }

    // 4. Update atomically in transaction
    const createdItems = await prisma.$transaction(async (tx) => {
      await tx.medicineAlternative.deleteMany({
        where: { sourceMedicineId },
      });

      const items = [];
      for (const altId of input.alternativeMedicineIds) {
        const item = await tx.medicineAlternative.create({
          data: {
            sourceMedicineId,
            alternativeMedicineId: altId,
            createdById: userId,
          },
          include: {
            sourceMedicine: { select: medicineSelect },
            alternativeMedicine: { select: medicineSelect },
          },
        });
        items.push(item);
      }
      return items;
    });

    // 5. Send notification
    const altNames = altMedicines.map((m) => m.name);
    try {
      await NotificationService.createForRole('ALL', {
        type: 'MEDICINE_ALTERNATIVE_UPDATED',
        priority: 'UPDATE',
        title: 'Medicine Alternative Updated',
        message: `Updated approved alternatives for ${sourceMedicine.name}: ${altNames.join(', ')}`,
        entityType: 'MEDICINE_ALTERNATIVE',
        entityId: sourceMedicineId,
        metadata: {
          sourceMedicineId,
          sourceMedicineName: sourceMedicine.name,
          alternativeMedicineIds: input.alternativeMedicineIds,
          alternativeMedicineNames: altNames,
        },
      });
    } catch {
      // Non-blocking
    }

    const first = createdItems[0];
    if (!first) {
      throw new AppError(500, 'INTERNAL_SERVER_ERROR', 'Failed to update alternative items');
    }

    return {
      sourceMedicine: {
        id: first.sourceMedicine.id,
        name: first.sourceMedicine.name,
        form: first.sourceMedicine.form,
        packQuantity: Number(first.sourceMedicine.packQuantity),
        packUnit: first.sourceMedicine.packUnit,
        compositionText: first.sourceMedicine.composition.displayText,
        active: first.sourceMedicine.active,
      },
      alternatives: createdItems.map((item) => ({
        id: item.id,
        medicine: {
          id: item.alternativeMedicine.id,
          name: item.alternativeMedicine.name,
          form: item.alternativeMedicine.form,
          packQuantity: Number(item.alternativeMedicine.packQuantity),
          packUnit: item.alternativeMedicine.packUnit,
          compositionText: item.alternativeMedicine.composition.displayText,
          active: item.alternativeMedicine.active,
        },
        createdAt: item.createdAt.toISOString(),
      })),
      createdAt: first.createdAt.toISOString(),
      updatedAt: first.updatedAt.toISOString(),
    };
  }

  /**
   * Delete all alternatives for a source medicine (Admin only).
   */
  static async deleteAlternatives(
    _userId: string,
    sourceMedicineId: string,
  ): Promise<{ success: boolean; message: string }> {
    const existing = await prisma.medicineAlternative.findFirst({
      where: { sourceMedicineId },
      include: {
        sourceMedicine: { select: { name: true } },
      },
    });

    if (!existing) {
      throw new AppError(404, 'NOT_FOUND', 'No alternatives found for this medicine');
    }

    const sourceMedicineName = existing.sourceMedicine.name;

    await prisma.medicineAlternative.deleteMany({
      where: { sourceMedicineId },
    });

    try {
      await NotificationService.createForRole('ALL', {
        type: 'MEDICINE_ALTERNATIVE_DELETED',
        priority: 'UPDATE',
        title: 'Medicine Alternative Removed',
        message: `Alternative recommendations removed for ${sourceMedicineName}`,
        entityType: 'MEDICINE_ALTERNATIVE',
        entityId: sourceMedicineId,
        metadata: {
          sourceMedicineId,
          sourceMedicineName,
        },
      });
    } catch {
      // Non-blocking
    }

    return { success: true, message: 'Medicine alternatives removed successfully' };
  }
}
