import { z } from 'zod';

const compositionSaltUnitSchema = z.enum(['MG', 'MCG', 'G', 'ML', 'IU', 'PERCENT', 'OTHER']);

const amountSchema = z.coerce.number().finite().positive().max(9999999.999);

export const createCompositionSaltSchema = z
  .object({
    saltId: z.string().uuid(),
    amount: amountSchema,
    unit: compositionSaltUnitSchema,
  })
  .strict();

export const updateCompositionSaltSchema = z
  .object({
    saltId: z.string().uuid().optional(),
    amount: amountSchema.optional(),
    unit: compositionSaltUnitSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });

export const compositionSaltIdSchema = z.object({
  id: z.string().uuid(),
});

export const listCompositionSaltsSchema = z.object({
  includeInactive: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
});

export type CreateCompositionSaltInput = z.infer<typeof createCompositionSaltSchema>;
export type UpdateCompositionSaltInput = z.infer<typeof updateCompositionSaltSchema>;
export type ListCompositionSaltsInput = z.infer<typeof listCompositionSaltsSchema>;
