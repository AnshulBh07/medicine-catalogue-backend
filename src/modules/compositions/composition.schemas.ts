import { z } from 'zod';

const compositionSaltUnitEnum = z.enum([
  'MG',
  'MCG',
  'G',
  'ML',
  'IU',
  'PERCENT',
  'OTHER',
]);

const saltItemInputSchema = z.object({
  saltId: z.string().uuid('Invalid salt ID').optional(),
  name: z
    .string()
    .trim()
    .min(1, 'Salt name cannot be empty')
    .max(255, 'Salt name cannot exceed 255 characters')
    .transform((v) => v.replace(/\s+/g, ' '))
    .optional(),
  amount: z.coerce.number().positive('Salt amount must be greater than zero'),
  unit: compositionSaltUnitEnum,
}).refine((item) => Boolean(item.saltId || item.name), {
  message: 'Each salt must provide either a saltId or a name',
});

const compositionSaltIdsSchema = z
  .array(z.string().uuid())
  .min(1, 'At least one composition salt ID must be provided')
  .superRefine((ids, context) => {
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: 'custom',
        message: 'CompositionSalt IDs must be unique',
      });
    }
  });

export const createCompositionSchema = z
  .object({
    displayText: z.string().trim().min(1).max(2000).optional(),
    description: z.string().trim().nullable().optional(),
    compositionSaltIds: compositionSaltIdsSchema.optional(),
    salts: z.array(saltItemInputSchema).min(1, 'At least one salt must be provided').optional(),
  })
  .strict()
  .refine((data) => Boolean(data.compositionSaltIds?.length || data.salts?.length), {
    message: 'Either salts or compositionSaltIds must be provided',
  });

export const updateCompositionSchema = z
  .object({
    displayText: z.string().trim().min(1).max(2000).optional(),
    description: z.string().trim().nullable().optional(),
    active: z.boolean().optional(),
    compositionSaltIds: compositionSaltIdsSchema.optional(),
    salts: z.array(saltItemInputSchema).min(1).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided for update',
  });

export const compositionIdSchema = z.object({
  id: z.string().uuid('Invalid composition ID'),
});

export const listCompositionsSchema = z.object({
  search: z.string().trim().optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export type SaltItemInput = z.infer<typeof saltItemInputSchema>;
export type CreateCompositionInput = z.infer<typeof createCompositionSchema>;
export type UpdateCompositionInput = z.infer<typeof updateCompositionSchema>;
export type ListCompositionsInput = z.infer<typeof listCompositionsSchema>;
