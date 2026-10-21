import { Prisma, type AttendanceRecord, type AttendanceStatus, type ShiftType, type User } from '@prisma/client/index';
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
  getDaysInMonth,
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
  workUnits: number | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EmployeeAttendanceDetailResult {
  user: PublicUser;
  shiftType: ShiftType;
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

  const totalDaysInMonth = getDaysInMonth(year, month);

  const employeeSummaries: EmployeeMonthlySummary[] = employees.map((emp) => {
    const empRecords = recordsByUser.get(emp.id) || [];
    const recByDate = new Map<string, AttendanceRecord>();
    for (const rec of empRecords) {
      recByDate.set(formatDateToISO(rec.date), rec);
    }

    let absentDays = 0;
    let halfDays = 0;
    let leaveDays = 0;
    let presentDays = 0;
    let totalWorkUnits = 0;

    for (let day = 1; day <= totalDaysInMonth; day++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const rec = recByDate.get(dateStr);

      if (rec) {
        if (rec.status === 'ABSENT') {
          absentDays++;
        } else if (rec.status === 'LEAVE') {
          leaveDays++;
        } else if (rec.status === 'HALF_DAY') {
          halfDays++;
          totalWorkUnits += rec.workUnits !== null && rec.workUnits !== undefined ? Number(rec.workUnits) : 1;
        } else if (rec.status === 'PRESENT') {
          presentDays++;
          totalWorkUnits += rec.workUnits !== null && rec.workUnits !== undefined ? Number(rec.workUnits) : 2;
        }
      } else {
        if (emp.shiftType === 'HALF_DAY') {
          halfDays++;
          totalWorkUnits += 1;
        } else {
          presentDays++;
          totalWorkUnits += 2;
        }
      }
    }

    const salaryResult = calculateSalary({
      monthlySalary: emp.monthlySalary !== null && emp.monthlySalary !== undefined ? Number(emp.monthlySalary) : null,
      workingDays,
      presentDays,
      halfDays,
      shiftType: emp.shiftType,
      totalWorkUnits,
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
  let presentToday = 0;

  const todayRecMap = new Map<string, AttendanceRecord>();
  for (const rec of todayRecords) {
    todayRecMap.set(rec.userId, rec);
  }

  for (const emp of employees) {
    const rec = todayRecMap.get(emp.id);
    if (rec) {
      if (rec.status === 'ABSENT') absentToday++;
      else if (rec.status === 'HALF_DAY') halfDayToday++;
      else if (rec.status === 'LEAVE') leaveToday++;
      else if (rec.status === 'PRESENT') presentToday++;
    } else {
      if (emp.shiftType === 'HALF_DAY') halfDayToday++;
      else presentToday++;
    }
  }

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

  const recByDate = new Map<string, AttendanceRecord>();
  for (const rec of records) {
    recByDate.set(formatDateToISO(rec.date), rec);
  }

  let absentDays = 0;
  let halfDays = 0;
  let leaveDays = 0;
  let presentDays = 0;
  let totalWorkUnits = 0;

  const totalDaysInMonth = getDaysInMonth(year, month);
  for (let day = 1; day <= totalDaysInMonth; day++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const rec = recByDate.get(dateStr);

    if (rec) {
      if (rec.status === 'ABSENT') {
        absentDays++;
      } else if (rec.status === 'LEAVE') {
        leaveDays++;
      } else if (rec.status === 'HALF_DAY') {
        halfDays++;
        totalWorkUnits += rec.workUnits !== null && rec.workUnits !== undefined ? Number(rec.workUnits) : 1;
      } else if (rec.status === 'PRESENT') {
        presentDays++;
        totalWorkUnits += rec.workUnits !== null && rec.workUnits !== undefined ? Number(rec.workUnits) : 2;
      }
    } else {
      if (user.shiftType === 'HALF_DAY') {
        halfDays++;
        totalWorkUnits += 1;
      } else {
        presentDays++;
        totalWorkUnits += 2;
      }
    }
  }

  const salaryResult = calculateSalary({
    monthlySalary: user.monthlySalary !== null && user.monthlySalary !== undefined ? Number(user.monthlySalary) : null,
    workingDays,
    presentDays,
    halfDays,
    shiftType: user.shiftType,
    totalWorkUnits,
  });

  const serializedRecords: SerializedAttendanceRecord[] = records.map((r) => ({
    id: r.id,
    userId: r.userId,
    date: formatDateToISO(r.date),
    status: r.status,
    workUnits: r.workUnits !== null && r.workUnits !== undefined ? Number(r.workUnits) : null,
    notes: r.notes,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));

  return {
    user: toPublicUser(user),
    shiftType: user.shiftType,
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

  // If status is PRESENT without explicit workUnits, without notes, and user is FULL_DAY,
  // delete any existing exception to restore present-by-default architecture (preserves test 11).
  if (
    input.status === 'PRESENT' &&
    input.workUnits === undefined &&
    !input.notes &&
    user.shiftType === 'FULL_DAY'
  ) {
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

  let workUnitsVal: number | null = null;
  if (input.workUnits !== undefined && input.workUnits !== null) {
    workUnitsVal = Number(input.workUnits);
  } else if (input.status === 'PRESENT') {
    workUnitsVal = 2;
  } else if (input.status === 'HALF_DAY') {
    workUnitsVal = 1;
  } else {
    workUnitsVal = 0;
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
      workUnits: workUnitsVal !== null ? new Prisma.Decimal(workUnitsVal) : null,
      notes: input.notes !== undefined ? (input.notes ?? null) : undefined,
    },
    create: {
      userId: input.userId,
      date: dateUtc,
      status: input.status,
      workUnits: workUnitsVal !== null ? new Prisma.Decimal(workUnitsVal) : null,
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
      workUnits: record.workUnits !== null && record.workUnits !== undefined ? Number(record.workUnits) : null,
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

  let workUnitsVal: number | undefined | null = undefined;
  if (input.workUnits !== undefined) {
    workUnitsVal = input.workUnits !== null ? Number(input.workUnits) : null;
  } else if (input.status === 'PRESENT') {
    workUnitsVal = 2;
  } else if (input.status === 'HALF_DAY') {
    workUnitsVal = 1;
  } else if (input.status === 'ABSENT' || input.status === 'LEAVE') {
    workUnitsVal = 0;
  }

  const updated = await db.attendanceRecord.update({
    where: { id },
    data: {
      status: input.status !== undefined ? input.status : undefined,
      workUnits: workUnitsVal !== undefined ? (workUnitsVal !== null ? new Prisma.Decimal(workUnitsVal) : null) : undefined,
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
      workUnits: updated.workUnits !== null && updated.workUnits !== undefined ? Number(updated.workUnits) : null,
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
