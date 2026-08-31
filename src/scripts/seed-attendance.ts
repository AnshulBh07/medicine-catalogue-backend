import argon2 from 'argon2';
import { $Enums } from '@prisma/client/index';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import {
  formatDateToISO,
  getDaysInMonth,
  isWorkingDay,
  parseDateStringToUTC,
} from '../modules/attendance/attendance.utils.js';

export interface SeedEmployeeConfig {
  name: string;
  email: string;
  phone: string;
  monthlySalary: number;
  profileDescription: string;
  targetAttendanceLabel: string;
}

export const TEST_EMPLOYEES: SeedEmployeeConfig[] = [
  {
    name: 'Rahul Sharma',
    email: 'rahul.attendance.test@example.com',
    phone: '+919800000001',
    monthlySalary: 25000,
    profileDescription: 'High attendance profile (~88-92%)',
    targetAttendanceLabel: 'High (25k Salary)',
  },
  {
    name: 'Priya Verma',
    email: 'priya.attendance.test@example.com',
    phone: '+919800000002',
    monthlySalary: 30000,
    profileDescription: 'Very high attendance profile (~95-98%)',
    targetAttendanceLabel: 'Very High (30k Salary)',
  },
  {
    name: 'Amit Kumar',
    email: 'amit.attendance.test@example.com',
    phone: '+919800000003',
    monthlySalary: 22000,
    profileDescription: 'Moderate/Lower attendance profile (~75-80%)',
    targetAttendanceLabel: 'Moderate (22k Salary)',
  },
  {
    name: 'Sneha Gupta',
    email: 'sneha.attendance.test@example.com',
    phone: '+919800000004',
    monthlySalary: 28000,
    profileDescription: 'Near 100% perfect attendance profile (100%)',
    targetAttendanceLabel: '100% Perfect (28k Salary)',
  },
];

export const DEFAULT_TEST_PASSWORD = 'EmployeePassword123!';
export const DEFAULT_ADMIN_EMAIL = 'admin@medicina.com';
export const DEFAULT_ADMIN_PASSWORD = 'AdminPassword123!';

/**
 * Collect all valid working day dates (Mon-Sat) for a given year & month within [1, maxDay].
 */
function getWorkingDates(year: number, month: number, maxDay?: number): string[] {
  const daysInMonth = getDaysInMonth(year, month);
  const limit = maxDay !== undefined ? Math.min(maxDay, daysInMonth) : daysInMonth;
  const dates: string[] = [];

  for (let d = 1; d <= limit; d++) {
    const dateObj = new Date(Date.UTC(year, month - 1, d));
    if (isWorkingDay(dateObj)) {
      dates.push(formatDateToISO(dateObj));
    }
  }

  return dates;
}

