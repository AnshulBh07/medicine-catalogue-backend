import { z } from 'zod';

const roleSchema = z.enum(['ADMIN', 'EMPLOYEE']);

export const userIdSchema = z.object({
  id: z.string().uuid(),
});

export const listUsersSchema = z.object({
  search: z.string().trim().optional(),
  role: roleSchema.optional(),
  active: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((val) => (typeof val === 'boolean' ? val : val === 'true'))
    .optional(),
  page: z.coerce.number().int().positive().default(1).optional(),
  limit: z.coerce.number().int().positive().max(100).default(50).optional(),
  sortBy: z.enum(['name', 'email', 'role', 'createdAt', 'updatedAt', 'monthlySalary']).default('name').optional(),
  sortOrder: z.enum(['asc', 'desc']).default('asc').optional(),
});

export const createUserSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: z.string().trim().toLowerCase().email().max(255).optional().nullable(),
    phone: z.string().trim().min(7).max(20).optional().nullable(),
    password: z.string().min(8).max(128),
    role: roleSchema,
    monthlySalary: z.coerce.number().min(0).max(10000000).optional().nullable(),
  })
  .refine((value) => (typeof value.email === 'string' && value.email.trim().length > 0)
    || (typeof value.phone === 'string' && value.phone.trim().length > 0), {
    message: 'Either email or phone is required',
    path: ['identifier'],
  });

export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    email: z.string().trim().toLowerCase().email().max(255).optional().nullable(),
    phone: z.string().trim().min(7).max(20).optional().nullable(),
    profileImageUrl: z.string().trim().max(2048).optional().nullable(),
  })
  .strict();

export const updateUserSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    email: z.string().trim().toLowerCase().email().max(255).optional().nullable(),
    phone: z.string().trim().min(7).max(20).optional().nullable(),
    role: roleSchema.optional(),
    active: z.boolean().optional(),
    password: z.string().min(8).max(128).optional(),
    monthlySalary: z.coerce.number().min(0).max(10000000).optional().nullable(),
  })
  .strict();

export const updateUserStatusSchema = z
  .object({
    active: z.boolean(),
  })
  .strict();

export const updateUserRoleSchema = z
  .object({
    role: roleSchema,
  })
  .strict();

export type ListUsersInput = z.infer<typeof listUsersSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type UpdateUserStatusInput = z.infer<typeof updateUserStatusSchema>;
export type UpdateUserRoleInput = z.infer<typeof updateUserRoleSchema>;
