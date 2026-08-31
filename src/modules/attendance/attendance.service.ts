import { Prisma, type AttendanceRecord, type AttendanceStatus, type User } from '@prisma/client/index';
import { AppError } from '../../common/errors/app-error.js';
import { prisma } from '../../lib/prisma.js';
import { toPublicUser, type PublicUser } from '../users/user.service.js';
import type {
  AttendanceMonthQueryInput,
  CreateOrUpdateAttendanceInput,
  PatchAttendanceInput,
} from './attendance.schemas.js';
import {
  calculateSalary,
  formatDateToISO,
  getMonthDateRange,
  getWorkingDaysInMonth,
  isWorkingDay,
  parseDateStringToUTC,
} from './attendance.utils.js';

export interface EmployeeMonthlySummary {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  profileImageUrl: string | null;
  monthlySalary: number | null;
  workingDays: number;
  presentDays: number;
  absentDays: number;
  halfDays: number;
  leaveDays: number;
  payableDays: number;
  attendancePercentage: number;
  estimatedSalary: number;
}

export interface AttendanceDashboardSummary {
  year: number;
  month: number;
  totalEmployees: number;
  workingDays: number;
  today: {
    date: string;
    present: number;
    absent: number;
    halfDay: number;
    leave: number;
    late: number;
  };
  overall: {
    totalWorkingDays: number;
    presentDays: number;
    absentDays: number;
    halfDays: number;
    leaveDays: number;
    payableDays: number;
    attendancePercentage: number;
    payablePercentage: number;
    totalEstimatedPayroll: number;
  };
  employees: EmployeeMonthlySummary[];
}

