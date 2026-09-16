import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { signAccessToken } from '../src/modules/auth/jwt.js';

describe('Medicine Alternatives Integration Tests', () => {
  let adminToken: string;
  let adminUserId: string;
  let employeeToken: string;
  let employeeUserId: string;

  let testManufacturerId: string;
  let testCompositionId: string;
  let sourceMedId: string;
  let altMed1Id: string;
  let altMed2Id: string;
  let unrelatedMedId: string;

  const testSuffix = Date.now().toString().slice(-6);

  beforeAll(async () => {
    const passwordHash = await argon2.hash('TestPassword123');

    // Create Admin User
    const adminUser = await prisma.user.create({
      data: {
        name: `Alt Admin ${testSuffix}`,
        email: `alt-admin-${testSuffix}@example.com`,
        phone: `+9198${testSuffix.padStart(8, '0')}`,
        passwordHash,
        role: 'ADMIN',
        active: true,
      },
    });
    adminUserId = adminUser.id;
    adminToken = await signAccessToken({
      userId: adminUserId,
      email: adminUser.email!,
      role: 'ADMIN',
    });

    // Create Employee User
    const employeeUser = await prisma.user.create({
      data: {
        name: `Alt Employee ${testSuffix}`,
        email: `alt-emp-${testSuffix}@example.com`,
        phone: `+9197${testSuffix.padStart(8, '0')}`,
        passwordHash,
        role: 'EMPLOYEE',
        active: true,
      },
    });
    employeeUserId = employeeUser.id;
    employeeToken = await signAccessToken({
      userId: employeeUserId,
      email: employeeUser.email!,
      role: 'EMPLOYEE',
    });

    // Create Manufacturer & Composition
    const mfg = await prisma.manufacturer.create({
      data: { name: `Alt Pharma ${testSuffix}` },
    });
    testManufacturerId = mfg.id;

    const comp = await prisma.composition.create({
      data: { displayText: `Alt Composition ${testSuffix}` },
    });
    testCompositionId = comp.id;

    // Create Test Medicines
    const sourceMed = await prisma.medicine.create({
      data: {
        name: `Rantac 150mg ${testSuffix}`,
        compositionId: testCompositionId,
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId: testManufacturerId,
      },
    });
    sourceMedId = sourceMed.id;

    const alt1 = await prisma.medicine.create({
      data: {
        name: `Pantoprazole 40mg ${testSuffix}`,
        compositionId: testCompositionId,
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: true,
        manufacturerId: testManufacturerId,
      },
    });
    altMed1Id = alt1.id;

    const alt2 = await prisma.medicine.create({
      data: {
        name: `Omeprazole 20mg ${testSuffix}`,
        compositionId: testCompositionId,
        form: 'CAPSULE',
        packQuantity: 14,
        packUnit: 'CAPSULE',
        prescriptionRequired: false,
        manufacturerId: testManufacturerId,
      },
    });
    altMed2Id = alt2.id;

    const unrelated = await prisma.medicine.create({
      data: {
        name: `Paracetamol 500mg ${testSuffix}`,
        compositionId: testCompositionId,
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId: testManufacturerId,
      },
    });
    unrelatedMedId = unrelated.id;
  });

  afterAll(async () => {
    try {
      await prisma.notification.deleteMany({
        where: {
          entityType: 'MEDICINE_ALTERNATIVE',
          userId: { in: [adminUserId, employeeUserId] },
        },
      });
      await prisma.medicineAlternative.deleteMany({
        where: {
          sourceMedicineId: sourceMedId,
        },
      });
      await prisma.medicine.deleteMany({
        where: {
          id: { in: [sourceMedId, altMed1Id, altMed2Id, unrelatedMedId] },
        },
      });
      await prisma.composition.delete({ where: { id: testCompositionId } });
      await prisma.manufacturer.delete({ where: { id: testManufacturerId } });
      await prisma.user.deleteMany({
        where: { id: { in: [adminUserId, employeeUserId] } },
      });
    } catch {
      // Ignore cleanup error
    }
  });

  describe('Authorization & Role Enforcement', () => {
    it('rejects unauthenticated requests to list alternatives', async () => {
      const res = await request(app).get('/api/v1/medicine-alternatives');
      expect(res.status).toBe(401);
    });

    it('rejects non-admin (employee) attempts to create alternatives with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/v1/medicine-alternatives')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({
          sourceMedicineId: sourceMedId,
          alternativeMedicineIds: [altMed1Id],
        });

      expect(res.status).toBe(403);
    });

    it('allows non-admin (employee) to view alternatives', async () => {
      const res = await request(app)
        .get('/api/v1/medicine-alternatives')
        .set('Authorization', `Bearer ${employeeToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.alternatives)).toBe(true);
    });
  });

  describe('Validation Rules', () => {
    it('prevents assigning a medicine as an alternative to itself', async () => {
      const res = await request(app)
        .post('/api/v1/medicine-alternatives')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          sourceMedicineId: sourceMedId,
          alternativeMedicineIds: [sourceMedId],
        });

      expect(res.status).toBe(400);
    });

    it('prevents duplicate medicine alternatives in array', async () => {
      const res = await request(app)
        .post('/api/v1/medicine-alternatives')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          sourceMedicineId: sourceMedId,
          alternativeMedicineIds: [altMed1Id, altMed1Id],
        });

      expect(res.status).toBe(400);
    });

    it('prevents empty alternativeMedicineIds', async () => {
      const res = await request(app)
        .post('/api/v1/medicine-alternatives')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          sourceMedicineId: sourceMedId,
          alternativeMedicineIds: [],
        });

      expect(res.status).toBe(400);
    });
  });

  describe('Create, List, Update, Delete Lifecycle', () => {
    it('allows admin to create approved alternatives and generates notifications', async () => {
      const res = await request(app)
        .post('/api/v1/medicine-alternatives')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          sourceMedicineId: sourceMedId,
          alternativeMedicineIds: [altMed1Id, altMed2Id],
        });

      expect(res.status).toBe(201);
      expect(res.body.alternative).toBeDefined();
      expect(res.body.alternative.sourceMedicine.id).toBe(sourceMedId);
      expect(res.body.alternative.alternatives).toHaveLength(2);

      // Verify notifications generated for active users (both admin and employee)
      const notifs = await prisma.notification.findMany({
        where: {
          entityType: 'MEDICINE_ALTERNATIVE',
          type: 'MEDICINE_ALTERNATIVE_CREATED',
          userId: { in: [adminUserId, employeeUserId] },
        },
      });
      expect(notifs.length).toBeGreaterThanOrEqual(2);
      expect(notifs[0]?.priority).toBe('UPDATE');
      expect(notifs[0]?.title).toBe('Medicine Alternative Added');
    });

    it('prevents creating duplicate alternative group for same source medicine with 409 Conflict', async () => {
      const res = await request(app)
        .post('/api/v1/medicine-alternatives')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          sourceMedicineId: sourceMedId,
          alternativeMedicineIds: [altMed1Id],
        });

      expect(res.status).toBe(409);
    });

    it('lists alternatives and supports search filtering', async () => {
      const res = await request(app)
        .get(`/api/v1/medicine-alternatives?search=Rantac`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.alternatives.length).toBeGreaterThanOrEqual(1);
      const match = res.body.alternatives.find(
        (g: { sourceMedicine: { id: string } }) => g.sourceMedicine.id === sourceMedId,
      );
      expect(match).toBeDefined();
      expect(match.alternatives).toHaveLength(2);

      // Search by alternative name
      const resAlt = await request(app)
        .get(`/api/v1/medicine-alternatives?search=Pantoprazole`)
        .set('Authorization', `Bearer ${employeeToken}`);

      expect(resAlt.status).toBe(200);
      const altMatch = resAlt.body.alternatives.find(
        (g: { sourceMedicine: { id: string } }) => g.sourceMedicine.id === sourceMedId,
      );
      expect(altMatch).toBeDefined();
    });

    it('gets alternative status by medicine ID', async () => {
      // Check source medicine
      const resSource = await request(app)
        .get(`/api/v1/medicine-alternatives/by-medicine/${sourceMedId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(resSource.status).toBe(200);
      expect(resSource.body.doNotUse).toBeDefined();
      expect(resSource.body.doNotUse.sourceMedicine.id).toBe(sourceMedId);
      expect(resSource.body.doNotUse.alternatives).toHaveLength(2);

      // Check target medicine
      const resTarget = await request(app)
        .get(`/api/v1/medicine-alternatives/by-medicine/${altMed1Id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(resTarget.status).toBe(200);
      expect(resTarget.body.isAlternativeFor).toHaveLength(1);
      expect(resTarget.body.isAlternativeFor[0].sourceMedicineId).toBe(sourceMedId);
    });

    it('allows admin to update alternatives for a source medicine', async () => {
      // Update to only have altMed1Id
      const res = await request(app)
        .put(`/api/v1/medicine-alternatives/${sourceMedId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          alternativeMedicineIds: [altMed1Id],
        });

      expect(res.status).toBe(200);
      expect(res.body.alternative.alternatives).toHaveLength(1);
      expect(res.body.alternative.alternatives[0].medicine.id).toBe(altMed1Id);

      // Verify update notification
      const updateNotifs = await prisma.notification.findMany({
        where: {
          entityType: 'MEDICINE_ALTERNATIVE',
          type: 'MEDICINE_ALTERNATIVE_UPDATED',
          userId: { in: [adminUserId, employeeUserId] },
        },
      });
      expect(updateNotifs.length).toBeGreaterThanOrEqual(2);
    });

    it('rejects employee from updating alternatives with 403 Forbidden', async () => {
      const res = await request(app)
        .put(`/api/v1/medicine-alternatives/${sourceMedId}`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({
          alternativeMedicineIds: [altMed2Id],
        });

      expect(res.status).toBe(403);
    });

    it('rejects employee from deleting alternatives with 403 Forbidden', async () => {
      const res = await request(app)
        .delete(`/api/v1/medicine-alternatives/${sourceMedId}`)
        .set('Authorization', `Bearer ${employeeToken}`);

      expect(res.status).toBe(403);
    });

    it('allows admin to delete alternatives for a source medicine', async () => {
      const res = await request(app)
        .delete(`/api/v1/medicine-alternatives/${sourceMedId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify delete notification
      const delNotifs = await prisma.notification.findMany({
        where: {
          entityType: 'MEDICINE_ALTERNATIVE',
          type: 'MEDICINE_ALTERNATIVE_DELETED',
          userId: { in: [adminUserId, employeeUserId] },
        },
      });
      expect(delNotifs.length).toBeGreaterThanOrEqual(2);

      // Verify it's no longer listed
      const resList = await request(app)
        .get(`/api/v1/medicine-alternatives`)
        .set('Authorization', `Bearer ${adminToken}`);

      const exists = resList.body.alternatives.some(
        (g: { sourceMedicine: { id: string } }) => g.sourceMedicine.id === sourceMedId,
      );
      expect(exists).toBe(false);
    });
  });
});
