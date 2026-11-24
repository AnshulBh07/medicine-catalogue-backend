import { Prisma } from '@prisma/client/index';
import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { createGracefulShutdown } from '../src/common/shutdown.utils.js';
import { errorMiddleware } from '../src/middleware/error.middleware.js';
import {
  createCompositionSalt,
  updateCompositionSalt,
  type CompositionSaltStore,
} from '../src/modules/composition-salts/composition-salt.service.js';
import { MedicineAlternativeService } from '../src/modules/medicine-alternatives/medicine-alternative.service.js';
import { deactivateMedicine, type MedicineStore } from '../src/modules/medicines/medicine.service.js';
import {
  deleteUser,
  updateProfile,
  updateUser,
  type UserStore,
} from '../src/modules/users/user.service.js';
import { r2StorageService } from '../src/services/storage/r2.service.js';

describe('Phase 4 Remediation — Backend Unit Tests', () => {
  describe('F-021: Soft-Deleted Medicines Filtered Out of Alternatives', () => {
    it('filters inactive source and target medicines in listAlternatives and getByMedicineId', async () => {
      const findManyMock = vi.fn().mockResolvedValue([]);
      const mockDb = {
        medicineAlternative: {
          findMany: findManyMock,
        },
      };

      await MedicineAlternativeService.listAlternatives(undefined, mockDb as never);
      expect(findManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            sourceMedicine: { active: true },
            alternativeMedicine: { active: true },
          }),
        }),
      );

      findManyMock.mockClear();
      await MedicineAlternativeService.getByMedicineId('med-1', mockDb as never);
      expect(findManyMock).toHaveBeenCalledTimes(2);
      expect(findManyMock).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: expect.objectContaining({
            sourceMedicineId: 'med-1',
            sourceMedicine: { active: true },
            alternativeMedicine: { active: true },
          }),
        }),
      );
      expect(findManyMock).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: expect.objectContaining({
            alternativeMedicineId: 'med-1',
            sourceMedicine: { active: true },
            alternativeMedicine: { active: true },
          }),
        }),
      );
    });

    it('rejects self-referencing and inactive medicines during createAlternatives and updateAlternatives', async () => {
      const mockDb = {
        medicine: {
          findUnique: vi.fn().mockResolvedValue({ id: 'med-1', active: true }),
          findMany: vi.fn().mockResolvedValue([]), // Inactive alt filtered out
        },
        medicineAlternative: {
          count: vi.fn().mockResolvedValue(0),
        },
      };

      await expect(
        MedicineAlternativeService.createAlternatives(
          'admin-1',
          { sourceMedicineId: 'med-1', alternativeMedicineIds: ['med-1'] },
          mockDb as never,
        ),
      ).rejects.toMatchObject({ statusCode: 400 });

      await expect(
        MedicineAlternativeService.createAlternatives(
          'admin-1',
          { sourceMedicineId: 'med-1', alternativeMedicineIds: ['inactive-med-2'] },
          mockDb as never,
        ),
      ).rejects.toMatchObject({ statusCode: 400 });

      mockDb.medicineAlternative.count.mockResolvedValue(1);
      await expect(
        MedicineAlternativeService.updateAlternatives(
          'admin-1',
          'med-1',
          { alternativeMedicineIds: ['inactive-med-2'] },
          mockDb as never,
        ),
      ).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  describe('F-032A: User Deletion Protects Historical Attendance & Commercial Records', () => {
    const mockUser = {
      id: 'emp-1',
      name: 'Staff One',
      email: 'staff@appharmacy.com',
      phone: null,
      passwordHash: 'hash',
      role: 'EMPLOYEE' as const,
      profileImageUrl: null,
      monthlySalary: null,
      shiftType: 'FULL_DAY' as const,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('blocks permanent deletion with 409 USER_HAS_DEPENDENCIES when attendance history exists', async () => {
      const deleteSpy = vi.fn();
      const mockDb = {
        user: {
          findUnique: vi.fn().mockResolvedValue(mockUser),
          delete: deleteSpy,
        },
        commercialDetails: {
          count: vi.fn().mockResolvedValue(0),
        },
        attendanceRecord: {
          count: vi.fn().mockResolvedValue(12),
        },
      } as unknown as UserStore;

      await expect(deleteUser('emp-1', 'admin-1', mockDb)).rejects.toMatchObject({
        statusCode: 409,
        code: 'USER_HAS_DEPENDENCIES',
      });
      expect(deleteSpy).not.toHaveBeenCalled();
    });

    it('blocks permanent deletion when CommercialDetails records exist and allows delete when no history exists', async () => {
      const deleteSpy = vi.fn().mockResolvedValue(mockUser);
      const mockDbWithComm = {
        user: {
          findUnique: vi.fn().mockResolvedValue(mockUser),
          delete: deleteSpy,
        },
        commercialDetails: {
          count: vi.fn().mockResolvedValue(3),
        },
        attendanceRecord: {
          count: vi.fn().mockResolvedValue(0),
        },
      } as unknown as UserStore;

      await expect(deleteUser('emp-1', 'admin-1', mockDbWithComm)).rejects.toMatchObject({
        statusCode: 409,
        code: 'USER_HAS_DEPENDENCIES',
      });
      expect(deleteSpy).not.toHaveBeenCalled();

      const mockDbClean = {
        user: {
          findUnique: vi.fn().mockResolvedValue(mockUser),
          delete: deleteSpy,
        },
        commercialDetails: {
          count: vi.fn().mockResolvedValue(0),
        },
        attendanceRecord: {
          count: vi.fn().mockResolvedValue(0),
        },
      } as unknown as UserStore;

      const res = await deleteUser('emp-1', 'admin-1', mockDbClean);
      expect(res.message).toContain('deleted');
      expect(deleteSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('F-037: Error Mapping (413/Prisma), Graceful Shutdown & R2 Deactivation', () => {
    const createMockRes = () => {
      const res = {
        statusCode: 200,
        body: undefined as unknown,
        status(code: number) {
          this.statusCode = code;
          return this;
        },
        json(payload: unknown) {
          this.body = payload;
          return this;
        },
      };
      return res;
    };

    it('maps entity.too.large to 413, Prisma known errors to 4xx, and unexpected errors to 500', () => {
      const req = {} as Request;
      const next = vi.fn() as unknown as NextFunction;

      const res413 = createMockRes();
      errorMiddleware(
        Object.assign(new Error('request entity too large'), { type: 'entity.too.large', status: 413 }),
        req,
        res413 as unknown as Response,
        next,
      );
      expect(res413.statusCode).toBe(413);
      expect(res413.body).toEqual({
        error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request payload is too large' },
      });

      const resP2002 = createMockRes();
      errorMiddleware(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '7.0.0',
        }),
        req,
        resP2002 as unknown as Response,
        next,
      );
      expect(resP2002.statusCode).toBe(409);

      const resP2025 = createMockRes();
      errorMiddleware(
        new Prisma.PrismaClientKnownRequestError('Record not found', {
          code: 'P2025',
          clientVersion: '7.0.0',
        }),
        req,
        resP2025 as unknown as Response,
        next,
      );
      expect(resP2025.statusCode).toBe(404);

      const res500 = createMockRes();
      errorMiddleware(new Error('unexpected internal secret crash'), req, res500 as unknown as Response, next);
      expect(res500.statusCode).toBe(500);
      expect(res500.body).toEqual({
        error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' },
      });
    });

    it('graceful shutdown closes lingering keep-alive connections after grace period, disconnects Prisma, and ignores duplicate signals', async () => {
      let closeCallback: ((err?: Error) => void) | null = null;
      const closeIdleConnections = vi.fn();
      const closeAllConnections = vi.fn(() => {
        closeCallback?.();
      });
      const disconnectDb = vi.fn().mockResolvedValue(undefined);
      const stopScheduler = vi.fn();

      const shutdown = createGracefulShutdown({
        server: {
          close: vi.fn((cb?: (err?: Error) => void) => {
            closeCallback = cb ?? null;
            return {} as never;
          }),
          closeIdleConnections,
          closeAllConnections,
        },
        disconnectDb,
        stopScheduler,
        gracePeriodMs: 25,
        forceExitMs: 500,
      });

      // Invoke twice concurrently -> second call must be a no-op
      await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT')]);

      expect(stopScheduler).toHaveBeenCalledTimes(1);
      expect(closeIdleConnections).toHaveBeenCalledTimes(1);
      expect(closeAllConnections).toHaveBeenCalledTimes(1);
      expect(disconnectDb).toHaveBeenCalledTimes(1);
    });

    it('deactivateMedicine succeeds cleanly even if R2 image deletion throws', async () => {
      const r2Spy = vi
        .spyOn(r2StorageService, 'deleteObjectByPublicUrl')
        .mockRejectedValueOnce(new Error('R2 temporary outage'));

      const existing = {
        id: 'med-1',
        name: 'Dolo 650',
        compositionId: 'comp-1',
        form: 'TABLET',
        packQuantity: 15,
        packUnit: 'TABLET',
        shortDescription: null,
        imageUrl: 'https://cdn.example.com/medicines/dolo.jpg',
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
        composition: { id: 'comp-1', displayText: 'Paracetamol 650 MG' },
        manufacturer: { id: 'mfg-1', name: 'Micro Labs' },
        mr: null,
        batches: [],
      };

      const mockDb = {
        medicine: {
          findUnique: vi.fn().mockResolvedValue(existing),
          update: vi.fn().mockResolvedValue({ ...existing, active: false }),
        },
      } as unknown as MedicineStore;

      const result = await deactivateMedicine('med-1', mockDb);
      expect(result.active).toBe(false);
      expect(r2Spy).toHaveBeenCalledWith('https://cdn.example.com/medicines/dolo.jpg');
      r2Spy.mockRestore();
    });
  });

  describe('F-038: Composition Display Sync & User Contact Validation', () => {
    it('recalculates linked Composition.displayText atomically when updateCompositionSalt changes amount/unit', async () => {
      const updatedCompDisplay: Record<string, string> = {};
      const mockStore: CompositionSaltStore = {
        salt: {
          findUnique: vi.fn().mockResolvedValue({ id: 'salt-1', name: 'Paracetamol', active: true }),
        },
        compositionSalt: {
          findMany: vi.fn(),
          findUnique: vi.fn().mockResolvedValue({
            id: 'cs-1',
            saltId: 'salt-1',
            amount: 500,
            unit: 'MG',
            createdAt: new Date(),
            updatedAt: new Date(),
            salt: { id: 'salt-1', name: 'Paracetamol', active: true },
          }),
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn(),
          update: vi.fn().mockResolvedValue({
            id: 'cs-1',
            saltId: 'salt-1',
            amount: 650,
            unit: 'MG',
            createdAt: new Date(),
            updatedAt: new Date(),
            salt: { id: 'salt-1', name: 'Paracetamol', active: true },
          }),
        },
        composition: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'comp-1',
              compositionSaltLinks: [
                {
                  compositionSalt: {
                    amount: 650,
                    unit: 'MG',
                    salt: { id: 'salt-1', name: 'Paracetamol' },
                  },
                },
                {
                  compositionSalt: {
                    amount: 65,
                    unit: 'MG',
                    salt: { id: 'salt-2', name: 'Caffeine' },
                  },
                },
              ],
            },
          ]),
          update: vi.fn().mockImplementation(async ({ where, data }) => {
            updatedCompDisplay[where.id] = data.displayText;
            return { id: where.id, displayText: data.displayText };
          }),
        },
        $transaction: async <T,>(fn: (tx: CompositionSaltStore) => Promise<T>) => fn(mockStore),
      };

      const res = await updateCompositionSalt('cs-1', { amount: 650 }, mockStore);
      expect(res.amount).toBe(650);
      expect(updatedCompDisplay['comp-1']).toBe('Caffeine 65 MG + Paracetamol 650 MG');
    });

    it('rejects duplicate CompositionSalt (saltId, amount, unit) on create', async () => {
      const mockStore: CompositionSaltStore = {
        salt: {
          findUnique: vi.fn().mockResolvedValue({ id: 'salt-1', name: 'Paracetamol', active: true }),
        },
        compositionSalt: {
          findMany: vi.fn(),
          findUnique: vi.fn(),
          findFirst: vi.fn().mockResolvedValue({ id: 'existing-cs' }),
          create: vi.fn(),
          update: vi.fn(),
        },
      };

      await expect(
        createCompositionSalt({ saltId: 'salt-1', amount: 500, unit: 'MG' }, mockStore),
      ).rejects.toMatchObject({ statusCode: 409, code: 'DUPLICATE_COMPOSITION_SALT' });
    });

    it('prevents updateUser and updateProfile from clearing both email and phone while allowing valid single-contact updates', async () => {
      const emailOnlyUser = {
        id: 'u-1',
        name: 'User One',
        email: 'one@appharmacy.com',
        phone: null,
        passwordHash: 'hash',
        role: 'EMPLOYEE' as const,
        profileImageUrl: null,
        monthlySalary: null,
        shiftType: 'FULL_DAY' as const,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const updateSpy = vi.fn().mockImplementation(async ({ data }) => {
        const definedEntries = Object.entries(data).filter(([, v]) => v !== undefined);
        return {
          ...emailOnlyUser,
          ...Object.fromEntries(definedEntries),
        };
      });
      const mockDb = {
        user: {
          findUnique: vi.fn().mockResolvedValue(emailOnlyUser),
          update: updateSpy,
        },
      } as unknown as UserStore;

      // Clearing email on an email-only user leaves both null -> 400 CONTACT_REQUIRED
      await expect(
        updateUser('u-1', { email: null }, 'admin-1', mockDb),
      ).rejects.toMatchObject({ statusCode: 400, code: 'CONTACT_REQUIRED' });

      await expect(
        updateProfile('u-1', { email: null }, mockDb),
      ).rejects.toMatchObject({ statusCode: 400, code: 'CONTACT_REQUIRED' });

      // Clearing email while providing phone -> valid phone-only account!
      const switched = await updateProfile(
        'u-1',
        { email: null, phone: '+919876543210' },
        mockDb,
      );
      expect(switched.email).toBeNull();
      expect(switched.phone).toBe('+919876543210');

      // Omitted email & phone (name-only PATCH) -> preserves existing email!
      const renamed = await updateUser('u-1', { name: 'Renamed User' }, 'admin-1', mockDb);
      expect(renamed.name).toBe('Renamed User');
      expect(renamed.email).toBe('one@appharmacy.com');
    });
  });
});
