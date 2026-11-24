import { describe, expect, it, vi } from 'vitest';
import {
  createCommercialDetailsSchema,
  updateCommercialDetailsSchema,
} from '../src/modules/commercial-details/commercial-details.schemas.js';
import {
  createCommercialDetails,
  updateCommercialDetails,
  type CommercialDetailsStore,
} from '../src/modules/commercial-details/commercial-details.service.js';
import { updateBatchSchema } from '../src/modules/batches/batch.schemas.js';
import { updateBatch } from '../src/modules/batches/batch.service.js';
import { updateMedicineSchema } from '../src/modules/medicines/medicine.schemas.js';
import {
  listMedicines,
  updateMedicine,
  type MedicineStore,
} from '../src/modules/medicines/medicine.service.js';
import { createUserSchema, updateUserSchema } from '../src/modules/users/user.schemas.js';
import { createUser, updateUser, type UserStore } from '../src/modules/users/user.service.js';
import { calculateSalary } from '../src/modules/attendance/attendance.utils.js';
import {
  getEmployeeMonthlyAttendance,
  getMonthlyAttendanceSummary,
  type AttendanceStore,
} from '../src/modules/attendance/attendance.service.js';
import {
  calculateCommercialMetrics,
  formatScheme,
  parseSchemeQuantities,
} from '../src/common/commercial.utils.js';

