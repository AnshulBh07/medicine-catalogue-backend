import { z } from 'zod';

export const createMedicineAlternativeSchema = z
  .object({
    sourceMedicineId: z.string().uuid('Invalid source medicine ID'),
    alternativeMedicineIds: z
      .array(z.string().uuid('Invalid alternative medicine ID'))
      .min(1, 'At least one alternative medicine must be specified'),
  })
  .refine((data) => !data.alternativeMedicineIds.includes(data.sourceMedicineId), {
    message: 'A medicine cannot be an alternative to itself',
    path: ['alternativeMedicineIds'],
  })
  .refine((data) => new Set(data.alternativeMedicineIds).size === data.alternativeMedicineIds.length, {
    message: 'Duplicate alternative medicines are not allowed',
    path: ['alternativeMedicineIds'],
  });

export type CreateMedicineAlternativeInput = z.infer<typeof createMedicineAlternativeSchema>;

export const updateMedicineAlternativeSchema = z
  .object({
    alternativeMedicineIds: z
      .array(z.string().uuid('Invalid alternative medicine ID'))
      .min(1, 'At least one alternative medicine must be specified'),
  })
  .refine((data) => new Set(data.alternativeMedicineIds).size === data.alternativeMedicineIds.length, {
    message: 'Duplicate alternative medicines are not allowed',
    path: ['alternativeMedicineIds'],
  });

export type UpdateMedicineAlternativeInput = z.infer<typeof updateMedicineAlternativeSchema>;

export const listMedicineAlternativesQuerySchema = z.object({
  search: z.string().optional(),
  sourceMedicineId: z.string().uuid().optional(),
});

export type ListMedicineAlternativesQueryInput = z.infer<typeof listMedicineAlternativesQuerySchema>;

export const sourceMedicineIdParamSchema = z.object({
  sourceMedicineId: z.string().uuid('Invalid source medicine ID'),
});

export const medicineIdParamSchema = z.object({
  medicineId: z.string().uuid('Invalid medicine ID'),
});
