import express from 'express';
import request from 'supertest';
import { Prisma } from '@prisma/client/index';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { validateQuery } from '../src/middleware/validate.middleware.js';
import { errorMiddleware } from '../src/middleware/error.middleware.js';
import {
  addCalendarMonthsUtc,
  formatDateOnlyUtc,
  getIstDateParts,
  getIstDateString,
  isValidCalendarDateString,
  parseDateOnlyToUtc,
} from '../src/common/date.utils.js';
import {
  formatNotificationDate,
  NotificationService,
} from '../src/modules/notifications/notification.service.js';
import { createDealSchema, updateDealSchema } from '../src/modules/deals/deal.schemas.js';
import {
  createDeal,
  getDeal,
  updateDeal,
  updateDealStatus,
} from '../src/modules/deals/deal.service.js';
import { createMedicine } from '../src/modules/medicines/medicine.service.js';
import { createMedicineSchema } from '../src/modules/medicines/medicine.schemas.js';
import {
  createOrUpdateAttendanceSchema,
  deleteAttendanceQuerySchema,
} from '../src/modules/attendance/attendance.schemas.js';
import {
  createOrUpdateAttendance,
  getMonthlyAttendanceSummary,
  patchAttendance,
  type AttendanceStore,
} from '../src/modules/attendance/attendance.service.js';
import { getMonthDateRange } from '../src/modules/attendance/attendance.utils.js';
import {
  createShortageItemSchema,
  patchShortageItemSchema,
  shortageDateQuerySchema,
} from '../src/modules/shortages/shortage.schemas.js';
import { shortageService } from '../src/modules/shortages/shortage.service.js';

