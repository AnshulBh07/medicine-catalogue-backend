import { z } from 'zod';

const displayTextSchema = z.string().trim().min(1).max(2000);
const compositionSaltIdsSchema = z
  .array(z.string().uuid())
  .min(1)
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
    displayText: displayTextSchema,
    description: z.string().trim().nullable().optional(),
    compositionSaltIds: compositionSaltIdsSchema,
  })
  .strict();

export const updateCompositionSchema = z
  .object({
    displayText: displayTextSchema.optional(),
    description: z.string().trim().nullable().optional(),
    active: z.boolean().optional(),
    compositionSaltIds: compositionSaltIdsSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });

export const compositionIdSchema = z.object({
  id: z.string().uuid(),
});

export const listCompositionsSchema = z.object({
  includeInactive: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
});

export type CreateCompositionInput = z.infer<typeof createCompositionSchema>;
export type UpdateCompositionInput = z.infer<typeof updateCompositionSchema>;
export type ListCompositionsInput = z.infer<typeof listCompositionsSchema>;
