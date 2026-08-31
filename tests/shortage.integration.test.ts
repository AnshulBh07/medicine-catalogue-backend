import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { signAccessToken } from '../src/modules/auth/jwt.js';

describe('Daily Shortage Notebook Integration Tests', () => {
  let adminToken: string;
  let employeeToken: string;
  let adminUserId: string;
  let employeeUserId: string;

  let testManufacturerId: string;
  let testCompositionId: string;
  let testMrId: string;
  let testMedicine1Id: string;
  let testMedicine2Id: string;

  const testSuffix = Date.now().toString();
  const testDate = '2026-08-31';
  const yesterdayDate = '2026-08-30';

  beforeAll(async () => {
    const passwordHash = await argon2.hash('TestPassword123');

    // Create Admin User
    const adminUser = await prisma.user.create({
      data: {
        name: `Shortage Admin ${testSuffix}`,
        email: `shortage-admin-${testSuffix}@example.com`,
        phone: `+9198000${testSuffix.slice(-5)}`,
        passwordHash,
        role: 'ADMIN',
        active: true,
      },
    });
    adminUserId = adminUser.id;

    // Create Employee User
    const employeeUser = await prisma.user.create({
      data: {
        name: `Rahul Kumar ${testSuffix}`,
        email: `rahul-${testSuffix}@example.com`,
        phone: `+9198111${testSuffix.slice(-5)}`,
        passwordHash,
        role: 'EMPLOYEE',
        active: true,
      },
    });
    employeeUserId = employeeUser.id;

    adminToken = await signAccessToken({
      userId: adminUserId,
      email: adminUser.email!,
      role: 'ADMIN',
    });

    employeeToken = await signAccessToken({
      userId: employeeUserId,
      email: employeeUser.email!,
      role: 'EMPLOYEE',
    });

    // Create Manufacturer
    const manufacturer = await prisma.manufacturer.create({
      data: {
        name: `Cipla Shortage Ltd ${testSuffix}`,
      },
    });
    testManufacturerId = manufacturer.id;

    // Create MR
    const mr = await prisma.mR.create({
      data: {
        name: `Ravi Kumar MR ${testSuffix}`,
        company: `Cipla Shortage Ltd ${testSuffix}`,
        phone: '+919876543210',
        email: `mr-${testSuffix}@example.com`,
      },
    });
    testMrId = mr.id;

    // Create Composition & Salt
    const salt = await prisma.salt.create({
      data: {
        name: `Amoxicillin Salt ${testSuffix}`,
      },
    });

    const composition = await prisma.composition.create({
      data: {
        displayText: `Amoxicillin 500mg ${testSuffix}`,
      },
    });
    testCompositionId = composition.id;

    const compSalt = await prisma.compositionSalt.create({
      data: {
        saltId: salt.id,
        amount: 500,
        unit: 'MG',
      },
    });

    await prisma.compositionCompositionSalt.create({
      data: {
        compositionId: composition.id,
        compositionSaltId: compSalt.id,
      },
    });

    // Create Medicine 1 with MR
    const med1 = await prisma.medicine.create({
      data: {
        name: `Amoxicillin 500mg Capsule ${testSuffix}`,
        compositionId: testCompositionId,
        form: 'CAPSULE',
        packQuantity: 10,
        packUnit: 'CAPSULE',
        manufacturerId: testManufacturerId,
        mrId: testMrId,
        prescriptionRequired: true,
        shortDescription: 'Antibiotic medication',
        active: true,
      },
    });
    testMedicine1Id = med1.id;

    // Create Medicine 2 without MR
    const med2 = await prisma.medicine.create({
      data: {
        name: `Paracetamol 650mg Tablet ${testSuffix}`,
        compositionId: testCompositionId,
        form: 'TABLET',
        packQuantity: 15,
        packUnit: 'TABLET',
        manufacturerId: testManufacturerId,
        prescriptionRequired: false,
        shortDescription: 'Fever and pain relief',
        active: true,
      },
    });
    testMedicine2Id = med2.id;
  });

  afterAll(async () => {
    // Cleanup shortage items
    if (testMedicine1Id || testMedicine2Id) {
      const medIds = [testMedicine1Id, testMedicine2Id].filter(Boolean);
      await prisma.shortageItem.deleteMany({
        where: {
          medicineId: { in: medIds },
        },
      });

      // Cleanup medicines
      await prisma.medicine.deleteMany({
        where: { id: { in: medIds } },
      });
    }

    // Cleanup composition links, salts, compositions
    if (testCompositionId) {
      await prisma.compositionCompositionSalt.deleteMany({
        where: { compositionId: testCompositionId },
      });
      await prisma.composition.deleteMany({
        where: { id: testCompositionId },
      });
    }
    await prisma.compositionSalt.deleteMany({
      where: { salt: { name: `Amoxicillin Salt ${testSuffix}` } },
    });
    await prisma.salt.deleteMany({
      where: { name: `Amoxicillin Salt ${testSuffix}` },
    });

    // Cleanup MR, manufacturer, users
    if (testMrId) {
      await prisma.mR.deleteMany({ where: { id: testMrId } });
    }
    if (testManufacturerId) {
      await prisma.manufacturer.deleteMany({ where: { id: testManufacturerId } });
    }
    const userIds = [adminUserId, employeeUserId].filter(Boolean);
    if (userIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: userIds } },
      });
    }
  });

  describe('Authorization & Access Rules', () => {
    it('1. unauthorized user cannot access shortage endpoints', async () => {
      const response = await request(app).get('/api/v1/shortages');
      expect(response.status).toBe(401);
    });

    it('2. authenticated employee can view daily shortage list', async () => {
      const response = await request(app)
        .get(`/api/v1/shortages?date=${testDate}`)
        .set('Authorization', `Bearer ${employeeToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('date', testDate);
      expect(response.body).toHaveProperty('summary');
      expect(response.body.summary).toEqual({
        total: 0,
        pending: 0,
        ordered: 0,
        completed: 0,
      });
      expect(Array.isArray(response.body.items)).toBe(true);
    });

    it('3. authenticated admin can view daily shortage list', async () => {
      const response = await request(app)
        .get(`/api/v1/shortages?date=${testDate}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('summary');
    });
  });

  describe('Creating Shortage Items', () => {
    it('4. employee can add a medicine to the shortage list with quantity and note', async () => {
      const response = await request(app)
        .post('/api/v1/shortages')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({
          medicineId: testMedicine1Id,
          date: testDate,
          quantity: 10,
          note: 'Urgent order required',
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('message');
      expect(response.body.shortageItem).toMatchObject({
        medicineId: testMedicine1Id,
        date: testDate,
        quantity: 10,
        status: 'PENDING',
        note: 'Urgent order required',
        createdById: employeeUserId,
      });
      expect(response.body.shortageItem.medicine).toMatchObject({
        id: testMedicine1Id,
        name: `Amoxicillin 500mg Capsule ${testSuffix}`,
        form: 'CAPSULE',
      });
      expect(response.body.shortageItem.medicine.manufacturer).toMatchObject({
        id: testManufacturerId,
      });
      expect(response.body.shortageItem.medicine.mr).toMatchObject({
        id: testMrId,
        name: `Ravi Kumar MR ${testSuffix}`,
        phone: '+919876543210',
      });
      expect(response.body.shortageItem.createdBy).toMatchObject({
        id: employeeUserId,
        name: `Rahul Kumar ${testSuffix}`,
      });
    });

    it('5. admin can add a medicine to the shortage list', async () => {
      const response = await request(app)
        .post('/api/v1/shortages')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          medicineId: testMedicine2Id,
          date: testDate,
          quantity: 20,
        });

      expect(response.status).toBe(201);
      expect(response.body.shortageItem.createdById).toBe(adminUserId);
      expect(response.body.shortageItem.medicine.mr).toBeNull();
    });

    it('6. prevents duplicate entry for same medicine on the same date with 409 Conflict', async () => {
      const response = await request(app)
        .post('/api/v1/shortages')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({
          medicineId: testMedicine1Id,
          date: testDate,
          quantity: 5,
        });

      expect(response.status).toBe(409);
      expect(response.body.error.message).toContain('already on the shortage list');
    });

    it('7. validates that quantity must be greater than zero', async () => {
      const response = await request(app)
        .post('/api/v1/shortages')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({
          medicineId: testMedicine1Id,
          date: testDate,
          quantity: 0,
        });

      expect(response.status).toBe(400);
    });

    it('8. validates that medicine must exist', async () => {
      const response = await request(app)
        .post('/api/v1/shortages')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({
          medicineId: '00000000-0000-0000-0000-000000000000',
          date: testDate,
          quantity: 10,
        });

      expect(response.status).toBe(404);
      expect(response.body.error.message).toContain('Medicine not found');
    });

    it('9. rejects creating shortage items for past dates with 400 PAST_DATE_NOT_ALLOWED', async () => {
      const response = await request(app)
        .post('/api/v1/shortages')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({
          medicineId: testMedicine1Id,
          date: yesterdayDate,
          quantity: 15,
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('PAST_DATE_NOT_ALLOWED');
      expect(response.body.error.message).toContain('past dates');
    });

    it('9b. creates shortage item with minimum quantity 1 and custom unit STRIP', async () => {
      // Create another medicine for this test
      const med3 = await prisma.medicine.create({
        data: {
          name: `Azithromycin 500mg ${testSuffix}`,
          compositionId: testCompositionId,
          form: 'TABLET',
          packQuantity: 3,
          packUnit: 'TABLET',
          manufacturerId: testManufacturerId,
          prescriptionRequired: true,
          active: true,
        },
      });

      const response = await request(app)
        .post('/api/v1/shortages')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({
          medicineId: med3.id,
          date: testDate,
          quantity: 1,
          unit: 'STRIP',
        });

      expect(response.status).toBe(201);
      expect(response.body.shortageItem.quantity).toBe(1);
      expect(response.body.shortageItem.unit).toBe('STRIP');

      // Cleanup
      await prisma.shortageItem.deleteMany({ where: { medicineId: med3.id } });
      await prisma.medicine.delete({ where: { id: med3.id } });
    });
  });

  describe('Listing & Filtering Shortage Items', () => {
    it('10. calculates correct summary counts for target date', async () => {
      const response = await request(app)
        .get(`/api/v1/shortages?date=${testDate}`)
        .set('Authorization', `Bearer ${employeeToken}`);

      expect(response.status).toBe(200);
      expect(response.body.summary).toEqual({
        total: 2,
        pending: 2,
        ordered: 0,
        completed: 0,
      });
      expect(response.body.items.length).toBe(2);
    });

    it('11. filters items by search query across medicine name and manufacturer', async () => {
      const response = await request(app)
        .get(`/api/v1/shortages?date=${testDate}&search=Paracetamol`)
        .set('Authorization', `Bearer ${employeeToken}`);

      expect(response.status).toBe(200);
      expect(response.body.items.length).toBe(1);
      expect(response.body.items[0].medicine.name).toContain('Paracetamol');
    });

    it('12. fetches single shortage item by ID', async () => {
      const listResponse = await request(app)
        .get(`/api/v1/shortages?date=${testDate}`)
        .set('Authorization', `Bearer ${employeeToken}`);

      const firstItem = listResponse.body.items[0];

      const itemResponse = await request(app)
        .get(`/api/v1/shortages/${firstItem.id}`)
        .set('Authorization', `Bearer ${employeeToken}`);

      expect(itemResponse.status).toBe(200);
      expect(itemResponse.body.shortageItem).toMatchObject({
        id: firstItem.id,
        medicineId: firstItem.medicineId,
      });
    });
  });

  describe('Updating Shortage Items (Quantity, Status, Note)', () => {
    let itemIdToUpdate: string;

    beforeAll(async () => {
      const list = await request(app)
        .get(`/api/v1/shortages?date=${testDate}`)
        .set('Authorization', `Bearer ${employeeToken}`);
      itemIdToUpdate = list.body.items[0].id;
    });

    it('13. updates shortage quantity and note', async () => {
      const response = await request(app)
        .patch(`/api/v1/shortages/${itemIdToUpdate}`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({
          quantity: 25,
          note: 'Updated: increase quantity to 25 packs',
        });

      expect(response.status).toBe(200);
      expect(response.body.shortageItem.quantity).toBe(25);
      expect(response.body.shortageItem.note).toBe('Updated: increase quantity to 25 packs');
    });

    it('14. transitions status to ORDERED', async () => {
      const response = await request(app)
        .patch(`/api/v1/shortages/${itemIdToUpdate}`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({
          status: 'ORDERED',
        });

      expect(response.status).toBe(200);
      expect(response.body.shortageItem.status).toBe('ORDERED');

      // Verify summary updated
      const summaryResponse = await request(app)
        .get(`/api/v1/shortages?date=${testDate}`)
        .set('Authorization', `Bearer ${employeeToken}`);

      expect(summaryResponse.body.summary.ordered).toBe(1);
      expect(summaryResponse.body.summary.pending).toBe(1);
    });

    it('15. transitions status to COMPLETED', async () => {
      const response = await request(app)
        .patch(`/api/v1/shortages/${itemIdToUpdate}`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({
          status: 'COMPLETED',
        });

      expect(response.status).toBe(200);
      expect(response.body.shortageItem.status).toBe('COMPLETED');

      const summaryResponse = await request(app)
        .get(`/api/v1/shortages?date=${testDate}`)
        .set('Authorization', `Bearer ${employeeToken}`);

      expect(summaryResponse.body.summary.completed).toBe(1);
    });
  });

  describe('MR Dynamic Relationship & Deletion', () => {
    let itemId: string;

    beforeAll(async () => {
      const list = await request(app)
        .get(`/api/v1/shortages?date=${testDate}`)
        .set('Authorization', `Bearer ${employeeToken}`);
      const itemWithMr = list.body.items.find(
        (i: { medicineId: string; id: string }) => i.medicineId === testMedicine1Id,
      );
      itemId = itemWithMr.id;
    });

    it('16. dynamically reflects updated MR phone number without copying data to ShortageItem', async () => {
      // Update MR phone number
      await prisma.mR.update({
        where: { id: testMrId },
        data: { phone: '+919999988888' },
      });

      const response = await request(app)
        .get(`/api/v1/shortages/${itemId}`)
        .set('Authorization', `Bearer ${employeeToken}`);

      expect(response.status).toBe(200);
      expect(response.body.shortageItem.medicine.mr.phone).toBe('+919999988888');
    });

    it('17. deletes a shortage item cleanly', async () => {
      const response = await request(app)
        .delete(`/api/v1/shortages/${itemId}`)
        .set('Authorization', `Bearer ${employeeToken}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('removed successfully');

      // Verify 404 on get
      const getResponse = await request(app)
        .get(`/api/v1/shortages/${itemId}`)
        .set('Authorization', `Bearer ${employeeToken}`);

      expect(getResponse.status).toBe(404);
    });
  });
});