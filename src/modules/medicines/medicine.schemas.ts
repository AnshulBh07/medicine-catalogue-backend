import { $Enums } from '@prisma/client/index';
import { z } from 'zod';

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const optionalUrl = (max = 2048) => z.string().trim().url().max(max).nullable().optional();
const packQuantity = z.coerce.number().finite().positive().max(99999999.99);

const hasMaxTwoDecimals = (value: number): boolean => {
  const str = value.toString();
  if (str.includes('e') || str.includes('E')) {
    return Number(value.toFixed(2)) === value;
  }
  const parts = str.split('.');
  return parts.length <= 1 || (parts[1] !== undefined && parts[1].length <= 2);
};

const money = z.coerce.number()
  .finite()
  .nonnegative()
  .max(9999999999.99)
  .refine(hasMaxTwoDecimals, {
    message: 'Value must have at most 2 decimal places',
  });

const discountPercent = z.coerce.number()
  .finite()
  .min(0)
  .max(100)
  .refine(hasMaxTwoDecimals, {
    message: 'Discount percent must have at most 2 decimal places',
  });

const gstPercent = z.coerce.number()
  .finite()
  .min(0)
  .max(100)
  .refine(hasMaxTwoDecimals, {
    message: 'GST percent must have at most 2 decimal places',
  });

const jsonValue: z.ZodType<unknown> = z.lazy(() => z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.array(jsonValue),
  z.record(z.string(), jsonValue),
]));

const hasMaxThreeDecimals = (value: number): boolean => {
  const str = value.toString();
  if (str.includes('e') || str.includes('E')) {
    return Number(value.toFixed(3)) === value;
  }
  const parts = str.split('.');
  return parts.length <= 1 || (parts[1] !== undefined && parts[1].length <= 3);
};

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must use YYYY-MM-DD format')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year!, month! - 1, day!));
    return date.getUTCFullYear() === year
      && date.getUTCMonth() === month! - 1
      && date.getUTCDate() === day;
  }, 'Date is invalid')
  .transform((value) => new Date(`${value}T00:00:00.000Z`));

const validateDateOrder = <T extends { manufacturingDate?: Date | null; expiryDate?: Date }>(
  value: T,
  context: z.RefinementCtx,
): void => {
  if (value.manufacturingDate && value.expiryDate && value.expiryDate <= value.manufacturingDate) {
    context.addIssue({
      code: 'custom',
      path: ['expiryDate'],
      message: 'Expiry date must be after manufacturing date',
    });
  }
};

export const saltInputSchema = z
  .object({
    saltId: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(255).optional(),
    saltName: z.string().trim().min(1).max(255).optional(),
    amount: z.coerce.number()
      .finite()
      .positive()
      .max(9999999.999)
      .refine(hasMaxThreeDecimals, {
        message: 'Strength amount must have at most 3 decimal places',
      }),
    unit: z.enum($Enums.CompositionSaltUnit),
  })
  .strict()
  .refine((data) => Boolean(data.saltId || data.name || data.saltName), {
    message: 'Either saltId, name, or saltName must be provided',
  });

export const commercialDetailsNestedSchema = z.object({
  purchaseRate: money.optional().default(0),
  mrp: money,
  discountPercent: discountPercent.optional().default(0),
  gstPercent: gstPercent.optional().default(0),
  scheme: jsonValue.nullable().optional(),
  privateNotes: optionalText(100000),
}).strict();

export const firstBatchNestedSchema = z.object({
  batchNumber: z.string().trim().min(1).max(100),
  manufacturingDate: dateOnly.nullable().optional(),
  expiryDate: dateOnly,
  purchaseRate: money.optional().default(0),
  mrp: money.optional(),
  discountPercent: discountPercent.optional().default(0),
  gstPercent: gstPercent.optional().default(0),
  scheme: jsonValue.nullable().optional(),
  privateNotes: optionalText(100000),
  commercialDetails: commercialDetailsNestedSchema.optional(),
}).strict().superRefine(validateDateOrder);

const validateDuplicateSalts = (
  salts: Array<z.infer<typeof saltInputSchema>> | undefined,
  context: z.RefinementCtx,
  pathPrefix: 'salts' | 'compositionSalts',
) => {
  if (!salts || salts.length <= 1) return;
  const seenNames = new Set<string>();
  const seenIds = new Set<string>();
  for (let i = 0; i < salts.length; i++) {
    const s = salts[i];
    if (!s) continue;
    const rawName = (s.name || s.saltName)?.trim().toLowerCase();
    if (rawName) {
      if (seenNames.has(rawName)) {
        context.addIssue({
          code: 'custom',
          path: [pathPrefix, i, s.name ? 'name' : 'saltName'],
          message: `Duplicate salt '${s.name || s.saltName}' provided. Each salt in the composition must be unique`,
        });
      }
      seenNames.add(rawName);
    }
    if (s.saltId) {
      if (seenIds.has(s.saltId)) {
        context.addIssue({
          code: 'custom',
          path: [pathPrefix, i, 'saltId'],
          message: `Duplicate salt ID '${s.saltId}' provided. Each salt in the composition must be unique`,
        });
      }
      seenIds.add(s.saltId);
    }
  }
};

