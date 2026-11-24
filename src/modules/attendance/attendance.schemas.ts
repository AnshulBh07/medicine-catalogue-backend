import { z } from 'zod';
import { isValidCalendarDateString } from '../../common/date.utils.js';

const attendanceStatusSchema = z.enum(['PRESENT', 'ABSENT', 'HALF_DAY', 'LEAVE']);
const validDateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .refine(isValidCalendarDateString, 'Date must be a valid calendar date');

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
  date: validDateString,
  status: attendanceStatusSchema,
  workUnits: z.coerce.number().min(0).max(10).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

export const patchAttendanceSchema = z.object({
  status: attendanceStatusSchema.optional(),
  workUnits: z.coerce.number().min(0).max(10).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

export const deleteAttendanceQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  date: validDateString.optional(),
});

export type AttendanceStatusType = z.infer<typeof attendanceStatusSchema>;
export type CreateOrUpdateAttendanceInput = z.infer<typeof createOrUpdateAttendanceSchema>;
export type PatchAttendanceInput = z.infer<typeof patchAttendanceSchema>;
export type AttendanceMonthQueryInput = z.infer<typeof attendanceMonthQuerySchema>;
