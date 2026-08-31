import { z } from 'zod';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const shortageStatusSchema = z.enum(['PENDING', 'ORDERED', 'COMPLETED']);

export const shortageDateQuerySchema = z.object({
  date: z
    .string()
    .regex(DATE_REGEX, { message: 'Date must be in YYYY-MM-DD format' })
    .optional(),
  search: z.string().trim().optional(),
  status: shortageStatusSchema.optional(),
});

export const shortageIdParamsSchema = z.object({
  id: z.string().uuid({ message: 'Invalid shortage item ID' }),
});

export const createShortageItemSchema = z.object({
  medicineId: z.string().uuid({ message: 'Invalid medicine ID' }),
  date: z
    .string()
    .regex(DATE_REGEX, { message: 'Date must be in YYYY-MM-DD format' })
    .optional(),
  quantity: z
    .number({ message: 'Quantity must be a number' })
    .int({ message: 'Quantity must be an integer' })
    .positive({ message: 'Quantity must be greater than zero' }),
  note: z
    .string()
    .trim()
    .max(500, { message: 'Note must not exceed 500 characters' })
    .nullable()
    .optional(),
  status: shortageStatusSchema.default('PENDING').optional(),
});

export const patchShortageItemSchema = z.object({
  quantity: z
    .number({ message: 'Quantity must be a number' })
    .int({ message: 'Quantity must be an integer' })
    .positive({ message: 'Quantity must be greater than zero' })
    .optional(),
  status: shortageStatusSchema.optional(),
  note: z
    .string()
    .trim()
    .max(500, { message: 'Note must not exceed 500 characters' })
    .nullable()
    .optional(),
});

export type ShortageDateQuery = z.infer<typeof shortageDateQuerySchema>;
export type CreateShortageItemInput = z.infer<typeof createShortageItemSchema>;
export type PatchShortageItemInput = z.infer<typeof patchShortageItemSchema>;