export interface SerializedAttendanceRecord {
  id: string;
  userId: string;
  date: string;
  status: AttendanceStatus;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EmployeeAttendanceDetailResult {
  user: PublicUser;
  year: number;
  month: number;
  workingDays: number;
  presentDays: number;
  absentDays: number;
  halfDays: number;
  leaveDays: number;
  payableDays: number;
  attendancePercentage: number;
  dailySalary: number;
  estimatedSalary: number;
  records: SerializedAttendanceRecord[];
}

export interface AttendanceStore {
  user: {
    findUnique(args: Prisma.UserFindUniqueArgs): PromiseLike<User | null>;
    findMany(args: Prisma.UserFindManyArgs): PromiseLike<User[]>;
  };
  attendanceRecord: {
    findUnique(args: Prisma.AttendanceRecordFindUniqueArgs): PromiseLike<AttendanceRecord | null>;
    findMany(args: Prisma.AttendanceRecordFindManyArgs): PromiseLike<AttendanceRecord[]>;
    create(args: Prisma.AttendanceRecordCreateArgs): PromiseLike<AttendanceRecord>;
    update(args: Prisma.AttendanceRecordUpdateArgs): PromiseLike<AttendanceRecord>;
    upsert(args: Prisma.AttendanceRecordUpsertArgs): PromiseLike<AttendanceRecord>;
    delete(args: Prisma.AttendanceRecordDeleteArgs): PromiseLike<AttendanceRecord>;
    deleteMany(args: Prisma.AttendanceRecordDeleteManyArgs): PromiseLike<Prisma.BatchPayload>;
  };
}

export const getMonthlyAttendanceSummary = async (
  query: AttendanceMonthQueryInput,
  db: AttendanceStore = prisma,
): Promise<AttendanceDashboardSummary> => {
  const now = new Date();
  const year = query.year !== undefined ? Number(query.year) : now.getUTCFullYear();
  const month = query.month !== undefined ? Number(query.month) : now.getUTCMonth() + 1;

  const workingDays = getWorkingDaysInMonth(year, month);
  const { startDate, endDate } = getMonthDateRange(year, month);

  const employees = await db.user.findMany({
    where: { role: 'EMPLOYEE', active: true },
    orderBy: { name: 'asc' },
  });

  const employeeIds = employees.map((e) => e.id);

  const records =
    employeeIds.length > 0
      ? await db.attendanceRecord.findMany({
          where: {
            userId: { in: employeeIds },
            date: { gte: startDate, lte: endDate },
          },
        })
      : [];

  // Group records by user
  const recordsByUser = new Map<string, AttendanceRecord[]>();
  for (const record of records) {
    const userRecords = recordsByUser.get(record.userId) || [];
    userRecords.push(record);
    recordsByUser.set(record.userId, userRecords);
  }

  const employeeSummaries: EmployeeMonthlySummary[] = employees.map((emp) => {
    const empRecords = recordsByUser.get(emp.id) || [];

    let absentDays = 0;
    let halfDays = 0;
    let leaveDays = 0;

    for (const rec of empRecords) {
      if (isWorkingDay(rec.date)) {
        if (rec.status === 'ABSENT') absentDays++;
        else if (rec.status === 'HALF_DAY') halfDays++;
        else if (rec.status === 'LEAVE') leaveDays++;
      }
    }

    const presentDays = Math.max(0, workingDays - (absentDays + halfDays + leaveDays));
    const salaryResult = calculateSalary({
      monthlySalary: emp.monthlySalary !== null && emp.monthlySalary !== undefined ? Number(emp.monthlySalary) : null,
      workingDays,
      presentDays,
      halfDays,
    });

    return {
      id: emp.id,
      name: emp.name,
      email: emp.email,
      phone: emp.phone,
      role: emp.role,
      profileImageUrl: emp.profileImageUrl ?? null,
      monthlySalary: emp.monthlySalary !== null && emp.monthlySalary !== undefined ? Number(emp.monthlySalary) : null,
      workingDays,
      presentDays,
      absentDays,
      halfDays,
      leaveDays,
      payableDays: salaryResult.payableDays,
      attendancePercentage: salaryResult.attendancePercentage,
      estimatedSalary: salaryResult.estimatedSalary,
    };
  });

  // Overall totals
  const totalWorkingDays = workingDays * employees.length;
  let totalPresentDays = 0;
  let totalAbsentDays = 0;
  let totalHalfDays = 0;
  let totalLeaveDays = 0;
  let totalPayableDays = 0;
  let totalEstimatedPayroll = 0;

  for (const s of employeeSummaries) {
    totalPresentDays += s.presentDays;
    totalAbsentDays += s.absentDays;
    totalHalfDays += s.halfDays;
    totalLeaveDays += s.leaveDays;
    totalPayableDays += s.payableDays;
    totalEstimatedPayroll += s.estimatedSalary;
  }

  const attendancePercentage =
    totalWorkingDays > 0 ? Number(((totalPresentDays / totalWorkingDays) * 100).toFixed(1)) : 100;
  const payablePercentage =
    totalWorkingDays > 0 ? Number(((totalPayableDays / totalWorkingDays) * 100).toFixed(1)) : 100;

  // Today stats
  const todayStr = formatDateToISO(now);
  const todayDateUtc = parseDateStringToUTC(todayStr);

  const todayRecords =
    employeeIds.length > 0
      ? await db.attendanceRecord.findMany({
          where: {
            userId: { in: employeeIds },
            date: todayDateUtc,
          },
        })
      : [];

  let absentToday = 0;
  let halfDayToday = 0;
  let leaveToday = 0;

  for (const rec of todayRecords) {
    if (rec.status === 'ABSENT') absentToday++;
    else if (rec.status === 'HALF_DAY') halfDayToday++;
    else if (rec.status === 'LEAVE') leaveToday++;
  }

  const presentToday = Math.max(0, employees.length - (absentToday + halfDayToday + leaveToday));

  return {
    year,
    month,
    totalEmployees: employees.length,
    workingDays,
    today: {
      date: todayStr,
      present: presentToday,
      absent: absentToday,
      halfDay: halfDayToday,
      leave: leaveToday,
      late: 0,
    },
    overall: {
      totalWorkingDays,
      presentDays: totalPresentDays,
      absentDays: totalAbsentDays,
      halfDays: totalHalfDays,
      leaveDays: totalLeaveDays,
      payableDays: totalPayableDays,
      attendancePercentage,
      payablePercentage,
      totalEstimatedPayroll,
    },
    employees: employeeSummaries,
  };
};

export const getEmployeeMonthlyAttendance = async (
  userId: string,
  query: AttendanceMonthQueryInput,
  db: AttendanceStore = prisma,
): Promise<EmployeeAttendanceDetailResult> => {
  const user = await db.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  }

  const now = new Date();
  const year = query.year !== undefined ? Number(query.year) : now.getUTCFullYear();
  const month = query.month !== undefined ? Number(query.month) : now.getUTCMonth() + 1;

  const workingDays = getWorkingDaysInMonth(year, month);
  const { startDate, endDate } = getMonthDateRange(year, month);

  const records = await db.attendanceRecord.findMany({
    where: {
      userId,
      date: { gte: startDate, lte: endDate },
    },
    orderBy: { date: 'asc' },
  });

  let absentDays = 0;
  let halfDays = 0;
  let leaveDays = 0;

  for (const rec of records) {
    if (isWorkingDay(rec.date)) {
      if (rec.status === 'ABSENT') absentDays++;
      else if (rec.status === 'HALF_DAY') halfDays++;
      else if (rec.status === 'LEAVE') leaveDays++;
    }
  }

