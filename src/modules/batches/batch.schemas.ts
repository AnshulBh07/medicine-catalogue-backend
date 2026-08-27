import { z } from 'zod';

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

const batchNumber = z.string().trim().min(1).max(100);

const validateDateOrder = <T extends { manufacturingDate?: Date | null; expiryDate: Date }>(
  value: T,
  context: z.RefinementCtx,
): void => {
  if (value.manufacturingDate && value.expiryDate <= value.manufacturingDate) {
    context.addIssue({
      code: 'custom',
      path: ['expiryDate'],
      message: 'Expiry date must be after manufacturing date',
    });
  }
};

export const createBatchSchema = z
  .object({
    medicineId: z.string().uuid(),
    batchNumber,
    manufacturingDate: dateOnly.nullable().optional(),
    expiryDate: dateOnly,
  })
  .strict()
  .superRefine(validateDateOrder);

export const updateBatchSchema = z
  .object({
    batchNumber: batchNumber.optional(),
    manufacturingDate: dateOnly.nullable().optional(),
    expiryDate: dateOnly.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  })
  .superRefine((value, context) => {
    if (value.manufacturingDate && value.expiryDate) {
      validateDateOrder(value as { manufacturingDate: Date; expiryDate: Date }, context);
    }
  });

export const batchIdSchema = z.object({
  id: z.string().uuid(),
});

export const listBatchesSchema = z.object({
  medicineId: z.string().uuid().optional(),
  expiryBefore: dateOnly.optional(),
  expiryAfter: dateOnly.optional(),
  includeInactive: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
});

export type CreateBatchInput = z.infer<typeof createBatchSchema>;
export type UpdateBatchInput = z.infer<typeof updateBatchSchema>;
export type ListBatchesInput = z.infer<typeof listBatchesSchema>;
