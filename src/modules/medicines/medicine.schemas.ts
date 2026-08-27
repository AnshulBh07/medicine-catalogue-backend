import { $Enums } from '@prisma/client/index';
import { z } from 'zod';

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const packQuantity = z.coerce.number().finite().positive().max(99999999.99);

const medicineFields = {
  name: z.string().trim().min(1).max(255),
  compositionId: z.string().uuid(),
  form: z.enum($Enums.MedicineForm),
  packQuantity,
  packUnit: z.enum($Enums.MedicinePackUnit),
  shortDescription: optionalText(100000),
  uses: optionalText(100000),
  recommendedAgeGroup: optionalText(100),
  directions: optionalText(100000),
  warnings: optionalText(100000),
  storageInstructions: optionalText(100000),
  barcode: z.string().trim().max(100).transform((val) => (val === '' ? null : val)).nullable().optional(),
  prescriptionRequired: z.boolean(),
  manufacturerId: z.string().uuid(),
  mrId: z.string().uuid().nullable().optional(),
};

export const createMedicineSchema = z.object(medicineFields).strict();

export const updateMedicineSchema = z
  .object({
    ...medicineFields,
    active: z.boolean().optional(),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });

export const medicineIdSchema = z.object({
  id: z.string().uuid(),
});

export const listMedicinesSchema = z.object({
  search: z.string().trim().optional(),
  form: z.enum($Enums.MedicineForm).optional(),
  manufacturerId: z.string().uuid().optional(),
  mrId: z.string().uuid().optional(),
  includeInactive: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
});

export type CreateMedicineInput = z.infer<typeof createMedicineSchema>;
export type UpdateMedicineInput = z.infer<typeof updateMedicineSchema>;
export type ListMedicinesInput = z.infer<typeof listMedicinesSchema>;
