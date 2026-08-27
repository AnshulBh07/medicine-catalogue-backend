import { z } from 'zod';

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

const mrFields = {
  name: z.string().trim().min(1).max(150),
  company: z.string().trim().max(255).nullable().optional(),
  phone: z.string().trim().min(7).max(20).nullable().optional(),
  email: z.string().trim().toLowerCase().email().max(255).nullable().optional(),
  notes: optionalText(100000),
};

export const createMrSchema = z.object(mrFields).strict();

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
  includeInactive: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
});

export type CreateMrInput = z.infer<typeof createMrSchema>;
export type UpdateMrInput = z.infer<typeof updateMrSchema>;
export type ListMrsInput = z.infer<typeof listMrsSchema>;
