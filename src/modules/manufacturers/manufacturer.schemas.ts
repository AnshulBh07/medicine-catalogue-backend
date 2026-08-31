import { z } from 'zod';

const manufacturerFields = {
  name: z.string().trim().min(1).max(255),
};

export const createManufacturerSchema = z.object(manufacturerFields).strict();

export const updateManufacturerSchema = z
  .object({
    ...manufacturerFields,
    active: z.boolean().optional(),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });

export const manufacturerIdSchema = z.object({
  id: z.string().uuid(),
});

export const listManufacturersSchema = z.object({
  search: z.string().trim().optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true')
    .optional(),
  active: z.enum(['active', 'inactive', 'all']).optional(),
  hasMedicines: z.enum(['true', 'false', 'all']).optional(),
  sortBy: z
    .enum(['name_asc', 'name_desc', 'newest', 'oldest', 'medicines_high', 'medicines_low'])
    .optional(),
});

export type CreateManufacturerInput = z.infer<typeof createManufacturerSchema>;
export type UpdateManufacturerInput = z.infer<typeof updateManufacturerSchema>;
export type ListManufacturersInput = z.infer<typeof listManufacturersSchema>;