vi.mock('../src/modules/notifications/notification.service.js', () => ({
  NotificationService: {
    createForRole: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('Phase 1 Remediation — Regression Tests', () => {
  // =========================================================================
  // F-005: Commercial PATCH Data Corruption
  // =========================================================================
  describe('F-005: Commercial Details & Batch PATCH preserves omitted fields', () => {
    const batchId = '11111111-1111-4111-8111-111111111111';
    const medicineId = '22222222-2222-4222-8222-222222222222';
    const userId = '33333333-3333-4333-8333-333333333333';

    const createInMemoryCommercialStore = () => {
      const batchRow = {
        id: batchId,
        medicineId,
        batchNumber: 'BATCH-F005',
        manufacturingDate: new Date('2026-01-01T00:00:00.000Z'),
        expiryDate: new Date('2028-01-01T00:00:00.000Z'),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        medicine: { id: medicineId, name: 'Test Med', active: true },
      };

      let commercialRow: Record<string, unknown> | null = null;

      const withRelations = () =>
        commercialRow
          ? {
              ...commercialRow,
              batch: batchRow,
              updatedByUser: { id: userId, name: 'Admin' },
            }
          : null;

      const store = {
        batch: {
          findUnique: async ({ where }: { where: { id: string } }) =>
            where.id === batchId
              ? { ...batchRow, commercialDetails: withRelations() }
              : null,
          update: async ({ data }: { data: Record<string, unknown> }) => {
            Object.assign(batchRow, data);
            return { ...batchRow, commercialDetails: withRelations() };
          },
        },
        commercialDetails: {
          findUnique: async ({ where }: { where: { batchId: string } }) =>
            where.batchId === batchId ? withRelations() : null,
          create: async ({ data }: { data: Record<string, unknown> }) => {
            commercialRow = {
              id: '44444444-4444-4444-8444-444444444444',
              ...data,
              updatedAt: new Date(),
            };
            return withRelations();
          },
          update: async ({ data }: { data: Record<string, unknown> }) => {
            if (!commercialRow) throw new Error('Not found');
            for (const [k, v] of Object.entries(data)) {
              if (v !== undefined) {
                commercialRow[k] = v;
              }
            }
            commercialRow.updatedAt = new Date();
            return withRelations();
          },
        },
        $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(store),
      };

      return store;
    };

    it('preserves gstPercent, purchaseRate, and discountPercent across partial commercial-details PATCHes and allows explicit 0', async () => {
      const store = createInMemoryCommercialStore();
      const db = store as unknown as CommercialDetailsStore;

      // Create with GST 12%
      const createInput = createCommercialDetailsSchema.parse({
        purchaseRate: 100,
        mrp: 150,
        discountPercent: 10,
        gstPercent: 12,
        scheme: '10+2',
        privateNotes: 'Initial note',
      });
      const created = await createCommercialDetails(batchId, createInput, userId, db);
      expect(created.gstPercent).toBe(12);
      expect(created.purchaseRate).toBe(100);
      expect(created.discountPercent).toBe(10);

      // PATCH only privateNotes -> GST must remain 12%
      const patchNotes = updateCommercialDetailsSchema.parse({ privateNotes: 'Updated note' });
      expect(patchNotes.gstPercent).toBeUndefined();
      const afterNotes = await updateCommercialDetails(batchId, patchNotes, userId, db);
      expect(afterNotes.privateNotes).toBe('Updated note');
      expect(afterNotes.gstPercent).toBe(12);
      expect(afterNotes.purchaseRate).toBe(100);
      expect(afterNotes.discountPercent).toBe(10);

      // PATCH only purchaseRate -> GST and discount remain unchanged
      const patchRate = updateCommercialDetailsSchema.parse({ purchaseRate: 110 });
      const afterRate = await updateCommercialDetails(batchId, patchRate, userId, db);
      expect(afterRate.purchaseRate).toBe(110);
      expect(afterRate.gstPercent).toBe(12);
      expect(afterRate.discountPercent).toBe(10);

      // PATCH only discountPercent -> GST and purchaseRate remain unchanged
      const patchDiscount = updateCommercialDetailsSchema.parse({ discountPercent: 5 });
      const afterDiscount = await updateCommercialDetails(batchId, patchDiscount, userId, db);
      expect(afterDiscount.discountPercent).toBe(5);
      expect(afterDiscount.gstPercent).toBe(12);
      expect(afterDiscount.purchaseRate).toBe(110);

      // Explicitly PATCH gstPercent to 0 -> becomes 0 intentionally
      const patchGstZero = updateCommercialDetailsSchema.parse({ gstPercent: 0 });
      expect(patchGstZero.gstPercent).toBe(0);
      const afterGstZero = await updateCommercialDetails(batchId, patchGstZero, userId, db);
      expect(afterGstZero.gstPercent).toBe(0);
      expect(afterGstZero.purchaseRate).toBe(110);
      expect(afterGstZero.discountPercent).toBe(5);
    });

    it('preserves existing batch commercialDetails fields on nested commercialDetails PATCH and allows explicit 0', async () => {
      const store = createInMemoryCommercialStore();
      await createCommercialDetails(
        batchId,
        createCommercialDetailsSchema.parse({
          purchaseRate: 90,
          mrp: 140,
          discountPercent: 8,
          gstPercent: 12,
          privateNotes: 'Batch note',
        }),
        userId,
        store as unknown as CommercialDetailsStore,
      );

      // PATCH batch with nested commercialDetails updating only privateNotes
      const parsedPatch = updateBatchSchema.parse({
        commercialDetails: { privateNotes: 'Revised batch note' },
      });
      expect(parsedPatch.commercialDetails?.purchaseRate).toBeUndefined();
      expect(parsedPatch.commercialDetails?.discountPercent).toBeUndefined();
      expect(parsedPatch.commercialDetails?.gstPercent).toBeUndefined();

      const updated = await updateBatch(batchId, parsedPatch, userId, true, store as never);
      expect(updated.commercialDetails?.privateNotes).toBe('Revised batch note');
      expect(updated.commercialDetails?.purchaseRate).toBe(90);
      expect(updated.commercialDetails?.discountPercent).toBe(8);
      expect(updated.commercialDetails?.gstPercent).toBe(12);
      expect(updated.commercialDetails?.mrp).toBe(140);

      // Explicitly PATCH nested gstPercent to 0
      const parsedZero = updateBatchSchema.parse({
        commercialDetails: { gstPercent: 0 },
      });
      const updatedZero = await updateBatch(batchId, parsedZero, userId, true, store as never);
      expect(updatedZero.commercialDetails?.gstPercent).toBe(0);
      expect(updatedZero.commercialDetails?.purchaseRate).toBe(90);
      expect(updatedZero.commercialDetails?.discountPercent).toBe(8);
    });
  });

  // =========================================================================
  // F-006: HALF_DAY Attendance Reporting & Work-Unit Salary Preservation
  // =========================================================================
  describe('F-006: HALF_DAY and FULL_DAY attendance percentages, payableDays, and salary preservation', () => {
    it('reports 100% attendance and 30 payableDays for HALF_DAY employee with perfect 30-day attendance', () => {
      // 30 working days * ₹400/half-day unit = ₹12,000 monthlySalary
      const res = calculateSalary({
        monthlySalary: 12000,
        workingDays: 30,
        presentDays: 0,
        halfDays: 30,
        shiftType: 'HALF_DAY',
        totalWorkUnits: 30,
      });

      expect(res.attendancePercentage).toBe(100);
      expect(res.payableDays).toBe(30);
      expect(res.totalWorkUnits).toBe(30);
      expect(res.unitRate).toBe(400);
      expect(res.estimatedSalary).toBe(12000);
    });

    it('accurately reflects absences for HALF_DAY employee', () => {
      // 30 working days, 3 absent -> 27 half-day units
      const res = calculateSalary({
        monthlySalary: 12000,
        workingDays: 30,
        presentDays: 0,
        halfDays: 27,
        shiftType: 'HALF_DAY',
        totalWorkUnits: 27,
      });

      expect(res.attendancePercentage).toBe(90);
      expect(res.payableDays).toBe(27);
      expect(res.estimatedSalary).toBe(10800);
    });

    it('reports 100% attendance and 30 payableDays for FULL_DAY employee with perfect 30-day attendance', () => {
      // 30 working days * ₹800/day = ₹24,000 (₹400/unit, 60 expected units)
      const res = calculateSalary({
        monthlySalary: 24000,
        workingDays: 30,
        presentDays: 30,
        halfDays: 0,
        shiftType: 'FULL_DAY',
        totalWorkUnits: 60,
      });

      expect(res.attendancePercentage).toBe(100);
      expect(res.payableDays).toBe(30);
      expect(res.totalWorkUnits).toBe(60);
      expect(res.unitRate).toBe(400);
      expect(res.estimatedSalary).toBe(24000);
    });

    it('handles extended work units (1.5 days = 3 units, double shift = 4 units) at normal unit rate without overtime premium', () => {
      // 30 working days, 28 standard full days (56 units) + 1 day at 3 units + 1 day at 4 units = 63 units
      const res = calculateSalary({
        monthlySalary: 24000,
        workingDays: 30,
        presentDays: 30,
        halfDays: 0,
        shiftType: 'FULL_DAY',
        totalWorkUnits: 63,
      });

      expect(res.payableDays).toBe(31.5);
      expect(res.attendancePercentage).toBe(105);
      // 63 units * ₹400 = ₹25,200 (exact normal rate)
      expect(res.estimatedSalary).toBe(25200);
    });

    it('aggregates mixed HALF_DAY and FULL_DAY employees with null workUnits, Sunday, LEAVE, and ABSENT records accurately', async () => {
      const halfDayUser = {
        id: 'emp-hd',
        name: 'Half Day Staff',
        email: 'hd@example.com',
        phone: null,
        passwordHash: 'hash',
        role: 'EMPLOYEE' as const,
        profileImageUrl: null,
        monthlySalary: 12000,
        shiftType: 'HALF_DAY' as const,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const fullDayUser = {
        id: 'emp-fd',
        name: 'Full Day Staff',
        email: 'fd@example.com',
        phone: null,
        passwordHash: 'hash',
        role: 'EMPLOYEE' as const,
        profileImageUrl: null,
        monthlySalary: 24000,
        shiftType: 'FULL_DAY' as const,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // September 2026 has 30 working days (including all Sundays)
      // - Half-day user: 1 historical record with workUnits=null on Sunday 2026-09-06 (HALF_DAY -> 1 unit),
      //   1 LEAVE on 2026-09-10 (0 units), 1 full-day shift (2 units) on 2026-09-15
      //   Total units = 27 default (27) + 1 (null fallback) + 0 (leave) + 2 (full day) = 30 units
      // - Full-day user: 1 ABSENT on 2026-09-04 (0 units), 1 historical HALF_DAY with workUnits=null on 2026-09-12 (1 unit)
      //   Total units = 28 default (56) + 0 (absent) + 1 (null fallback) = 57 units
      const records = [
        {
          id: 'r1',
          userId: 'emp-hd',
          date: new Date(Date.UTC(2026, 8, 6)), // Sunday
          status: 'HALF_DAY' as const,
          workUnits: null,
          notes: 'Legacy Sunday record',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'r2',
          userId: 'emp-hd',
          date: new Date(Date.UTC(2026, 8, 10)),
          status: 'LEAVE' as const,
          workUnits: 0,
          notes: 'Approved leave',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'r3',
          userId: 'emp-hd',
          date: new Date(Date.UTC(2026, 8, 15)),
          status: 'PRESENT' as const,
          workUnits: 2,
          notes: 'Covered full day',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'r4',
          userId: 'emp-fd',
          date: new Date(Date.UTC(2026, 8, 4)),
          status: 'ABSENT' as const,
          workUnits: 0,
          notes: 'Absent',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'r5',
          userId: 'emp-fd',
          date: new Date(Date.UTC(2026, 8, 12)),
          status: 'HALF_DAY' as const,
          workUnits: null,
          notes: 'Legacy half day',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const mockDb = {
        user: {
          findMany: async () => [fullDayUser, halfDayUser],
          findUnique: async ({ where }: { where: { id: string } }) =>
            where.id === 'emp-hd' ? halfDayUser : where.id === 'emp-fd' ? fullDayUser : null,
        },
        attendanceRecord: {
          findMany: async ({ where }: { where?: { userId?: string | { in: string[] }; date?: unknown } }) => {
            if (where?.date && where.date instanceof Date) return [];
            if (typeof where?.userId === 'string') {
              return records.filter((r) => r.userId === where.userId);
            }
            return records;
          },
        },
      } as unknown as AttendanceStore;

      const summary = await getMonthlyAttendanceSummary({ year: 2026, month: 9 }, mockDb);
      const hdSummary = summary.employees.find((e) => e.id === 'emp-hd')!;
      const fdSummary = summary.employees.find((e) => e.id === 'emp-fd')!;

      // HALF_DAY employee: 30 / 30 expected units -> 100%, 30 payableDays, ₹12,000
      expect(hdSummary.payableDays).toBe(30);
      expect(hdSummary.attendancePercentage).toBe(100);
      expect(hdSummary.estimatedSalary).toBe(12000);

      // FULL_DAY employee: 57 / 60 expected units -> 95%, 28.5 payableDays, ₹22,800
      expect(fdSummary.payableDays).toBe(28.5);
      expect(fdSummary.attendancePercentage).toBe(95);
      expect(fdSummary.estimatedSalary).toBe(22800);

      // Overall: (30 + 57) / (30 + 60) = 87 / 90 = 96.7%
      expect(summary.overall.attendancePercentage).toBe(96.7);
      expect(summary.overall.payableDays).toBe(58.5);
      expect(summary.overall.totalEstimatedPayroll).toBe(34800);

      // Individual employee detail endpoint matches summary
      const hdDetail = await getEmployeeMonthlyAttendance('emp-hd', { year: 2026, month: 9 }, mockDb);
      expect(hdDetail.attendancePercentage).toBe(100);
      expect(hdDetail.payableDays).toBe(30);
      expect(hdDetail.estimatedSalary).toBe(12000);
    });
  });

  // =========================================================================
  // F-008: Persist shiftType Correctly on User Create & Update
  // =========================================================================
  describe('F-008: User shiftType persistence', () => {
    const createInMemoryUserStore = () => {
      const users = new Map<string, Record<string, unknown>>();
      let seq = 1;

      const store: UserStore = {
        user: {
          create: async ({ data }) => {
            const id = `00000000-0000-4000-8000-00000000000${seq++}`;
            const row = {
              id,
              name: data.name,
              email: data.email ?? null,
              phone: data.phone ?? null,
              passwordHash: data.passwordHash,
              role: data.role,
              profileImageUrl: null,
              monthlySalary: data.monthlySalary ?? null,
              shiftType: data.shiftType ?? 'FULL_DAY',
              active: data.active ?? true,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            users.set(id, row);
            return row as never;
          },
          findUnique: async ({ where }) => (users.get(where.id!) as never) ?? null,
          findMany: async () => Array.from(users.values()) as never,
          count: async () => users.size,
          update: async ({ where, data }) => {
            const row = users.get(where.id!);
            if (!row) throw new Error('Not found');
            for (const [k, v] of Object.entries(data)) {
              if (v !== undefined) {
                row[k] = v;
              }
            }
            row.updatedAt = new Date();
            return row as never;
          },
          delete: async ({ where }) => {
            const row = users.get(where.id!);
            users.delete(where.id!);
            return row as never;
          },
        },
      };
      return store;
    };

    it('persists FULL_DAY, HALF_DAY, and default FULL_DAY on create, updates cleanly, and preserves shiftType on unrelated PATCH', async () => {
      const store = createInMemoryUserStore();
      const adminId = 'admin-1';

      // Create with FULL_DAY
      const uFull = await createUser(
        createUserSchema.parse({
          name: 'Full Timer',
          email: 'full@example.com',
          password: 'Password123!',
          role: 'EMPLOYEE',
          shiftType: 'FULL_DAY',
        }),
        store,
        adminId,
      );
      expect(uFull.shiftType).toBe('FULL_DAY');

      // Create with HALF_DAY
      const uHalf = await createUser(
        createUserSchema.parse({
          name: 'Half Timer',
          email: 'half@example.com',
          password: 'Password123!',
          role: 'EMPLOYEE',
          shiftType: 'HALF_DAY',
        }),
        store,
        adminId,
      );
      expect(uHalf.shiftType).toBe('HALF_DAY');

      // Create without shiftType -> defaults to FULL_DAY
      const uDefault = await createUser(
        createUserSchema.parse({
          name: 'Default Timer',
          email: 'default@example.com',
          password: 'Password123!',
          role: 'EMPLOYEE',
        }),
        store,
        adminId,
      );
      expect(uDefault.shiftType).toBe('FULL_DAY');

      // Update FULL_DAY -> HALF_DAY
      const updatedToHalf = await updateUser(
        uFull.id,
        updateUserSchema.parse({ shiftType: 'HALF_DAY' }),
        adminId,
        store,
      );
      expect(updatedToHalf.shiftType).toBe('HALF_DAY');

      // Update unrelated field without shiftType -> preserves HALF_DAY
      const afterUnrelated = await updateUser(
        uFull.id,
        updateUserSchema.parse({ name: 'Full Timer Renamed' }),
        adminId,
        store,
      );
      expect(afterUnrelated.name).toBe('Full Timer Renamed');
      expect(afterUnrelated.shiftType).toBe('HALF_DAY');

      // Update HALF_DAY -> FULL_DAY
      const updatedToFull = await updateUser(
        uFull.id,
        updateUserSchema.parse({ shiftType: 'FULL_DAY' }),
        adminId,
        store,
      );
      expect(updatedToFull.shiftType).toBe('FULL_DAY');
    });
  });

  // =========================================================================
  // F-027: Commercial Calculations & Scheme Parsing
  // =========================================================================
  describe('F-027: Commercial calculations & scheme parsing consistency', () => {
    it('parses all equivalent scheme formats identically', () => {
      const variants: unknown[] = [
        '10+2',
        '10 + 2',
        '10+2 Free',
        '10+2 free strips',
        'Buy 10 Get 2 Free',
        { buy: 10, free: 2 },
        { baseQuantity: 10, freeQuantity: 2 },
        { description: '10+2' },
        { text: '10+2 Free' },
        { scheme: '10+2' },
        { value: '10+2' },
        '{"description":"10+2"}',
        '{"buy":10,"free":2}',
        '{"scheme":"10+2 Free"}',
      ];

      for (const variant of variants) {
        expect(parseSchemeQuantities(variant)).toEqual({ buy: 10, free: 2 });
        const metrics = calculateCommercialMetrics(100, 150, 10, variant, 5);
        expect(metrics.purchasedQuantity).toBe(10);
        expect(metrics.freeQuantity).toBe(2);
        expect(metrics.sellableQuantity).toBe(12);
        expect(metrics.effectivePurchaseRate).toBeCloseTo(78.75, 4);
        expect(metrics.profitPerUnit).toBeCloseTo(71.25, 4);
        expect(metrics.markupPercent).toBeCloseTo((71.25 / 78.75) * 100, 4);
        expect(metrics.marginPercent).toBeCloseTo((71.25 / 150) * 100, 4);
      }

      expect(formatScheme('{"description":"10+2"}')).toBe('10+2');
      expect(parseSchemeQuantities('')).toBeNull();
      expect(parseSchemeQuantities(null)).toBeNull();
      expect(parseSchemeQuantities(undefined)).toBeNull();
    });

    it('computes consistent markup, margin, and profit across discount/GST combinations', () => {
      // No discount, no GST
      const plain = calculateCommercialMetrics(100, 125, 0, null, 0);
      expect(plain.effectivePurchaseRate).toBe(100);
      expect(plain.profitPerUnit).toBe(25);
      expect(plain.markupPercent).toBe(25);
      expect(plain.marginPercent).toBe(20);

      // Discount only (10%)
      const discOnly = calculateCommercialMetrics(100, 120, 10, null, 0);
      expect(discOnly.effectivePurchaseRate).toBe(90);
      expect(discOnly.profitPerUnit).toBe(30);
      expect(discOnly.markupPercent).toBeCloseTo(33.3333, 3);
      expect(discOnly.marginPercent).toBe(25);

      // GST only (12%)
      const gstOnly = calculateCommercialMetrics(100, 140, 0, null, 12);
      expect(gstOnly.effectivePurchaseRate).toBeCloseTo(112, 4);
      expect(gstOnly.profitPerUnit).toBeCloseTo(28, 4);
      expect(gstOnly.markupPercent).toBeCloseTo(25, 4);
      expect(gstOnly.marginPercent).toBeCloseTo(20, 4);

      // Discount + GST together
      const both = calculateCommercialMetrics(100, 150, 10, null, 12);
      // 100 * 0.9 * 1.12 = 100.8
      expect(both.effectivePurchaseRate).toBeCloseTo(100.8, 4);
      expect(both.profitPerUnit).toBeCloseTo(49.2, 4);
      expect(both.markupPercent).toBeCloseTo((49.2 / 100.8) * 100, 4);
      expect(both.marginPercent).toBeCloseTo((49.2 / 150) * 100, 4);
    });

    it('handles zero purchase rate, negative inputs, and non-finite inputs safely', () => {
      const zeroRate = calculateCommercialMetrics(0, 100, 0, null, 0);
      expect(zeroRate.effectivePurchaseRate).toBe(0);
      expect(zeroRate.markupPercent).toBe(0);
      expect(zeroRate.marginPercent).toBe(100);
      expect(Number.isFinite(zeroRate.markupPercent)).toBe(true);

      const negInputs = calculateCommercialMetrics(-50, -100, -10, null, -5);
      expect(negInputs.sellingPrice).toBe(0);
      expect(negInputs.effectivePurchaseRate).toBe(0);
      expect(negInputs.profitPerUnit).toBe(0);
      expect(negInputs.markupPercent).toBe(0);
      expect(negInputs.marginPercent).toBe(0);
      expect(negInputs.formattedProfit).toBe('₹0.00');

      const nonFinite = calculateCommercialMetrics(Infinity, NaN, Infinity, null, -Infinity);
      expect(nonFinite.sellingPrice).toBe(0);
      expect(nonFinite.effectivePurchaseRate).toBe(0);
      expect(nonFinite.markupPercent).toBe(0);
      expect(nonFinite.marginPercent).toBe(0);
      expect(nonFinite.formattedSellingPrice).toBe('₹0.00');
    });
  });

  // =========================================================================
  // F-028: Top-Level Commercial Updates Without MRP & Latest-Batch Price Filter
  // =========================================================================
  describe('F-028: Medicine/Batch commercial updates without MRP & latest-batch price filtering', () => {
    const medId = '55555555-5555-4555-8555-555555555555';
    const batchId = '66666666-6666-4666-8666-666666666666';
    const userId = '77777777-7777-4777-8777-777777777777';

    it('updates individual top-level commercial fields on updateMedicine and updateBatch without supplying mrp', async () => {
      const commercial = {
        id: 'comm-1',
        batchId,
        purchaseRate: 100,
        mrp: 150,
        discountPercent: 10,
        gstPercent: 12,
        scheme: '10+1' as unknown,
        privateNotes: 'Initial',
        updatedAt: new Date(),
        updatedBy: userId,
        updatedByUser: { id: userId, name: 'Admin' },
      };

      const batch = {
        id: batchId,
        medicineId: medId,
        batchNumber: 'B-001',
        manufacturingDate: new Date('2026-01-01T00:00:00.000Z'),
        expiryDate: new Date('2028-01-01T00:00:00.000Z'),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        medicine: { id: medId, name: 'Dolo 650', active: true },
        commercialDetails: commercial,
      };

      const medicine = {
        id: medId,
        name: 'Dolo 650',
        compositionId: 'comp-1',
        form: 'TABLET' as const,
        packQuantity: 15,
        packUnit: 'TABLET' as const,
        shortDescription: null,
        imageUrl: null,
        uses: null,
        recommendedAgeGroup: null,
        directions: null,
        warnings: null,
        storageInstructions: null,
        barcode: null,
        prescriptionRequired: false,
        manufacturerId: 'mfg-1',
        mrId: null,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        composition: { id: 'comp-1', displayText: 'Paracetamol 650mg' },
        manufacturer: { id: 'mfg-1', name: 'Micro Labs' },
        mr: null,
        batches: [batch],
      };

      const store = {
        medicine: {
          findUnique: async () => medicine,
          update: async ({ data }: { data: Record<string, unknown> }) => {
            Object.assign(medicine, data);
            return medicine;
          },
        },
        batch: {
          findFirst: async () => batch,
          findUnique: async () => batch,
          update: async ({ data }: { data: Record<string, unknown> }) => {
            Object.assign(batch, data);
            return batch;
          },
        },
        commercialDetails: {
          findUnique: async () => commercial,
          update: async ({ data }: { data: Record<string, unknown> }) => {
            Object.assign(commercial, data);
            return commercial;
          },
        },
        $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(store),
      };

      // PATCH only purchaseRate via updateMedicine
      await updateMedicine(medId, updateMedicineSchema.parse({ purchaseRate: 88 }), userId, store as never);
      expect(commercial.purchaseRate).toBe(88);
      expect(commercial.mrp).toBe(150);
      expect(commercial.gstPercent).toBe(12);

      // PATCH only discountPercent via updateMedicine
      await updateMedicine(medId, updateMedicineSchema.parse({ discountPercent: 7 }), userId, store as never);
      expect(commercial.discountPercent).toBe(7);
      expect(commercial.purchaseRate).toBe(88);

      // PATCH only gstPercent (including explicit 0) via updateBatch
      await updateBatch(batchId, updateBatchSchema.parse({ gstPercent: 0 }), userId, true, store as never);
      expect(commercial.gstPercent).toBe(0);
      expect(commercial.discountPercent).toBe(7);

      // PATCH only scheme via updateMedicine
      await updateMedicine(medId, updateMedicineSchema.parse({ scheme: '10+2' }), userId, store as never);
      expect(commercial.scheme).toBe('10+2');

      // PATCH only privateNotes via updateBatch
      await updateBatch(batchId, updateBatchSchema.parse({ privateNotes: 'Updated note' }), userId, true, store as never);
      expect(commercial.privateNotes).toBe('Updated note');

      // PATCH MRP together with purchaseRate
      await updateMedicine(
        medId,
        updateMedicineSchema.parse({ mrp: 175, purchaseRate: 95 }),
        userId,
        store as never,
      );
      expect(commercial.mrp).toBe(175);
      expect(commercial.purchaseRate).toBe(95);

      // PATCH unrelated medicine field -> commercial data untouched
      await updateMedicine(medId, updateMedicineSchema.parse({ name: 'Dolo 650mg' }), userId, store as never);
      expect(medicine.name).toBe('Dolo 650mg');
      expect(commercial.mrp).toBe(175);
      expect(commercial.purchaseRate).toBe(95);
      expect(commercial.privateNotes).toBe('Updated note');
    });

    it('filters listMedicines by latest batch MRP only, ignoring historical batch prices', async () => {
      const makeMed = (id: string, name: string, latestMrp: number | null) => ({
        id,
        name,
        compositionId: 'c1',
        form: 'TABLET' as const,
        packQuantity: 10,
        packUnit: 'TABLET' as const,
        shortDescription: null,
        imageUrl: null,
        uses: null,
        recommendedAgeGroup: null,
        directions: null,
        warnings: null,
        storageInstructions: null,
        barcode: null,
        prescriptionRequired: false,
        manufacturerId: 'm1',
        mrId: null,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        composition: { id: 'c1', displayText: 'Salt 500mg' },
        manufacturer: { id: 'm1', name: 'Mfg' },
        mr: null,
        // medicineInclude returns only the latest batch (orderBy createdAt desc, take 1)
        batches:
          latestMrp !== null
            ? [
                {
                  id: `b-${id}`,
                  medicineId: id,
                  batchNumber: 'LATEST',
                  manufacturingDate: null,
                  expiryDate: new Date('2028-01-01'),
                  createdAt: new Date(),
                  updatedAt: new Date(),
                  commercialDetails: {
                    id: `cd-${id}`,
                    batchId: `b-${id}`,
                    purchaseRate: latestMrp * 0.7,
                    mrp: latestMrp,
                    discountPercent: 0,
                    gstPercent: 0,
                    scheme: null,
                    privateNotes: null,
                    updatedAt: new Date(),
                    updatedBy: 'u1',
                    updatedByUser: { id: 'u1', name: 'Admin' },
                  },
                },
              ]
            : [],
      });

      // Med A: old batch was ₹100, latest batch is ₹250
      // Med B: old batch was ₹300, latest batch is ₹120
      // Med C: no batch / null MRP
      const allMeds = [
        makeMed('med-a', 'Alpha', 250),
        makeMed('med-b', 'Beta', 120),
        makeMed('med-c', 'Gamma', null),
      ];

      let capturedWhere: Record<string, unknown> = {};
      const mockStore = {
        medicine: {
          findMany: async ({ where }: { where: Record<string, unknown> }) => {
            capturedWhere = where;
            return allMeds;
          },
        },
      } as unknown as MedicineStore;

      // Filter maxPrice = 150 -> must return ONLY Beta (latest MRP 120), NOT Alpha (latest MRP 250) or Gamma (null)
      const under150 = await listMedicines({ maxPrice: 150, includeInactive: false }, mockStore);
      expect(capturedWhere.batches).toBeUndefined();
      expect(under150.map((m) => m.name)).toEqual(['Beta']);
      expect(under150[0]?.mrp).toBe(120);

      // Filter minPrice = 200 -> must return ONLY Alpha (latest MRP 250)
      const over200 = await listMedicines({ minPrice: 200, includeInactive: false }, mockStore);
      expect(over200.map((m) => m.name)).toEqual(['Alpha']);
      expect(over200[0]?.mrp).toBe(250);

      // Filter minPrice = 100, maxPrice = 300 with sortBy = 'mrp' desc -> [Alpha (250), Beta (120)]
      const inRange = await listMedicines(
        { minPrice: 100, maxPrice: 300, sortBy: 'mrp', sortOrder: 'desc', includeInactive: false },
        mockStore,
      );
      expect(inRange.map((m) => m.name)).toEqual(['Alpha', 'Beta']);
    });
  });
});
