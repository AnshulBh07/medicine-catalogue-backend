import { z } from 'zod';

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const mrSortFields = ['name', 'company', 'createdAt', 'updatedAt'] as const;
export type MrSortField = (typeof mrSortFields)[number];

export const sortOrders = ['asc', 'desc'] as const;
export type SortOrder = (typeof sortOrders)[number];

const mrFields = {
  name: z.string().trim().min(1, 'Name is required').max(150),
  company: z.string().trim().max(255).nullable().optional(),
  phone: z.string().trim().min(7, 'Phone number must be at least 7 digits').max(20).nullable().optional(),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Invalid email address')
    .max(255)
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
  notes: optionalText(100000),
};

export const createMrSchema = z
  .object({
    ...mrFields,
    medicineIds: z.array(z.string().uuid()).optional(),
    allowReassign: z.boolean().optional().default(false),
  })
  .strict();

export const updateMrSchema = z
  .object({
    ...mrFields,
    active: z.boolean().optional(),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });

export const mrIdSchema = z.object({
  id: z.string().uuid(),
});

export const listMrsSchema = z.object({
  search: z.string().trim().optional(),
  company: z.string().trim().optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  sortBy: z.enum(mrSortFields).default('name'),
  sortOrder: z.enum(sortOrders).default('asc'),
  page: z.coerce.number().int().min(1).default(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
});

export const assignMrMedicinesSchema = z
  .object({
    medicineIds: z.array(z.string().uuid()),
    allowReassign: z.boolean().optional().default(false),
  })
  .strict();

export type CreateMrInput = z.infer<typeof createMrSchema>;
export type UpdateMrInput = z.infer<typeof updateMrSchema>;
export type ListMrsInput = z.infer<typeof listMrsSchema>;
export type AssignMrMedicinesInput = z.infer<typeof assignMrMedicinesSchema>;