export async function seedAttendanceData(): Promise<{
  adminUser: { email: string };
  employees: Array<{
    id: string;
    name: string;
    email: string;
    salary: number;
    currentExceptionsCount: number;
    previousExceptionsCount: number;
  }>;
}> {
  logger.info('===============================================================');
  logger.info('Starting Idempotent Attendance & Employee Development Seed...');
  logger.info('===============================================================');

  // 1. Ensure an Admin account exists
  let admin = await prisma.user.findFirst({
    where: { role: $Enums.UserRole.ADMIN, active: true },
  });

  if (!admin) {
    logger.info(`No active Admin found. Creating default development admin: ${DEFAULT_ADMIN_EMAIL}`);
    const adminPasswordHash = await argon2.hash(DEFAULT_ADMIN_PASSWORD, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    admin = await prisma.user.upsert({
      where: { email: DEFAULT_ADMIN_EMAIL },
      update: {
        role: $Enums.UserRole.ADMIN,
        active: true,
      },
      create: {
        name: 'System Admin',
        email: DEFAULT_ADMIN_EMAIL,
        phone: '+919999999999',
        passwordHash: adminPasswordHash,
        role: $Enums.UserRole.ADMIN,
        active: true,
      },
    });
  } else {
    logger.info(`Using existing Admin account: ${admin.email || admin.name}`);
  }

  // 2. Hash standard test employee password
  const employeePasswordHash = await argon2.hash(DEFAULT_TEST_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  // 3. Upsert test employees
  const seededEmployees: Array<{
    id: string;
    name: string;
    email: string;
    salary: number;
    currentExceptionsCount: number;
    previousExceptionsCount: number;
  }> = [];

  const createdUserMap = new Map<string, { id: string; name: string }>();

  for (const emp of TEST_EMPLOYEES) {
    const user = await prisma.user.upsert({
      where: { email: emp.email },
      update: {
        name: emp.name,
        phone: emp.phone,
        role: $Enums.UserRole.EMPLOYEE,
        monthlySalary: emp.monthlySalary,
        active: true,
      },
      create: {
        name: emp.name,
        email: emp.email,
        phone: emp.phone,
        passwordHash: employeePasswordHash,
        role: $Enums.UserRole.EMPLOYEE,
        monthlySalary: emp.monthlySalary,
        active: true,
      },
    });

    createdUserMap.set(emp.email, { id: user.id, name: user.name });
  }

  // 4. Calculate calendar dates dynamically (current month & previous month)
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1; // 1-12
  const currentDay = now.getUTCDate();

  // Previous month calculation
  const prevYear = currentMonth === 1 ? currentYear - 1 : currentYear;
  const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;

  // Working days up to today (never future dates)
  const currentWorkingDates = getWorkingDates(currentYear, currentMonth, currentDay);
  // Previous month working days (entire month)
  const prevWorkingDates = getWorkingDates(prevYear, prevMonth);

  logger.info(
    `Seeding attendance exceptions for Current Month (${currentYear}-${String(currentMonth).padStart(2, '0')}, ${currentWorkingDates.length} working days up to day ${currentDay}) and Previous Month (${prevYear}-${String(prevMonth).padStart(2, '0')}, ${prevWorkingDates.length} working days)...`,
  );

  // Helper to safely upsert an attendance record
  async function upsertException(
    userId: string,
    dateStr: string | undefined | null,
    status: $Enums.AttendanceStatus,
    notes: string,
  ) {
    if (!dateStr) return;
    const date = parseDateStringToUTC(dateStr);
    await prisma.attendanceRecord.upsert({
      where: {
        userId_date: {
          userId,
          date,
        },
      },
      update: {
        status,
        notes,
      },
      create: {
        userId,
        date,
        status,
        notes,
      },
    });
  }

  // 5. Seed exceptions per employee
  // A. Rahul Sharma (High attendance: ~2 ABSENT, 1 HALF_DAY, 1 LEAVE if sufficient days)
  const rahul = createdUserMap.get('rahul.attendance.test@example.com')!;
  let rahulCurrentCount = 0;
  let rahulPrevCount = 0;

  // Current month exceptions (spread across available working days)
  if (currentWorkingDates.length >= 4) {
    await upsertException(rahul.id, currentWorkingDates[1], $Enums.AttendanceStatus.ABSENT, 'Fever and cold');
    await upsertException(rahul.id, currentWorkingDates[2], $Enums.AttendanceStatus.ABSENT, 'Medical rest');
    await upsertException(rahul.id, currentWorkingDates[3], $Enums.AttendanceStatus.HALF_DAY, 'Afternoon personal work');
    rahulCurrentCount += 3;
    if (currentWorkingDates.length >= 7) {
      await upsertException(rahul.id, currentWorkingDates[6], $Enums.AttendanceStatus.LEAVE, 'Approved festival leave');
      rahulCurrentCount += 1;
    }
  } else if (currentWorkingDates.length >= 2) {
    await upsertException(rahul.id, currentWorkingDates[0], $Enums.AttendanceStatus.HALF_DAY, 'Personal errand');
    await upsertException(rahul.id, currentWorkingDates[1], $Enums.AttendanceStatus.ABSENT, 'Unplanned sick leave');
    rahulCurrentCount += 2;
  }

  // Previous month exceptions for Rahul
  if (prevWorkingDates.length >= 15) {
    await upsertException(rahul.id, prevWorkingDates[4], $Enums.AttendanceStatus.ABSENT, 'Family emergency');
    await upsertException(rahul.id, prevWorkingDates[11], $Enums.AttendanceStatus.HALF_DAY, 'Doctor appointment');
    await upsertException(rahul.id, prevWorkingDates[18], $Enums.AttendanceStatus.LEAVE, 'Casual leave');
    rahulPrevCount += 3;
  }

  seededEmployees.push({
    id: rahul.id,
    name: 'Rahul Sharma',
    email: 'rahul.attendance.test@example.com',
    salary: 25000,
    currentExceptionsCount: rahulCurrentCount,
    previousExceptionsCount: rahulPrevCount,
  });

  // B. Priya Verma (Very high attendance: 1 ABSENT, 2 HALF_DAY)
  const priya = createdUserMap.get('priya.attendance.test@example.com')!;
  let priyaCurrentCount = 0;
  let priyaPrevCount = 0;

  if (currentWorkingDates.length >= 4) {
    await upsertException(priya.id, currentWorkingDates[0], $Enums.AttendanceStatus.HALF_DAY, 'Morning clinic visit');
    await upsertException(priya.id, currentWorkingDates[currentWorkingDates.length - 1], $Enums.AttendanceStatus.HALF_DAY, 'Early departure for training');
    priyaCurrentCount += 2;
    if (currentWorkingDates.length >= 5) {
      await upsertException(priya.id, currentWorkingDates[4], $Enums.AttendanceStatus.ABSENT, 'Viral infection');
      priyaCurrentCount += 1;
    }
  } else if (currentWorkingDates.length >= 1) {
    await upsertException(priya.id, currentWorkingDates[0], $Enums.AttendanceStatus.HALF_DAY, 'Morning errand');
    priyaCurrentCount += 1;
  }

  // Previous month exceptions for Priya
  if (prevWorkingDates.length >= 15) {
    await upsertException(priya.id, prevWorkingDates[7], $Enums.AttendanceStatus.HALF_DAY, 'Traffic delay / half day');
    await upsertException(priya.id, prevWorkingDates[16], $Enums.AttendanceStatus.LEAVE, 'Pre-planned privilege leave');
    priyaPrevCount += 2;
  }

  seededEmployees.push({
    id: priya.id,
    name: 'Priya Verma',
    email: 'priya.attendance.test@example.com',
    salary: 30000,
    currentExceptionsCount: priyaCurrentCount,
    previousExceptionsCount: priyaPrevCount,
  });

  // C. Amit Kumar (Moderate/Lower attendance: 3 ABSENT, 1 LEAVE, 1 HALF_DAY)
  const amit = createdUserMap.get('amit.attendance.test@example.com')!;
  let amitCurrentCount = 0;
  let amitPrevCount = 0;

  if (currentWorkingDates.length >= 5) {
    await upsertException(amit.id, currentWorkingDates[0], $Enums.AttendanceStatus.ABSENT, 'Out of station');
    await upsertException(amit.id, currentWorkingDates[1], $Enums.AttendanceStatus.ABSENT, 'Travel delay');
    await upsertException(amit.id, currentWorkingDates[3], $Enums.AttendanceStatus.LEAVE, 'Family wedding');
    await upsertException(amit.id, currentWorkingDates[4], $Enums.AttendanceStatus.HALF_DAY, 'Post-travel rest');
    amitCurrentCount += 4;
    if (currentWorkingDates.length >= 8) {
      await upsertException(amit.id, currentWorkingDates[7], $Enums.AttendanceStatus.ABSENT, 'Unnotified absence');
      amitCurrentCount += 1;
    }
  } else if (currentWorkingDates.length >= 2) {
    await upsertException(amit.id, currentWorkingDates[0], $Enums.AttendanceStatus.ABSENT, 'Out of station');
    await upsertException(amit.id, currentWorkingDates[1], $Enums.AttendanceStatus.LEAVE, 'Personal leave');
    amitCurrentCount += 2;
  }

  // Previous month exceptions for Amit
  if (prevWorkingDates.length >= 18) {
    await upsertException(amit.id, prevWorkingDates[2], $Enums.AttendanceStatus.ABSENT, 'Unwell');
    await upsertException(amit.id, prevWorkingDates[8], $Enums.AttendanceStatus.ABSENT, 'Family event');
    await upsertException(amit.id, prevWorkingDates[13], $Enums.AttendanceStatus.HALF_DAY, 'Half-day duty');
    await upsertException(amit.id, prevWorkingDates[19], $Enums.AttendanceStatus.LEAVE, 'Annual leave');
    amitPrevCount += 4;
  }

  seededEmployees.push({
    id: amit.id,
    name: 'Amit Kumar',
    email: 'amit.attendance.test@example.com',
    salary: 22000,
    currentExceptionsCount: amitCurrentCount,
    previousExceptionsCount: amitPrevCount,
  });

  // D. Sneha Gupta (Near 100% attendance: only default PRESENT days, or 1 casual leave)
  const sneha = createdUserMap.get('sneha.attendance.test@example.com')!;
  const snehaCurrentCount = 0;
  let snehaPrevCount = 0;

  // Sneha has 100% present in current month (no exception records created)
  // In previous month, 1 pre-planned leave
  if (prevWorkingDates.length >= 10) {
    await upsertException(sneha.id, prevWorkingDates[9], $Enums.AttendanceStatus.LEAVE, 'Annual vacation day');
    snehaPrevCount += 1;
  }

  seededEmployees.push({
    id: sneha.id,
    name: 'Sneha Gupta',
    email: 'sneha.attendance.test@example.com',
    salary: 28000,
    currentExceptionsCount: snehaCurrentCount,
    previousExceptionsCount: snehaPrevCount,
  });

  logger.info('===============================================================');
  logger.info('ATTENDANCE DEVELOPMENT SEED SUMMARY:');
  logger.info('---------------------------------------------------------------');
  logger.info(`Admin Account: ${admin.email || admin.name} (Password: ${DEFAULT_ADMIN_PASSWORD})`);
  logger.info('Test Employees Seeded:');
  for (const emp of seededEmployees) {
    logger.info(
      ` - ${emp.name.padEnd(16)} | Email: ${emp.email.padEnd(36)} | Salary: ₹${emp.salary.toLocaleString('en-IN').padStart(7)} | Current Month Exceptions: ${emp.currentExceptionsCount} | Prev Month Exceptions: ${emp.previousExceptionsCount}`,
    );
  }
  logger.info(`Default Employee Password: ${DEFAULT_TEST_PASSWORD}`);
  logger.info('Default Status: PRESENT (no exception record stored for default present days)');
  logger.info('Idempotent: YES (safely upserts users and records without duplicates)');
  logger.info('===============================================================');

  return {
    adminUser: { email: admin.email || 'Admin' },
    employees: seededEmployees,
  };
}

if (
  process.argv[1]?.endsWith('seed-attendance.ts') ||
  process.argv[1]?.endsWith('seed-attendance.js')
) {
  seedAttendanceData()
    .catch((err) => {
      console.error('Attendance seed failed:', err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}