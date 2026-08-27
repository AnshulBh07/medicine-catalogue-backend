import { z } from 'zod';

const roleSchema = z.enum(['ADMIN', 'EMPLOYEE']);

export const createUserSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: z.string().trim().toLowerCase().email().max(255).optional().nullable(),
    phone: z.string().trim().min(7).max(20).optional().nullable(),
    password: z.string().min(8).max(128),
    role: roleSchema,
  })
  .refine((value) => (typeof value.email === 'string' && value.email.trim().length > 0)
    || (typeof value.phone === 'string' && value.phone.trim().length > 0), {
    message: 'Either email or phone is required',
    path: ['identifier'],
  });

export type CreateUserInput = z.infer<typeof createUserSchema>;
