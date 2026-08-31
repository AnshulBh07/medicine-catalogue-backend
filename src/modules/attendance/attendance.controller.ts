import type { RequestHandler } from 'express';
import {
  createOrUpdateAttendance,
  deleteAttendance,
  getEmployeeMonthlyAttendance,
  getMonthlyAttendanceSummary,
  patchAttendance,
} from './attendance.service.js';
import type {
  AttendanceMonthQueryInput,
  CreateOrUpdateAttendanceInput,
  PatchAttendanceInput,
} from './attendance.schemas.js';

export const getAttendanceSummaryController: RequestHandler = async (request, response) => {
  const query = request.query as unknown as AttendanceMonthQueryInput;
  const result = await getMonthlyAttendanceSummary(query);
  response.status(200).json(result);
};

export const getEmployeeAttendanceController: RequestHandler = async (request, response) => {
  const userId = request.params.userId as string;
  const query = request.query as unknown as AttendanceMonthQueryInput;
  const result = await getEmployeeMonthlyAttendance(userId, query);
  response.status(200).json(result);
};

export const createOrUpdateAttendanceController: RequestHandler = async (request, response) => {
  const input = request.body as CreateOrUpdateAttendanceInput;
  const result = await createOrUpdateAttendance(input);
  response.status(200).json(result);
};

export const patchAttendanceController: RequestHandler = async (request, response) => {
  const id = request.params.id as string;
  const input = request.body as PatchAttendanceInput;
  const result = await patchAttendance(id, input);
  response.status(200).json(result);
};

export const deleteAttendanceController: RequestHandler = async (request, response) => {
  const id = request.params.id as string | undefined;
  const userId = request.query.userId as string | undefined;
  const date = request.query.date as string | undefined;

  const result = await deleteAttendance({ id, userId, date });
  response.status(200).json(result);
};
