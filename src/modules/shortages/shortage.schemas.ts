import { z } from 'zod';
import { isValidCalendarDateString } from '../../common/date.utils.js';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const INT4_MAX = 2147483647;

const validDateString = z
  .string()
  .regex(DATE_REGEX, { message: 'Date must be in YYYY-MM-DD format' })
  .refine(isValidCalendarDateString, { message: 'Date must be a valid calendar date' });

export const shortageStatusSchema = z.enum(['PENDING', 'ORDERED', 'COMPLETED']);
export const shortageUnitSchema = z.enum(['PACK', 'STRIP', 'BOX', 'PIECE', 'BOTTLE', 'CRATE']);

export const shortageDateQuerySchema = z.object({
  date: validDateString.optional(),
  search: z.string().trim().optional(),
  status: shortageStatusSchema.optional(),
});

export const shortageIdParamsSchema = z.object({
  id: z.string().uuid({ message: 'Invalid shortage item ID' }),
});

export const createShortageItemSchema = z.object({
  medicineId: z.string().uuid({ message: 'Invalid medicine ID' }),
  date: validDateString.optional(),
  quantity: z
    .number({ message: 'Quantity must be a number' })
    .finite({ message: 'Quantity must be a finite number' })
    .int({ message: 'Quantity must be an integer' })
    .positive({ message: 'Quantity must be greater than zero' })
    .max(INT4_MAX, { message: 'Quantity exceeds maximum allowed value' }),
  currentQuantity: z
    .number({ message: 'Current quantity must be a number' })
    .finite({ message: 'Current quantity must be a finite number' })
    .int({ message: 'Current quantity must be an integer' })
    .min(0, { message: 'Current quantity must be zero or greater' })
    .max(INT4_MAX, { message: 'Current quantity exceeds maximum allowed value' })
    .nullable()
    .optional(),
  unit: shortageUnitSchema.default('PACK').optional(),
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
    .finite({ message: 'Quantity must be a finite number' })
    .int({ message: 'Quantity must be an integer' })
    .positive({ message: 'Quantity must be greater than zero' })
    .max(INT4_MAX, { message: 'Quantity exceeds maximum allowed value' })
    .optional(),
  currentQuantity: z
    .number({ message: 'Current quantity must be a number' })
    .finite({ message: 'Current quantity must be a finite number' })
    .int({ message: 'Current quantity must be an integer' })
    .min(0, { message: 'Current quantity must be zero or greater' })
    .max(INT4_MAX, { message: 'Current quantity exceeds maximum allowed value' })
    .nullable()
    .optional(),
  unit: shortageUnitSchema.optional(),
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