  const presentDays = Math.max(0, workingDays - (absentDays + halfDays + leaveDays));
  const salaryResult = calculateSalary({
    monthlySalary: user.monthlySalary !== null && user.monthlySalary !== undefined ? Number(user.monthlySalary) : null,
    workingDays,
    presentDays,
    halfDays,
  });

  const serializedRecords: SerializedAttendanceRecord[] = records.map((r) => ({
    id: r.id,
    userId: r.userId,
    date: formatDateToISO(r.date),
    status: r.status,
    notes: r.notes,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));

  return {
    user: toPublicUser(user),
    year,
    month,
    workingDays,
    presentDays,
    absentDays,
    halfDays,
    leaveDays,
    payableDays: salaryResult.payableDays,
    attendancePercentage: salaryResult.attendancePercentage,
    dailySalary: salaryResult.dailySalary,
    estimatedSalary: salaryResult.estimatedSalary,
    records: serializedRecords,
  };
};

export const createOrUpdateAttendance = async (
  input: CreateOrUpdateAttendanceInput,
  db: AttendanceStore = prisma,
): Promise<{ message: string; record: SerializedAttendanceRecord | null; status: AttendanceStatus }> => {
  const user = await db.user.findUnique({
    where: { id: input.userId },
  });

  if (!user) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  }

  const dateUtc = parseDateStringToUTC(input.date);

  // If status is PRESENT, remove any exception record to preserve present-by-default architecture
  if (input.status === 'PRESENT') {
    await db.attendanceRecord.deleteMany({
      where: {
        userId: input.userId,
        date: dateUtc,
      },
    });

    return {
      message: 'Attendance reset to default PRESENT',
      record: null,
      status: 'PRESENT',
    };
  }

  const record = await db.attendanceRecord.upsert({
    where: {
      userId_date: {
        userId: input.userId,
        date: dateUtc,
      },
    },
    update: {
      status: input.status,
      notes: input.notes !== undefined ? (input.notes ?? null) : undefined,
    },
    create: {
      userId: input.userId,
      date: dateUtc,
      status: input.status,
      notes: input.notes ?? null,
    },
  });

  return {
    message: 'Attendance recorded successfully',
    record: {
      id: record.id,
      userId: record.userId,
      date: formatDateToISO(record.date),
      status: record.status,
      notes: record.notes,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    },
    status: record.status,
  };
};

export const patchAttendance = async (
  id: string,
  input: PatchAttendanceInput,
  db: AttendanceStore = prisma,
): Promise<{ message: string; record: SerializedAttendanceRecord | null; status: AttendanceStatus }> => {
  const existing = await db.attendanceRecord.findUnique({
    where: { id },
  });

  if (!existing) {
    throw new AppError(404, 'ATTENDANCE_RECORD_NOT_FOUND', 'Attendance record not found');
  }

  if (input.status === 'PRESENT') {
    await db.attendanceRecord.delete({
      where: { id },
    });

    return {
      message: 'Attendance reset to default PRESENT',
      record: null,
      status: 'PRESENT',
    };
  }

  const updated = await db.attendanceRecord.update({
    where: { id },
    data: {
      status: input.status !== undefined ? input.status : undefined,
      notes: input.notes !== undefined ? (input.notes ?? null) : undefined,
    },
  });

  return {
    message: 'Attendance updated successfully',
    record: {
      id: updated.id,
      userId: updated.userId,
      date: formatDateToISO(updated.date),
      status: updated.status,
      notes: updated.notes,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    },
    status: updated.status,
  };
};

export const deleteAttendance = async (
  identifier: { id?: string; userId?: string; date?: string },
  db: AttendanceStore = prisma,
): Promise<{ message: string }> => {
  if (identifier.id) {
    const existing = await db.attendanceRecord.findUnique({
      where: { id: identifier.id },
    });

    if (!existing) {
      throw new AppError(404, 'ATTENDANCE_RECORD_NOT_FOUND', 'Attendance record not found');
    }

    await db.attendanceRecord.delete({
      where: { id: identifier.id },
    });

    return { message: 'Attendance reset to default PRESENT' };
  }

  if (identifier.userId && identifier.date) {
    const dateUtc = parseDateStringToUTC(identifier.date);
    await db.attendanceRecord.deleteMany({
      where: {
        userId: identifier.userId,
        date: dateUtc,
      },
    });

    return { message: 'Attendance reset to default PRESENT' };
  }

  throw new AppError(400, 'INVALID_IDENTIFIER', 'Either record id or userId and date must be provided');
};
