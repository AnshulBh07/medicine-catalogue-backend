import { Prisma } from '@prisma/client/index';
import { z } from 'zod';

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

const jsonValue: z.ZodType<Prisma.InputJsonValue> = z.lazy(() => z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.array(jsonValue),
  z.record(z.string(), jsonValue),
]));

export const commercialDetailsMedicineIdSchema = z.object({
  medicineId: z.string().uuid(),
});

export const commercialDetailsBatchIdSchema = z.object({
  batchId: z.string().uuid(),
});

const commercialDetailsFields = {
  purchaseRate: money,
  mrp: money,
  discountPercent,
  scheme: jsonValue.nullable().optional(),
  privateNotes: z.string().trim().nullable().optional(),
};

export const createCommercialDetailsSchema = z.object(commercialDetailsFields).strict();

export const updateCommercialDetailsSchema = z
  .object(commercialDetailsFields)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });

export type CreateCommercialDetailsInput = z.infer<typeof createCommercialDetailsSchema>;
export type UpdateCommercialDetailsInput = z.infer<typeof updateCommercialDetailsSchema>;