describe('Phase 2 Remediation — Regression Tests', () => {
  // =========================================================================
  // F-007: Express 5 Query Validation
  // =========================================================================
  describe('F-007: Express 5 validateQuery preserves defaults, coercions, and transforms', () => {
    const querySchema = z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(25),
      includeInactive: z
        .enum(['true', 'false'])
        .default('false')
        .transform((v) => v === 'true'),
      search: z.string().trim().optional(),
    });

    const testApp = express();
    testApp.get('/test', validateQuery(querySchema), (req, res) => {
      res.status(200).json({ validated: req.validatedQuery });
    });
    testApp.use(errorMiddleware);

    it('applies Zod defaults when query parameters are omitted under Express 5', async () => {
      const res = await request(testApp).get('/test');
      expect(res.status).toBe(200);
      expect(res.body.validated).toEqual({
        page: 1,
        limit: 25,
        includeInactive: false,
      });
    });

    it('preserves coercions, boolean transforms, and trimmed strings', async () => {
      const res = await request(testApp).get('/test?page=3&limit=50&includeInactive=true&search=%20dolo%20&extra=ignored');
      expect(res.status).toBe(200);
      expect(res.body.validated).toEqual({
        page: 3,
        limit: 50,
        includeInactive: true,
        search: 'dolo',
      });
    });

    it('rejects invalid query parameters with standard 400 validation error', async () => {
      const res = await request(testApp).get('/test?page=abc&limit=500');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // =========================================================================
  // F-014: Medicine Deal Inactivity Notifications
  // =========================================================================
  describe('F-014: checkDealInactivity alerts only PENDING deals and deduplicates', () => {
    it('notifies only PENDING deals >= 30 days old, ignores RECEIVED and CANCELLED, and avoids duplicates', async () => {
      const now = new Date('2026-10-15T10:00:00.000Z');
      const oldDate = new Date('2026-09-01T10:00:00.000Z'); // 44 days ago

      const allDeals = [
        {
          id: 'deal-pending',
          medicineId: 'med-1',
          mrId: 'mr-1',
          status: 'PENDING',
          statusUpdatedAt: oldDate,
          medicine: { id: 'med-1', name: 'Dolo 650' },
          mr: { id: 'mr-1', name: 'Raj', company: 'Micro Labs' },
        },
        {
          id: 'deal-received',
          medicineId: 'med-2',
          mrId: 'mr-1',
          status: 'RECEIVED',
          statusUpdatedAt: oldDate,
          medicine: { id: 'med-2', name: 'Augmentin' },
          mr: { id: 'mr-1', name: 'Raj', company: 'GSK' },
        },
        {
          id: 'deal-cancelled',
          medicineId: 'med-3',
          mrId: 'mr-1',
          status: 'CANCELLED',
          statusUpdatedAt: oldDate,
          medicine: { id: 'med-3', name: 'Pan 40' },
          mr: { id: 'mr-1', name: 'Raj', company: 'Alkem' },
        },
      ];

      const storedNotifications = new Map<string, Record<string, unknown>>();
      let capturedWhere: Record<string, unknown> = {};

      const mockDb = {
        deal: {
          findMany: async ({ where }: { where: { status?: string; statusUpdatedAt?: { lte: Date } } }) => {
            capturedWhere = where;
            return allDeals.filter((d) => {
              if (where.status && d.status !== where.status) return false;
              if (where.statusUpdatedAt?.lte && d.statusUpdatedAt > where.statusUpdatedAt.lte) return false;
              return true;
            });
          },
        },
        user: {
          findMany: async () => [{ id: 'admin-1' }],
        },
        notification: {
          findUnique: async ({ where }: { where: { userId_dedupeKey: { userId: string; dedupeKey: string } } }) => {
            const key = `${where.userId_dedupeKey.userId}::${where.userId_dedupeKey.dedupeKey}`;
            return storedNotifications.get(key) ?? null;
          },
          create: async ({ data }: { data: Record<string, unknown> }) => {
            const key = `${data.userId}::${data.dedupeKey}`;
            const row = {
              id: `notif-${storedNotifications.size + 1}`,
              ...data,
              createdAt: now,
              updatedAt: now,
            };
            storedNotifications.set(key, row);
            return row;
          },
        },
      };

      const firstRun = await NotificationService.checkDealInactivity(now, mockDb as never);
      expect(capturedWhere.status).toBe('PENDING');
      expect(firstRun.inactiveDealsCount).toBe(1);
      expect(storedNotifications.size).toBe(1);

      const onlyNotif = Array.from(storedNotifications.values())[0];
      expect(onlyNotif?.entityId).toBe('deal-pending');

      // Second run should not create duplicate notifications
      await NotificationService.checkDealInactivity(now, mockDb as never);
      expect(storedNotifications.size).toBe(1);
    });
  });

  // =========================================================================
  // F-019: Expiry Scheduler Correctness & Efficiency
  // =========================================================================
  describe('F-019: Expiry scheduler month-end/year-end, IST boundary, batching, and dedupe re-eligibility', () => {
    it('clamps month-end and year-end calendar additions without rollover', () => {
      // Dec 31, 2026 + 2 months -> Feb 28, 2027 (non-leap year, NOT Mar 3)
      expect(addCalendarMonthsUtc(2026, 12, 31, 2).toISOString().slice(0, 10)).toBe('2027-02-28');
      // Dec 31, 2027 + 2 months -> Feb 29, 2028 (leap year)
      expect(addCalendarMonthsUtc(2027, 12, 31, 2).toISOString().slice(0, 10)).toBe('2028-02-29');
      // Nov 30, 2026 + 2 months -> Jan 30, 2027 (year-end)
      expect(addCalendarMonthsUtc(2026, 11, 30, 2).toISOString().slice(0, 10)).toBe('2027-01-30');
      // formatNotificationDate uses UTC components without local shift
      expect(formatNotificationDate(new Date('2026-06-01T00:00:00.000Z'))).toBe('01 Jun 2026');
    });

    it('filters DB query to expiry window, avoids N+1 queries, handles IST boundaries, and allows re-notification after expiry correction', async () => {
      // 2026-12-31T19:00:00Z == 2027-01-01 00:30 IST (new year in IST!)
      // Window: today = 2027-01-01, twoMonthsAhead = 2027-03-01
      const istNewYear = new Date('2026-12-31T19:00:00.000Z');

      const batches = [
        {
          id: 'b-expired',
          batchNumber: 'EXP-1',
          expiryDate: new Date('2027-01-01T00:00:00.000Z'), // expired on IST today
          medicine: { id: 'm1', name: 'Med Expired' },
        },
        {
          id: 'b-soon',
          batchNumber: 'SOON-1',
          expiryDate: new Date('2027-03-01T00:00:00.000Z'), // exactly at 2-month boundary
          medicine: { id: 'm2', name: 'Med Soon' },
        },
        {
          id: 'b-future',
          batchNumber: 'FUT-1',
          expiryDate: new Date('2027-03-02T00:00:00.000Z'), // outside window
          medicine: { id: 'm3', name: 'Med Future' },
        },
      ];

      let batchWhereCaptured: Record<string, unknown> = {};
      let userFindManyCalls = 0;
      let createManyCalls = 0;
      const insertedByKey = new Map<string, Record<string, unknown>>();

      const mockDb = {
        batch: {
          findMany: async ({ where }: { where: { expiryDate?: { lte: Date } } }) => {
            batchWhereCaptured = where;
            const lte = where.expiryDate?.lte;
            return batches.filter((b) => (!lte ? true : b.expiryDate <= lte));
          },
        },
        user: {
          findMany: async () => {
            userFindManyCalls++;
            return [{ id: 'u1' }, { id: 'u2' }];
          },
        },
        notification: {
          updateMany: async () => ({ count: 0 }),
          createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
            createManyCalls++;
            let count = 0;
            for (const row of data) {
              const key = `${row.userId}::${row.dedupeKey}`;
              if (!insertedByKey.has(key)) {
                insertedByKey.set(key, row);
                count++;
              }
            }
            return { count };
          },
        },
      };

      const res1 = await NotificationService.checkExpiryConditions(istNewYear, mockDb as never);
      expect(batchWhereCaptured.expiryDate).toEqual({ lte: new Date('2027-03-01T00:00:00.000Z') });
      expect(res1).toEqual({ expiredCount: 1, expiringSoonCount: 1 });
      // Active users fetched once and notifications inserted in a single batch (no N+1)
      expect(userFindManyCalls).toBe(1);
      expect(createManyCalls).toBe(1);
      expect(insertedByKey.size).toBe(4); // 2 batches * 2 users

      // Repeated run produces zero duplicates
      await NotificationService.checkExpiryConditions(istNewYear, mockDb as never);
      expect(insertedByKey.size).toBe(4);

      // Admin corrects b-expired's mistaken expiry date to 2027-06-15; later on 2027-05-01 it enters window legitimately
      batches[0]!.expiryDate = new Date('2027-06-15T00:00:00.000Z');
      const mayFirst = new Date('2027-05-01T06:00:00.000Z');
      await NotificationService.checkExpiryConditions(mayFirst, mockDb as never);
      expect(insertedByKey.has('u1::MEDICINE_EXPIRING_SOON:b-expired:2027-06-15')).toBe(true);
    });
  });

  // =========================================================================
  // F-022: Medicine Deal Business Rules
  // =========================================================================
  describe('F-022: Deal status transitions, inactive entities, historical reads, and scheme length', () => {
    const medId = '11111111-1111-4111-8111-111111111111';
    const mrId = '22222222-2222-4222-8222-222222222222';

    it('enforces 100-character maximum on agreedScheme at schema boundary', () => {
      const exact100 = 'A'.repeat(100);
      const over100 = 'A'.repeat(101);

      expect(
        createDealSchema.safeParse({
          medicineId: medId,
          mrId,
          agreedMrp: 100,
          agreedScheme: exact100,
          agreedBillDiscount: 5,
        }).success,
      ).toBe(true);

      expect(
        createDealSchema.safeParse({
          medicineId: medId,
          mrId,
          agreedMrp: 100,
          agreedScheme: over100,
          agreedBillDiscount: 5,
        }).success,
      ).toBe(false);

      expect(updateDealSchema.safeParse({ agreedScheme: over100 }).success).toBe(false);
    });

    it('rejects inactive medicine/MR on create, blocks invalid status transitions, and allows reading historical deals', async () => {
      const inactiveMedDb = {
        medicine: { findUnique: async () => ({ id: medId, name: 'Old Med', active: false }) },
        mR: { findUnique: async () => ({ id: mrId, name: 'MR', phone: '999', company: 'Co', active: true }) },
      };

      await expect(
        createDeal(
          {
            medicineId: medId,
            mrId,
            agreedMrp: 100,
            agreedScheme: '10+1',
            agreedBillDiscount: 5,
          },
          'admin-1',
          inactiveMedDb as never,
        ),
      ).rejects.toMatchObject({ statusCode: 409, code: 'INACTIVE_MEDICINE' });

      const inactiveMrDb = {
        medicine: { findUnique: async () => ({ id: medId, name: 'Med', active: true }) },
        mR: { findUnique: async () => ({ id: mrId, name: 'Old MR', phone: '999', company: 'Co', active: false }) },
      };

      await expect(
        createDeal(
          {
            medicineId: medId,
            mrId,
            agreedMrp: 100,
            agreedScheme: '10+1',
            agreedBillDiscount: 5,
          },
          'admin-1',
          inactiveMrDb as never,
        ),
      ).rejects.toMatchObject({ statusCode: 409, code: 'INACTIVE_MR' });

      const dealRow = {
        id: 'deal-1',
        medicineId: medId,
        mrId,
        dealDate: new Date('2026-08-01T00:00:00.000Z'),
        agreedMrp: 120,
        agreedScheme: '10+2',
        agreedBillDiscount: 5,
        mrPhoneSnapshot: '999',
        status: 'RECEIVED' as 'PENDING' | 'RECEIVED' | 'CANCELLED',
        statusUpdatedAt: new Date('2026-08-02T00:00:00.000Z'),
        notes: 'Historical',
        createdById: 'admin-1',
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        updatedAt: new Date('2026-08-02T00:00:00.000Z'),
        medicine: {
          id: medId,
          name: 'Deactivated Med',
          form: 'TABLET',
          packQuantity: 10,
          packUnit: 'TABLET',
          manufacturer: { id: 'mfg-1', name: 'Mfg' },
        },
        mr: { id: mrId, name: 'Deactivated MR', company: 'Co', phone: '999', email: null },
        createdBy: { id: 'admin-1', name: 'Admin' },
      };

      const dealDb = {
        deal: {
          findUnique: async () => dealRow,
          update: async ({ data }: { data: Record<string, unknown> }) => {
            Object.assign(dealRow, data);
            return dealRow;
          },
        },
      };

      // Historical deal remains readable even if medicine/MR were later deactivated
      const historical = await getDeal('deal-1', dealDb as never);
      expect(historical.id).toBe('deal-1');
      expect(historical.status).toBe('RECEIVED');

      // Prohibited transitions: RECEIVED -> CANCELLED, RECEIVED -> PENDING
      await expect(updateDealStatus('deal-1', 'CANCELLED', dealDb as never)).rejects.toMatchObject({
        statusCode: 400,
        code: 'INVALID_STATUS_TRANSITION',
      });
      await expect(updateDeal('deal-1', { status: 'PENDING' }, dealDb as never)).rejects.toMatchObject({
        statusCode: 400,
        code: 'INVALID_STATUS_TRANSITION',
      });

      // Prohibited transition: CANCELLED -> RECEIVED
      dealRow.status = 'CANCELLED';
      await expect(updateDealStatus('deal-1', 'RECEIVED', dealDb as never)).rejects.toMatchObject({
        statusCode: 400,
        code: 'INVALID_STATUS_TRANSITION',
      });

      // Permitted transition: PENDING -> RECEIVED
      dealRow.status = 'PENDING';
      const transitioned = await updateDealStatus('deal-1', 'RECEIVED', dealDb as never);
      expect(transitioned.status).toBe('RECEIVED');
    });
  });

  // =========================================================================
  // F-023: PostgreSQL Transaction Aborted State (25P02)
  // =========================================================================
  describe('F-023: Transaction-safe manufacturer/salt resolution and clean rollback on errors', () => {
    it('resolves manufacturer and salt via skipDuplicates without throwing inside $transaction, and propagates original error on rollback', async () => {
      let manufacturerCreateManyCalled = 0;
      let saltCreateManyCalled = 0;
      let txAborted = false;
      let queriesAfterAbort = 0;
      let rolledBack = false;

      const makeTx = (failMedicineCreate: boolean) => ({
        manufacturer: {
          findFirst: async () => {
            if (txAborted) queriesAfterAbort++;
            return manufacturerCreateManyCalled > 0
              ? { id: 'mfg-1', name: 'Cipla', active: true }
              : null;
          },
          createMany: async () => {
            if (txAborted) queriesAfterAbort++;
            manufacturerCreateManyCalled++;
            return { count: 0 }; // simulates concurrent insert conflict skipped cleanly
          },
        },
        salt: {
          findFirst: async () => {
            if (txAborted) queriesAfterAbort++;
            return saltCreateManyCalled > 0
              ? { id: 'salt-1', name: 'Paracetamol', active: true }
              : null;
          },
          createMany: async () => {
            if (txAborted) queriesAfterAbort++;
            saltCreateManyCalled++;
            return { count: 0 }; // simulates concurrent insert conflict skipped cleanly
          },
        },
        compositionSalt: {
          findFirst: async () => ({ id: 'cs-1' }),
        },
        composition: {
          findMany: async () => [
            { id: 'comp-1', compositionSaltLinks: [{ compositionSaltId: 'cs-1' }] },
          ],
        },
        medicine: {
          create: async () => {
            if (failMedicineCreate) {
              txAborted = true;
              throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
                code: 'P2002',
                clientVersion: '7.10.0',
              });
            }
            return {
              id: 'med-new',
              name: 'Dolo 650',
              compositionId: 'comp-1',
              form: 'TABLET',
              packQuantity: 15,
              packUnit: 'TABLET',
              shortDescription: null,
              imageUrl: null,
              uses: null,
              recommendedAgeGroup: null,
              directions: null,
              warnings: null,
              storageInstructions: null,
              barcode: 'BAR-123',
              prescriptionRequired: false,
              manufacturerId: 'mfg-1',
              mrId: null,
              active: true,
              createdAt: new Date(),
              updatedAt: new Date(),
              composition: { id: 'comp-1', displayText: 'Paracetamol 650mg' },
              manufacturer: { id: 'mfg-1', name: 'Cipla' },
              mr: null,
              batches: [],
            };
          },
        },
      });

      const validPayload = createMedicineSchema.parse({
        name: 'Dolo 650',
        form: 'TABLET',
        packQuantity: 15,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerName: 'Cipla',
        salts: [{ name: 'Paracetamol', amount: 650, unit: 'MG' }],
        barcode: 'BAR-123',
      });

      // 1. Successful concurrent-safe creation
      const okDb = {
        $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(makeTx(false)),
      };
      const created = await createMedicine(validPayload, 'admin-1', okDb as never);
      expect(created.id).toBe('med-new');
      expect(manufacturerCreateManyCalled).toBe(1);
      expect(saltCreateManyCalled).toBe(1);

      // 2. Failing transaction rolls back and preserves original DUPLICATE_BARCODE error with zero queries after abort
      manufacturerCreateManyCalled = 0;
      saltCreateManyCalled = 0;
      txAborted = false;
      queriesAfterAbort = 0;
      const failDb = {
        $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
          try {
            return await fn(makeTx(true));
          } catch (err) {
            rolledBack = true;
            throw err;
          }
        },
      };

      await expect(createMedicine(validPayload, 'admin-1', failDb as never)).rejects.toMatchObject({
        statusCode: 409,
        code: 'DUPLICATE_BARCODE',
      });
      expect(rolledBack).toBe(true);
      expect(queriesAfterAbort).toBe(0);
    });
  });

  // =========================================================================
  // F-024: UTC/IST Date Handling & Calendar Rollover
  // =========================================================================
  describe('F-024: IST date boundaries, calendar validation, and month/year ranges', () => {
    it('computes IST business date across midnight (00:00–05:30 IST) and year-end boundaries', () => {
      // 2026-08-31 19:00 UTC == 2026-09-01 00:30 IST
      const augUtcSepIst = new Date('2026-08-31T19:00:00.000Z');
      expect(getIstDateString(augUtcSepIst)).toBe('2026-09-01');
      expect(getIstDateParts(augUtcSepIst)).toEqual({ year: 2026, month: 9, day: 1 });

      // 2026-12-31 18:30 UTC == 2027-01-01 00:00 IST
      const decUtcJanIst = new Date('2026-12-31T18:30:00.000Z');
      expect(getIstDateString(decUtcJanIst)).toBe('2027-01-01');
      expect(formatDateOnlyUtc(new Date('2026-02-28T00:00:00.000Z'))).toBe('28 Feb 2026');
    });

    it('rejects invalid rollover calendar dates like 2026-02-31 and 2026-99-99', () => {
      expect(isValidCalendarDateString('2026-02-28')).toBe(true);
      expect(isValidCalendarDateString('2028-02-29')).toBe(true);
      expect(isValidCalendarDateString('2026-02-29')).toBe(false);
      expect(isValidCalendarDateString('2026-02-31')).toBe(false);
      expect(isValidCalendarDateString('2026-99-99')).toBe(false);
      expect(() => parseDateOnlyToUtc('2026-02-31')).toThrow();

      expect(
        createOrUpdateAttendanceSchema.safeParse({
          userId: '11111111-1111-4111-8111-111111111111',
          date: '2026-02-31',
          status: 'ABSENT',
        }).success,
      ).toBe(false);
      expect(deleteAttendanceQuerySchema.safeParse({ date: '2026-04-31' }).success).toBe(false);
      expect(shortageDateQuerySchema.safeParse({ date: '2026-02-31' }).success).toBe(false);
    });

    it('uses IST default month/year and today in attendance summary and inclusive month date ranges', async () => {
      const augUtcSepIst = new Date('2026-08-31T19:00:00.000Z'); // 2026-09-01 00:30 IST
      const mockDb = {
        user: { findMany: async () => [] },
        attendanceRecord: { findMany: async () => [] },
      } as unknown as AttendanceStore;

      const summary = await getMonthlyAttendanceSummary({}, mockDb, augUtcSepIst);
      expect(summary.year).toBe(2026);
      expect(summary.month).toBe(9);
      expect(summary.today.date).toBe('2026-09-01');

      const febLeapRange = getMonthDateRange(2028, 2);
      expect(febLeapRange.startDate.toISOString()).toBe('2028-02-01T00:00:00.000Z');
      expect(febLeapRange.endDate.toISOString()).toBe('2028-02-29T23:59:59.999Z');
    });
  });

  // =========================================================================
  // F-025: Attendance Work Units & Notes
  // =========================================================================
  describe('F-025: ABSENT/LEAVE zero workUnits enforcement & note preservation', () => {
    it('forces workUnits=0 for ABSENT/LEAVE, preserves PRESENT/HALF_DAY units, and persists/preserves notes', async () => {
      const userId = '11111111-1111-4111-8111-111111111111';
      const records = new Map<string, Record<string, unknown>>();
      let seq = 1;

      const mockDb = {
        user: {
          findUnique: async () => ({
            id: userId,
            shiftType: 'FULL_DAY',
            monthlySalary: 24000,
          }),
        },
        attendanceRecord: {
          findUnique: async ({ where }: { where: { id?: string } }) =>
            where.id ? (records.get(where.id) ?? null) : null,
          upsert: async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
            const existing = Array.from(records.values()).find(
              (r) => r.userId === create.userId && (r.date as Date).getTime() === (create.date as Date).getTime(),
            );
            if (existing) {
              for (const [k, v] of Object.entries(update)) {
                if (v !== undefined) existing[k] = v;
              }
              existing.updatedAt = new Date();
              return existing;
            }
            const id = `att-${seq++}`;
            const row = { id, ...create, createdAt: new Date(), updatedAt: new Date() };
            records.set(id, row);
            return row;
          },
          update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
            const row = records.get(where.id)!;
            for (const [k, v] of Object.entries(data)) {
              if (v !== undefined) row[k] = v;
            }
            row.updatedAt = new Date();
            return row;
          },
          deleteMany: async () => ({ count: 0 }),
        },
      } as unknown as AttendanceStore;

      // ABSENT with explicit nonzero workUnits -> forced to 0, notes persisted
      const absentRes = await createOrUpdateAttendance(
        { userId, date: '2026-09-05', status: 'ABSENT', workUnits: 2, notes: 'Unplanned absence' },
        mockDb,
      );
      expect(absentRes.record?.workUnits).toBe(0);
      expect(absentRes.record?.notes).toBe('Unplanned absence');

      // LEAVE with explicit nonzero workUnits -> forced to 0
      const leaveRes = await createOrUpdateAttendance(
        { userId, date: '2026-09-06', status: 'LEAVE', workUnits: 3, notes: 'Approved leave' },
        mockDb,
      );
      expect(leaveRes.record?.workUnits).toBe(0);
      expect(leaveRes.record?.notes).toBe('Approved leave');

      // PRESENT with standard 2 units AND notes -> persisted (NOT deleted!)
      const presentWithNotes = await createOrUpdateAttendance(
        { userId, date: '2026-09-07', status: 'PRESENT', notes: 'Covered counter' },
        mockDb,
      );
      expect(presentWithNotes.record).not.toBeNull();
      expect(presentWithNotes.record?.workUnits).toBe(2);
      expect(presentWithNotes.record?.notes).toBe('Covered counter');

      // Extended shift (double shift = 4 units) preserved; omitted notes on PATCH preserves existing notes
      const extendedRes = await patchAttendance(
        presentWithNotes.record!.id,
        { status: 'PRESENT', workUnits: 4 },
        mockDb,
      );
      expect(extendedRes.record?.workUnits).toBe(4);
      expect(extendedRes.record?.notes).toBe('Covered counter');

      // PATCHing to LEAVE forces workUnits=0 while preserving existing notes when notes omitted
      const patchedLeave = await patchAttendance(
        presentWithNotes.record!.id,
        { status: 'LEAVE', workUnits: 4 },
        mockDb,
      );
      expect(patchedLeave.record?.workUnits).toBe(0);
      expect(patchedLeave.record?.notes).toBe('Covered counter');
    });
  });

  // =========================================================================
  // F-026: Shortage currentQuantity Zero, Omitted, Clearing, & Invalid Inputs
  // =========================================================================
  describe('F-026: Shortage currentQuantity accepts 0, preserves omitted, clears via null, rejects negative/non-finite', () => {
    const medId = '11111111-1111-4111-8111-111111111111';

    it('validates zero, positive, null, omitted, and rejects negative/non-finite/non-integer values', () => {
      expect(
        createShortageItemSchema.safeParse({ medicineId: medId, quantity: 5, currentQuantity: 0 }).success,
      ).toBe(true);
      expect(
        createShortageItemSchema.safeParse({ medicineId: medId, quantity: 5, currentQuantity: 3 }).success,
      ).toBe(true);
      expect(
        createShortageItemSchema.safeParse({ medicineId: medId, quantity: 5, currentQuantity: null }).success,
      ).toBe(true);
      expect(
        createShortageItemSchema.safeParse({ medicineId: medId, quantity: 5, currentQuantity: -1 }).success,
      ).toBe(false);
      expect(
        createShortageItemSchema.safeParse({ medicineId: medId, quantity: 5, currentQuantity: NaN }).success,
      ).toBe(false);
      expect(
        createShortageItemSchema.safeParse({ medicineId: medId, quantity: 5, currentQuantity: Infinity }).success,
      ).toBe(false);
      expect(
        patchShortageItemSchema.safeParse({ currentQuantity: 0 }).success,
      ).toBe(true);
      expect(
        patchShortageItemSchema.safeParse({ currentQuantity: null }).success,
      ).toBe(true);
      expect(
        patchShortageItemSchema.safeParse({ currentQuantity: -2 }).success,
      ).toBe(false);
    });

    it('persists currentQuantity=0 on create, preserves on omitted patch, and clears to null on explicit null patch', async () => {
      const now = new Date('2026-09-10T06:00:00.000Z');
      let storedRow: Record<string, unknown> | null = null;

      const withRelations = (row: Record<string, unknown>) => ({
        ...row,
        medicine: {
          id: medId,
          name: 'Dolo 650',
          form: 'TABLET',
          packQuantity: 15,
          packUnit: 'TABLET',
          imageUrl: null,
          shortDescription: null,
          composition: { id: 'c1', displayText: 'Paracetamol 650mg' },
          manufacturer: { id: 'm1', name: 'Micro Labs' },
          mr: null,
        },
        createdBy: { id: 'u1', name: 'Staff', email: 's@example.com', role: 'EMPLOYEE' },
      });

      const mockDb = {
        medicine: {
          findUnique: async () => ({ id: medId, name: 'Dolo 650', active: true }),
        },
        shortageItem: {
          findUnique: async ({ where }: { where: { id?: string; medicineId_date?: unknown } }) => {
            if (where.id && storedRow && storedRow.id === where.id) return withRelations(storedRow);
            return null;
          },
          create: async ({ data }: { data: Record<string, unknown> }) => {
            storedRow = { id: 'short-1', ...data, createdAt: now, updatedAt: now };
            return withRelations(storedRow);
          },
          update: async ({ data }: { data: Record<string, unknown> }) => {
            if (!storedRow) throw new Error('Not found');
            for (const [k, v] of Object.entries(data)) {
              if (v !== undefined) storedRow[k] = v;
            }
            storedRow.updatedAt = new Date();
            return withRelations(storedRow);
          },
        },
      };

      // Create with explicit currentQuantity = 0
      const created = await shortageService.createShortageItem(
        'u1',
        createShortageItemSchema.parse({
          medicineId: medId,
          date: '2026-09-10',
          quantity: 10,
          currentQuantity: 0,
        }),
        mockDb as never,
        now,
      );
      expect(created.currentQuantity).toBe(0);

      // PATCH unrelated field (quantity only) -> preserves currentQuantity = 0
      const afterQtyPatch = await shortageService.patchShortageItem(
        'short-1',
        patchShortageItemSchema.parse({ quantity: 12 }),
        mockDb as never,
      );
      expect(afterQtyPatch.quantity).toBe(12);
      expect(afterQtyPatch.currentQuantity).toBe(0);

      // PATCH explicit currentQuantity = null -> clears to null
      const afterClear = await shortageService.patchShortageItem(
        'short-1',
        patchShortageItemSchema.parse({ currentQuantity: null }),
        mockDb as never,
      );
      expect(afterClear.currentQuantity).toBeNull();
    });
  });
});
