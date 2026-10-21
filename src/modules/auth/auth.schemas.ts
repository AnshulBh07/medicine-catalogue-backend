import { z } from 'zod';

export const loginSchema = z.object({
  identifier: z.string().trim().min(1).max(255),
  password: z.string().min(1).max(128),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().trim().min(1, 'Refresh token is required'),
});

export type RefreshInput = z.infer<typeof refreshSchema>;
