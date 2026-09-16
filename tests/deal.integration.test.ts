import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { signAccessToken } from '../src/modules/auth/jwt.js';

describe('Medicine Deals Integration Tests', () => {
  let authToken: string;
  let userId: string;

  let testManufacturerId: string;
  let testCompositionId: string;
  let testMrId: string;
  let testMedicineId: string;
  let testMedicine2Id: string;

  const testSuffix = Date.now().toString().slice(-6);

  beforeAll(async () => {
    const passwordHash = await argon2.hash('TestPassword123');

    const user = await prisma.user.create({
      data: {
        name: `Deal Admin ${testSuffix}`,
        email: `deal-admin-${testSuffix}@example.com`,
        phone: `+9199${testSuffix.padStart(8, '0')}`,
        passwordHash,
        role: 'ADMIN',
        active: true,
      },
    });
    userId = user.id;

    authToken = await signAccessToken({
      userId,
      email: user.email!,
      role: 'ADMIN',
    });

    const mfg = await prisma.manufacturer.create({
      data: { name: `Deal Pharma ${testSuffix}` },
    });
    testManufacturerId = mfg.id;

    const comp = await prisma.composition.create({
      data: { displayText: `Amoxicillin ${testSuffix}mg` },
    });
    testCompositionId = comp.id;

    const mr = await prisma.mR.create({
      data: {
        name: `Suresh Sharma ${testSuffix}`,
        company: `Sun Pharma ${testSuffix}`,
        phone: '+919876543210',
        email: `suresh-${testSuffix}@sunpharma.com`,
      },
    });
    testMrId = mr.id;

    const med1 = await prisma.medicine.create({
      data: {
        name: `Augmentin 625 Duo ${testSuffix}`,
        compositionId: testCompositionId,
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: true,
        manufacturerId: testManufacturerId,
        mrId: testMrId,
      },
    });
    testMedicineId = med1.id;

    const med2 = await prisma.medicine.create({
      data: {
        name: `Azithral 500mg ${testSuffix}`,
        compositionId: testCompositionId,
        form: 'TABLET',
        packQuantity: 5,
        packUnit: 'TABLET',
        prescriptionRequired: true,
        manufacturerId: testManufacturerId,
        mrId: testMrId,
      },
    });
    testMedicine2Id = med2.id;
  });

  afterAll(async () => {
    try {
      await prisma.deal.deleteMany({
        where: {
          medicineId: { in: [testMedicineId, testMedicine2Id] },
        },
      });
      await prisma.medicine.deleteMany({
        where: { id: { in: [testMedicineId, testMedicine2Id] } },
      });
      await prisma.mR.delete({ where: { id: testMrId } });
      await prisma.composition.delete({ where: { id: testCompositionId } });
      await prisma.manufacturer.delete({ where: { id: testManufacturerId } });
      await prisma.user.delete({ where: { id: userId } });
    } catch {
      // Ignore cleanup error
    }
  });

  it('rejects unauthenticated requests with 401', async () => {
    const response = await request(app).get('/api/v1/deals');
    expect(response.status).toBe(401);
  });

  it('rejects non-admin (EMPLOYEE) requests with 403', async () => {
    const employeeToken = await signAccessToken({
      userId,
      email: 'employee@example.com',
      role: 'EMPLOYEE',
    });

    const getRes = await request(app)
      .get('/api/v1/deals')
      .set('Authorization', `Bearer ${employeeToken}`);
    expect(getRes.status).toBe(403);
    expect(getRes.body.error.code).toBe('FORBIDDEN');

    const postRes = await request(app)
      .post('/api/v1/deals')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        medicineId: testMedicineId,
        mrId: testMrId,
        agreedMrp: 100,
        agreedScheme: '10+1',
        agreedBillDiscount: 2,
      });
    expect(postRes.status).toBe(403);
    expect(postRes.body.error.code).toBe('FORBIDDEN');
  });

  it('creates a medicine deal and snapshots commercial terms', async () => {
    const payload = {
      medicineId: testMedicineId,
      mrId: testMrId,
      dealDate: new Date('2026-09-10T10:00:00.000Z').toISOString(),
      agreedMrp: 255.5,
      agreedScheme: '10+3',
      agreedBillDiscount: 5,
      notes: 'Agreed directly with MR at the clinic counter',
    };

    const response = await request(app)
      .post('/api/v1/deals')
      .set('Authorization', `Bearer ${authToken}`)
      .send(payload);

    expect(response.status).toBe(201);
    expect(response.body.deal).toBeDefined();
    expect(response.body.deal.medicineId).toBe(testMedicineId);
    expect(response.body.deal.mrId).toBe(testMrId);
    expect(response.body.deal.agreedMrp).toBe(255.5);
    expect(response.body.deal.agreedScheme).toBe('10+3');
    expect(response.body.deal.agreedBillDiscount).toBe(5);
    expect(response.body.deal.status).toBe('PENDING');
    // Pre-filled MR phone snapshot from MR record
    expect(response.body.deal.mrPhoneSnapshot).toBe('+919876543210');
    expect(response.body.deal.notes).toBe('Agreed directly with MR at the clinic counter');
    expect(response.body.deal.medicine.name).toBe(`Augmentin 625 Duo ${testSuffix}`);
    expect(response.body.deal.mr.name).toBe(`Suresh Sharma ${testSuffix}`);
  });

  it('creates a deal with custom mrPhoneSnapshot and format-normalized scheme', async () => {
    const payload = {
      medicineId: testMedicine2Id,
      mrId: testMrId,
      agreedMrp: 120,
      agreedScheme: { description: '9+1' },
      agreedBillDiscount: 7.5,
      mrPhoneSnapshot: '+919999888877',
      notes: 'Special festival trade scheme',
    };

    const response = await request(app)
      .post('/api/v1/deals')
      .set('Authorization', `Bearer ${authToken}`)
      .send(payload);

    expect(response.status).toBe(201);
    expect(response.body.deal.agreedScheme).toBe('9+1');
    expect(response.body.deal.mrPhoneSnapshot).toBe('+919999888877');
    expect(response.body.deal.agreedBillDiscount).toBe(7.5);
  });

  it('warns when creating a new deal while an existing pending deal is active for the same Medicine + MR', async () => {
    // Attempting to create another deal for testMedicineId with testMrId (which already has a PENDING deal)
    const payload = {
      medicineId: testMedicineId,
      mrId: testMrId,
      agreedMrp: 260,
      agreedScheme: '10+2',
      agreedBillDiscount: 4,
    };

    const response = await request(app)
      .post('/api/v1/deals')
      .set('Authorization', `Bearer ${authToken}`)
      .send(payload);

    expect(response.status).toBe(201);
    expect(response.body.warning).toBeDefined();
    expect(response.body.warning).toContain('An existing pending deal');
  });

  it('checks pending deal via /deals/check-pending endpoint', async () => {
    const response = await request(app)
      .get(`/api/v1/deals/check-pending?medicineId=${testMedicineId}&mrId=${testMrId}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(response.status).toBe(200);
    expect(response.body.hasPendingDeal).toBe(true);
    expect(response.body.deal).toBeDefined();
  });

  it('preserves historical commercial terms when medicine details change', async () => {
    // Create deal
    const dealRes = await request(app)
      .post('/api/v1/deals')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        medicineId: testMedicineId,
        mrId: testMrId,
        agreedMrp: 300,
        agreedScheme: '12+2',
        agreedBillDiscount: 8,
      });

    const dealId = dealRes.body.deal.id;

    // Mutate the medicine name or simulate medicine commercial updates
    await prisma.medicine.update({
      where: { id: testMedicineId },
      data: { name: `Augmentin 625 Duo RENAMED ${testSuffix}` },
    });

    // Fetch the deal: commercial snapshot must be strictly identical
    const fetchRes = await request(app)
      .get(`/api/v1/deals/${dealId}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(fetchRes.status).toBe(200);
    expect(fetchRes.body.deal.agreedMrp).toBe(300);
    expect(fetchRes.body.deal.agreedScheme).toBe('12+2');
    expect(fetchRes.body.deal.agreedBillDiscount).toBe(8);
  });

  it('lists deals with filtering, summary counters, and pagination', async () => {
    const response = await request(app)
      .get(`/api/v1/deals?medicineId=${testMedicineId}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.deals)).toBe(true);
    expect(response.body.pagination).toBeDefined();
    expect(response.body.summary).toBeDefined();
    expect(response.body.summary.total).toBeGreaterThanOrEqual(1);
    expect(response.body.summary.pending).toBeGreaterThanOrEqual(1);
  });

  it('updates deal details and updates status to RECEIVED', async () => {
    // Create a new deal to update
    const createRes = await request(app)
      .post('/api/v1/deals')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        medicineId: testMedicine2Id,
        mrId: testMrId,
        agreedMrp: 150,
        agreedScheme: '10+1',
        agreedBillDiscount: 6,
      });

    const dealId = createRes.body.deal.id;

    // Update fields
    const patchRes = await request(app)
      .patch(`/api/v1/deals/${dealId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        agreedScheme: '10+2',
        notes: 'Revised scheme upon delivery negotiation',
      });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.deal.agreedScheme).toBe('10+2');
    expect(patchRes.body.deal.notes).toBe('Revised scheme upon delivery negotiation');

    // Update status to RECEIVED via status endpoint
    const statusRes = await request(app)
      .patch(`/api/v1/deals/${dealId}/status`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ status: 'RECEIVED' });

    expect(statusRes.status).toBe(200);
    expect(statusRes.body.deal.status).toBe('RECEIVED');
  });

  it('validates financial fields and rejects invalid data', async () => {
    // Negative MRP
    const res1 = await request(app)
      .post('/api/v1/deals')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        medicineId: testMedicineId,
        mrId: testMrId,
        agreedMrp: -50,
        agreedScheme: '10+1',
        agreedBillDiscount: 5,
      });
    expect(res1.status).toBe(400);

    // MRP with > 2 decimals
    const res2 = await request(app)
      .post('/api/v1/deals')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        medicineId: testMedicineId,
        mrId: testMrId,
        agreedMrp: 25.123,
        agreedScheme: '10+1',
        agreedBillDiscount: 5,
      });
    expect(res2.status).toBe(400);

    // Discount > 100
    const res3 = await request(app)
      .post('/api/v1/deals')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        medicineId: testMedicineId,
        mrId: testMrId,
        agreedMrp: 100,
        agreedScheme: '10+1',
        agreedBillDiscount: 150,
      });
    expect(res3.status).toBe(400);
  });

  it('deletes a deal without deleting the associated Medicine or MR', async () => {
    const createRes = await request(app)
      .post('/api/v1/deals')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        medicineId: testMedicine2Id,
        mrId: testMrId,
        agreedMrp: 99,
        agreedScheme: '5+1',
        agreedBillDiscount: 3,
      });

    const dealId = createRes.body.deal.id;

    // Delete the deal
    const delRes = await request(app)
      .delete(`/api/v1/deals/${dealId}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(delRes.status).toBe(200);

    // Confirm deal is gone
    const fetchRes = await request(app)
      .get(`/api/v1/deals/${dealId}`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(fetchRes.status).toBe(404);

    // Confirm Medicine and MR STILL EXIST in DB!
    const medCheck = await prisma.medicine.findUnique({
      where: { id: testMedicine2Id },
    });
    expect(medCheck).not.toBeNull();

    const mrCheck = await prisma.mR.findUnique({
      where: { id: testMrId },
    });
    expect(mrCheck).not.toBeNull();
  });
});
