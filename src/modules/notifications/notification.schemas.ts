import { z } from 'zod';

export const listNotificationsQuerySchema = z.object({
  page: z
    .union([z.string(), z.number()])
    .optional()
    .transform((val) => {
      if (val === undefined || val === null || val === '') return 1;
      const num = Number(val);
      return isNaN(num) || num < 1 ? 1 : Math.floor(num);
    }),
  limit: z
    .union([z.string(), z.number()])
    .optional()
    .transform((val) => {
      if (val === undefined || val === null || val === '') return 20;
      const num = Number(val);
      if (isNaN(num) || num < 1) return 20;
      return Math.min(100, Math.floor(num));
    }),
  filter: z.enum(['all', 'unread', 'critical', 'updates']).optional().default('all'),
});

export type ListNotificationsQueryInput = z.infer<typeof listNotificationsQuerySchema>;

export const notificationIdParamSchema = z.object({
  id: z.string().uuid('Invalid notification ID format'),
});
