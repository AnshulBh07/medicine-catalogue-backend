import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware.js';
import { requireRole } from '../../middleware/role.middleware.js';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.middleware.js';
import {
  createOrUpdateAttendanceController,
  deleteAttendanceController,
  getAttendanceSummaryController,
  getEmployeeAttendanceController,
  patchAttendanceController,
} from './attendance.controller.js';
import {
  attendanceIdSchema,
  attendanceMonthQuerySchema,
  createOrUpdateAttendanceSchema,
  deleteAttendanceQuerySchema,
  patchAttendanceSchema,
  userAttendanceParamsSchema,
} from './attendance.schemas.js';

export const attendanceRouter = Router();

// All attendance routes require authentication and ADMIN role
attendanceRouter.use(authenticate);
attendanceRouter.use(requireRole('ADMIN'));

attendanceRouter.get(
  '/summary',
  validateQuery(attendanceMonthQuerySchema),
  getAttendanceSummaryController,
);

attendanceRouter.get(
  '/users/:userId',
  validateParams(userAttendanceParamsSchema),
  validateQuery(attendanceMonthQuerySchema),
  getEmployeeAttendanceController,
);

attendanceRouter.post(
  '/',
  validateBody(createOrUpdateAttendanceSchema),
  createOrUpdateAttendanceController,
);

attendanceRouter.patch(
  '/:id',
  validateParams(attendanceIdSchema),
  validateBody(patchAttendanceSchema),
  patchAttendanceController,
);

attendanceRouter.delete(
  '/:id',
  validateParams(attendanceIdSchema),
  deleteAttendanceController,
);

attendanceRouter.delete(
  '/',
  validateQuery(deleteAttendanceQuerySchema),
  deleteAttendanceController,
);
