import { z } from 'zod';

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Salt name cannot be empty')
  .max(255, 'Salt name cannot exceed 255 characters')
  .transform((val) => val.replace(/\s+/g, ' '));

export const createSaltSchema = z
  .object({
    name: nameSchema,
    description: z.string().trim().nullable().optional(),
  })
  .strict();

export const updateSaltSchema = z
  .object({
    name: nameSchema.optional(),
    description: z.string().trim().nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided for update',
  });

export const saltIdSchema = z.object({
  id: z.string().uuid('Invalid salt ID'),
});

export const listSaltsSchema = z.object({
  search: z.string().trim().optional(),
  active: z.enum(['active', 'inactive', 'all']).default('active'),
});

export type CreateSaltInput = z.infer<typeof createSaltSchema>;
export type UpdateSaltInput = z.infer<typeof updateSaltSchema>;
export type ListSaltsInput = z.infer<typeof listSaltsSchema>;
