export const getDaysInMonth = (year: number, month: number): number => {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
};

export const isWorkingDay = (date: Date): boolean => {
  // Monday to Saturday are working days (1-6), Sunday (0) is weekly off
  return date.getUTCDay() !== 0;
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
}

export interface SalaryCalculationResult {
  payableDays: number;
  dailySalary: number;
  estimatedSalary: number;
  attendancePercentage: number;
}

export const calculateSalary = (input: SalaryCalculationInput): SalaryCalculationResult => {
  const { workingDays, presentDays, halfDays } = input;
  const salary = Number(input.monthlySalary) || 0;

  const payableDays = presentDays + halfDays * 0.5;
  const attendancePercentage =
    workingDays > 0 ? Number(((presentDays / workingDays) * 100).toFixed(1)) : 100;

  if (workingDays <= 0 || salary <= 0) {
    return {
      payableDays,
      dailySalary: 0,
      estimatedSalary: 0,
      attendancePercentage,
    };
  }

  const dailySalary = Number((salary / workingDays).toFixed(4));
  const estimatedSalary = Math.round((salary / workingDays) * payableDays);

  return {
    payableDays,
    dailySalary,
    estimatedSalary,
    attendancePercentage,
  };
};