const medicineFields = {
  name: z.string().trim().min(1).max(255),
  form: z.enum($Enums.MedicineForm),
  packQuantity,
  packUnit: z.enum($Enums.MedicinePackUnit),
  shortDescription: optionalText(100000),
  imageUrl: optionalUrl(2048),
  uses: optionalText(100000),
  recommendedAgeGroup: optionalText(100),
  directions: optionalText(100000),
  warnings: optionalText(100000),
  storageInstructions: optionalText(100000),
  barcode: z.string().trim().max(100).transform((val) => (val === '' ? null : val)).nullable().optional(),
  prescriptionRequired: z.boolean(),
  manufacturerId: z.string().uuid().optional(),
  manufacturerName: z.string().trim().min(1).max(255).optional(),
  mrId: z.string().uuid().nullable().optional(),
};

export const createMedicineSchema = z
  .object({
    ...medicineFields,
    compositionId: z.string().uuid().optional(),
    salts: z.array(saltInputSchema).min(1).optional(),
    compositionSalts: z.array(saltInputSchema).min(1).optional(),
    firstBatch: firstBatchNestedSchema.optional(),
    batchNumber: z.string().trim().min(1).max(100).optional(),
    manufacturingDate: dateOnly.nullable().optional(),
    expiryDate: dateOnly.optional(),
    commercialDetails: commercialDetailsNestedSchema.optional(),
    purchaseRate: money.optional(),
    mrp: money.optional(),
    discountPercent: discountPercent.optional(),
    gstPercent: gstPercent.optional(),
    scheme: jsonValue.nullable().optional(),
    privateNotes: optionalText(100000),
  })
  .strict()
  .superRefine((data, context) => {
    const hasCompositionId = Boolean(data.compositionId);
    const hasSalts =
      (data.salts && data.salts.length > 0) ||
      (data.compositionSalts && data.compositionSalts.length > 0);
    if (!hasCompositionId && !hasSalts) {
      context.addIssue({
        code: 'custom',
        path: ['compositionId'],
        message: 'Either compositionId or a non-empty list of salts must be provided',
      });
    }

    if (!data.manufacturerId && !data.manufacturerName) {
      context.addIssue({
        code: 'custom',
        path: ['manufacturerId'],
        message: 'Either manufacturerId or manufacturerName must be provided',
      });
    }

    if (data.manufacturingDate && data.expiryDate) {
      validateDateOrder(data as { manufacturingDate: Date; expiryDate: Date }, context);
    }

    if (data.salts) validateDuplicateSalts(data.salts, context, 'salts');
    if (data.compositionSalts) validateDuplicateSalts(data.compositionSalts, context, 'compositionSalts');
  });

export const updateMedicineSchema = z
  .object({
    ...medicineFields,
    compositionId: z.string().uuid().optional(),
    salts: z.array(saltInputSchema).min(1).optional(),
    compositionSalts: z.array(saltInputSchema).min(1).optional(),
    commercialDetails: commercialDetailsNestedSchema.optional(),
    purchaseRate: money.optional(),
    mrp: money.optional(),
    discountPercent: discountPercent.optional(),
    gstPercent: gstPercent.optional(),
    scheme: jsonValue.nullable().optional(),
    privateNotes: optionalText(100000),
    active: z.boolean().optional(),
  })
  .partial()
  .strict()
  .superRefine((data, context) => {
    if (Object.keys(data).length === 0) {
      context.addIssue({
        code: 'custom',
        message: 'At least one field must be provided',
      });
    }
    if (data.salts) validateDuplicateSalts(data.salts, context, 'salts');
    if (data.compositionSalts) validateDuplicateSalts(data.compositionSalts, context, 'compositionSalts');
  });

export const medicineIdSchema = z.object({
  id: z.string().uuid(),
});

export const medicineSortFieldSchema = z.enum([
  'name',
  'mrp',
  'packQuantity',
  'createdAt',
  'updatedAt',
]);

export const sortOrderSchema = z.enum(['asc', 'desc']);

export const listMedicinesSchema = z.object({
  search: z.string().trim().optional(),
  form: z.enum($Enums.MedicineForm).optional(),
  manufacturerId: z.string().uuid().optional(),
  mrId: z.string().uuid().optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  minMrp: z.coerce.number().min(0).optional(),
  maxMrp: z.coerce.number().min(0).optional(),
  sortBy: medicineSortFieldSchema.default('name').optional(),
  sortOrder: sortOrderSchema.default('asc').optional(),
  includeInactive: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
});

export type MedicineSortField = z.infer<typeof medicineSortFieldSchema>;
export type SortOrder = z.infer<typeof sortOrderSchema>;
export type CreateMedicineInput = z.infer<typeof createMedicineSchema>;
export type UpdateMedicineInput = z.infer<typeof updateMedicineSchema>;
export type ListMedicinesInput = z.infer<typeof listMedicinesSchema>;
