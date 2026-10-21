export const getDaysInMonth = (year: number, month: number): number => {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
};

export const isWorkingDay = (_date: Date): boolean => {
  // All 7 days (Monday through Sunday) are working days for the pharmacy
  return true;
};

export const getWorkingDaysInMonth = (year: number, month: number): number => {
  const totalDays = getDaysInMonth(year, month);
  let workingDays = 0;
  for (let day = 1; day <= totalDays; day++) {
    const d = new Date(Date.UTC(year, month - 1, day));
    if (isWorkingDay(d)) {
      workingDays++;
    }
  }
  return workingDays;
};

export const formatDateToISO = (date: Date): string => {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export const parseDateStringToUTC = (dateStr: string): Date => {
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  return new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1, Number(dayStr)));
};

export const getMonthDateRange = (year: number, month: number): { startDate: Date; endDate: Date } => {
  const totalDays = getDaysInMonth(year, month);
  return {
    startDate: new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0)),
    endDate: new Date(Date.UTC(year, month - 1, totalDays, 23, 59, 59, 999)),
  };
};

export interface SalaryCalculationInput {
  monthlySalary: number | null | undefined;
  workingDays: number;
  presentDays: number;
  halfDays: number;
  shiftType?: 'FULL_DAY' | 'HALF_DAY';
  totalWorkUnits?: number;
}

export interface SalaryCalculationResult {
  payableDays: number;
  dailySalary: number;
  unitRate: number;
  totalWorkUnits: number;
  estimatedSalary: number;
  attendancePercentage: number;
}

export const calculateSalary = (input: SalaryCalculationInput): SalaryCalculationResult => {
  const { workingDays, presentDays, halfDays, shiftType = 'FULL_DAY' } = input;
  const salary = Number(input.monthlySalary) || 0;

  // 1 half-day shift = 1 unit; 1 full day = 2 units
  const totalWorkUnits =
    input.totalWorkUnits !== undefined
      ? input.totalWorkUnits
      : presentDays * 2 + halfDays * 1;

  const payableDays = totalWorkUnits / 2;
  const attendancePercentage =
    workingDays > 0 ? Number(((presentDays / workingDays) * 100).toFixed(1)) : 100;

  if (workingDays <= 0 || salary <= 0) {
    return {
      payableDays,
      dailySalary: 0,
      unitRate: 0,
      totalWorkUnits,
      estimatedSalary: 0,
      attendancePercentage,
    };
  }

  // Normal unit rate:
  // - FULL_DAY employee: 1 full day = 2 units, so unit rate is dailySalary / 2
  // - HALF_DAY employee: normal shift is 1 unit, so unit rate is monthlySalary / workingDays
  const dailySalary = Number((salary / workingDays).toFixed(4));
  const unitRate = shiftType === 'HALF_DAY' ? dailySalary : dailySalary / 2;

  // Extra time is paid at normal rate with no overtime premium
  const estimatedSalary = Math.round(totalWorkUnits * unitRate);

  return {
    payableDays,
    dailySalary,
    unitRate,
    totalWorkUnits,
    estimatedSalary,
    attendancePercentage,
  };
};
