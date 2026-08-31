import { z } from 'zod';

const attendanceStatusSchema = z.enum(['PRESENT', 'ABSENT', 'HALF_DAY', 'LEAVE']);

export const attendanceIdSchema = z.object({
  id: z.string().uuid(),
});

export const userAttendanceParamsSchema = z.object({
  userId: z.string().uuid(),
});

export const attendanceMonthQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
});

export const createOrUpdateAttendanceSchema = z.object({
  userId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  status: attendanceStatusSchema,
  notes: z.string().trim().max(500).optional().nullable(),
});

export const patchAttendanceSchema = z.object({
  status: attendanceStatusSchema.optional(),
  notes: z.string().trim().max(500).optional().nullable(),
});

export const deleteAttendanceQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional(),
});

export type AttendanceStatusType = z.infer<typeof attendanceStatusSchema>;
export type CreateOrUpdateAttendanceInput = z.infer<typeof createOrUpdateAttendanceSchema>;
export type PatchAttendanceInput = z.infer<typeof patchAttendanceSchema>;
export type AttendanceMonthQueryInput = z.infer<typeof attendanceMonthQuerySchema>;
