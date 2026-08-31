import { $Enums } from '@prisma/client/index';
import argon2 from 'argon2';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

type UserCredentials = { email: string; phone: string; password: string };
type TokenPair = { admin: string; employee: string };

const password = 'Test-password-123!';
let sequence = 0;
const unique = (prefix: string): string => `${prefix}-${Date.now()}-${sequence++}`;
const phoneSeed = String(Date.now()).slice(-8);
const adminUser: UserCredentials = { email: `${unique('admin')}@example.com`, phone: `+919${phoneSeed}11`, password };
const employeeUser: UserCredentials = { email: `${unique('employee')}@example.com`, phone: `+919${phoneSeed}12`, password };
let tokens!: TokenPair;
let manufacturerId: string;
let compositionId: string;

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const login = async (identifier: string, secret = password): Promise<string> => {
  const response = await request(app).post('/api/v1/auth/login').send({ identifier, password: secret });
  expect(response.status).toBe(200);
  return response.body.accessToken;
};

beforeAll(async () => {
  const passwordHash = await argon2.hash(password);
  await prisma.user.createMany({
    data: [
      { name: 'Batch Admin', email: adminUser.email, phone: adminUser.phone, passwordHash, role: $Enums.UserRole.ADMIN, active: true },
      { name: 'Batch Employee', email: employeeUser.email, phone: employeeUser.phone, passwordHash, role: $Enums.UserRole.EMPLOYEE, active: true },
    ],
  });

  const mfg = await prisma.manufacturer.create({ data: { name: unique('BatchMfg'), active: true } });
  manufacturerId = mfg.id;

  const salt = await prisma.salt.create({ data: { name: unique('BatchSalt'), active: true } });
  const compSalt = await prisma.compositionSalt.create({ data: { saltId: salt.id, amount: 500, unit: 'MG' } });
  const comp = await prisma.composition.create({ data: { displayText: `BatchComp ${unique('display')}`, active: true } });
  await prisma.compositionCompositionSalt.create({ data: { compositionId: comp.id, compositionSaltId: compSalt.id } });
  compositionId = comp.id;

  tokens = { admin: await login(adminUser.email), employee: await login(employeeUser.email) };
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Canonical Data Relationship: Manufacturer -> Medicine -> Batch -> CommercialDetails', () => {
  // ==========================================
  // 1. Schema & Model Association Tests
  // ==========================================
  describe('1. Schema & Association Verification', () => {
    it('verifies Batch has CommercialDetails and Cascade Deletion works', async () => {
      // Create medicine
      const medRes = await request(app).post('/api/v1/medicines').set(auth(tokens.admin)).send({
        name: unique('CascadeMed'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        compositionId,
      });
      expect(medRes.status).toBe(201);
      const medId = medRes.body.medicine.id;

      // Create batch with commercial details
      const batchRes = await request(app).post('/api/v1/batches').set(auth(tokens.admin)).send({
        medicineId: medId,
        batchNumber: 'BATCH-CASCADE-01',
        manufacturingDate: '2026-01-01',
        expiryDate: '2028-01-01',
        commercialDetails: {
          mrp: 150.0,
          purchaseRate: 100.0,
          discountPercent: 5.0,
          scheme: { type: 'bonus', value: '10+1' },
          privateNotes: 'Cascade test note',
        },
      });
      expect(batchRes.status).toBe(201);
      const batchId = batchRes.body.batch.id;

      // Direct DB verification: CommercialDetails is linked to batchId
      const dbCommercial = await prisma.commercialDetails.findUnique({
        where: { batchId },
      });
      expect(dbCommercial).not.toBeNull();
      expect(dbCommercial?.batchId).toBe(batchId);
      expect(Number(dbCommercial?.mrp)).toBe(150.0);

      // Delete the Batch via API (DELETE /batches/:id)
      const deleteRes = await request(app).delete(`/api/v1/batches/${batchId}`).set(auth(tokens.admin));
      expect(deleteRes.status).toBe(200);

      // CommercialDetails should be deleted via Cascade
      const deletedCommercial = await prisma.commercialDetails.findUnique({
        where: { batchId },
      });
      expect(deletedCommercial).toBeNull();

      // Medicine should still exist intact
      const dbMed = await prisma.medicine.findUnique({ where: { id: medId } });
      expect(dbMed).not.toBeNull();
      expect(dbMed?.id).toBe(medId);
    });
  });

  // ==========================================
  // 2. Derived Current MRP Tests
  // ==========================================
  describe('2. Derived Current MRP from Latest Batch', () => {
    it('derives MRP correctly from single batch', async () => {
      const medRes = await request(app).post('/api/v1/medicines').set(auth(tokens.admin)).send({
        name: unique('SingleBatchMed'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        compositionId,
        firstBatch: {
          batchNumber: 'BATCH-S-01',
          manufacturingDate: '2026-01-01',
          expiryDate: '2028-01-01',
          mrp: 75.50,
          purchaseRate: 50.0,
        },
      });
      expect(medRes.status).toBe(201);
      expect(medRes.body.medicine.mrp).toBe(75.50);

      // Fetch medicine by ID
      const getRes = await request(app).get(`/api/v1/medicines/${medRes.body.medicine.id}`).set(auth(tokens.admin));
      expect(getRes.status).toBe(200);
      expect(getRes.body.medicine.mrp).toBe(75.50);
    });

    it('derives Current MRP from the most recently CREATED batch (createdAt desc), not expiry date or MRP amount', async () => {
      const medRes = await request(app).post('/api/v1/medicines').set(auth(tokens.admin)).send({
        name: unique('MultiBatchMed'),
        form: 'CAPSULE',
        packQuantity: 10,
        packUnit: 'CAPSULE',
        prescriptionRequired: false,
        manufacturerId,
        compositionId,
      });
      expect(medRes.status).toBe(201);
      const medId = medRes.body.medicine.id;

      // Batch 1: Created first with expiry in 2030, MRP 40
      const b1 = await request(app).post('/api/v1/batches').set(auth(tokens.admin)).send({
        medicineId: medId,
        batchNumber: 'BATCH-A-1',
        manufacturingDate: '2025-01-01',
        expiryDate: '2030-01-01',
        commercialDetails: { mrp: 40.0, purchaseRate: 25.0 },
      });
      expect(b1.status).toBe(201);

      // Verify medicine MRP is 40
      let med = (await request(app).get(`/api/v1/medicines/${medId}`).set(auth(tokens.admin))).body.medicine;
      expect(med.mrp).toBe(40.0);

      // Batch 2: Created second with expiry in 2029 (earlier expiry than Batch 1), MRP 45
      const b2 = await request(app).post('/api/v1/batches').set(auth(tokens.admin)).send({
        medicineId: medId,
        batchNumber: 'BATCH-B-2',
        manufacturingDate: '2025-06-01',
        expiryDate: '2029-06-01',
        commercialDetails: { mrp: 45.0, purchaseRate: 30.0 },
      });
      expect(b2.status).toBe(201);

      // Verify medicine MRP automatically became 45
      med = (await request(app).get(`/api/v1/medicines/${medId}`).set(auth(tokens.admin))).body.medicine;
      expect(med.mrp).toBe(45.0);

      // Batch 3: Created third with MRP 48
      const b3 = await request(app).post('/api/v1/batches').set(auth(tokens.admin)).send({
        medicineId: medId,
        batchNumber: 'BATCH-C-3',
        manufacturingDate: '2026-01-01',
        expiryDate: '2028-01-01',
        commercialDetails: { mrp: 48.0, purchaseRate: 34.0 },
      });
      expect(b3.status).toBe(201);

      // Verify medicine MRP automatically became 48
      med = (await request(app).get(`/api/v1/medicines/${medId}`).set(auth(tokens.admin))).body.medicine;
      expect(med.mrp).toBe(48.0);

      // Verify Batch 1 and Batch 2 commercial details were NOT mutated
      const batch1Db = await prisma.batch.findUnique({
        where: { id: b1.body.batch.id },
        include: { commercialDetails: true },
      });
      expect(Number(batch1Db?.commercialDetails?.mrp)).toBe(40.0);

      const batch2Db = await prisma.batch.findUnique({
        where: { id: b2.body.batch.id },
        include: { commercialDetails: true },
      });
      expect(Number(batch2Db?.commercialDetails?.mrp)).toBe(45.0);
    });

    it('returns null MRP when medicine has no batches or latest batch has no commercials', async () => {
      const medRes = await request(app).post('/api/v1/medicines').set(auth(tokens.admin)).send({
        name: unique('NoBatchMed'),
        form: 'SYRUP',
        packQuantity: 100,
        packUnit: 'ML',
        prescriptionRequired: false,
        manufacturerId,
        compositionId,
      });
      expect(medRes.status).toBe(201);
      expect(medRes.body.medicine.mrp).toBeNull();

      // Add batch without commercial details
      const batchRes = await request(app).post('/api/v1/batches').set(auth(tokens.admin)).send({
        medicineId: medRes.body.medicine.id,
        batchNumber: 'BATCH-NO-COMM-01',
        manufacturingDate: '2026-01-01',
        expiryDate: '2028-01-01',
      });
      expect(batchRes.status).toBe(201);

      const getMed = await request(app).get(`/api/v1/medicines/${medRes.body.medicine.id}`).set(auth(tokens.admin));
      expect(getMed.body.medicine.mrp).toBeNull();
    });
  });

  // ==========================================
  // 3. First-Time Medicine Registration (Atomic Flow)
  // ==========================================
  describe('3. First-Time Medicine Registration Atomicity', () => {
    it('creates Medicine + First Batch + CommercialDetails in a single atomic transaction', async () => {
      const payload = {
        name: unique('AtomicMed'),
        form: 'TABLET',
        packQuantity: 15,
        packUnit: 'TABLET',
        prescriptionRequired: true,
        manufacturerId,
        compositionId,
        firstBatch: {
          batchNumber: 'BATCH-ATOM-001',
          manufacturingDate: '2026-01-01',
          expiryDate: '2028-06-30',
          mrp: 99.50,
          purchaseRate: 65.0,
          discountPercent: 8.5,
          scheme: { freeQuantity: 1, baseQuantity: 10 },
          privateNotes: 'Direct factory shipment',
        },
      };

      const res = await request(app).post('/api/v1/medicines').set(auth(tokens.admin)).send(payload);
      expect(res.status).toBe(201);
      expect(res.body.medicine.mrp).toBe(99.50);

      // Verify in DB that all 3 records were created
      const dbMed = await prisma.medicine.findUnique({
        where: { id: res.body.medicine.id },
        include: {
          batches: {
            include: {
              commercialDetails: true,
            },
          },
        },
      });

      expect(dbMed).not.toBeNull();
      expect(dbMed?.batches.length).toBe(1);
      const batch = dbMed!.batches[0]!;
      expect(batch.batchNumber).toBe('BATCH-ATOM-001');
      expect(batch.commercialDetails).not.toBeNull();
      expect(Number(batch.commercialDetails?.mrp)).toBe(99.50);
      expect(Number(batch.commercialDetails?.purchaseRate)).toBe(65.0);
      expect(Number(batch.commercialDetails?.discountPercent)).toBe(8.5);
      expect(batch.commercialDetails?.privateNotes).toBe('Direct factory shipment');
    });

    it('rolls back entire transaction if first batch date order is invalid (no medicine or batch created)', async () => {
      const medName = unique('RollbackMed');
      const payload = {
        name: medName,
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        compositionId,
        firstBatch: {
          batchNumber: 'BATCH-BAD-DATE',
          manufacturingDate: '2028-01-01',
          expiryDate: '2026-01-01', // Invalid: expiry before manufacturing
          mrp: 50.0,
        },
      };

      const res = await request(app).post('/api/v1/medicines').set(auth(tokens.admin)).send(payload);
      expect(res.status).toBe(400);

      // Verify DB: Medicine was NOT created
      const dbMed = await prisma.medicine.findFirst({ where: { name: medName } });
      expect(dbMed).toBeNull();
    });
  });

  // ==========================================
  // 4. Batch Commercial Details API (Batch-Centric Endpoints)
  // ==========================================
  describe('4. Batch Commercial Details Endpoints (/batches/:batchId/commercial-details)', () => {
    it('allows Admin to GET, POST, and PATCH commercial details directly on a specific batch', async () => {
      // Create medicine and batch without commercial details
      const medRes = await request(app).post('/api/v1/medicines').set(auth(tokens.admin)).send({
        name: unique('BatchCommMed'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        compositionId,
      });
      const medId = medRes.body.medicine.id;

      const batchRes = await request(app).post('/api/v1/batches').set(auth(tokens.admin)).send({
        medicineId: medId,
        batchNumber: 'BATCH-COMM-DIRECT-01',
        manufacturingDate: '2026-01-01',
        expiryDate: '2028-01-01',
      });
      const batchId = batchRes.body.batch.id;

      // GET before creation -> 404
      const get404 = await request(app).get(`/api/v1/batches/${batchId}/commercial-details`).set(auth(tokens.admin));
      expect(get404.status).toBe(404);

      // POST commercial details on batch
      const postRes = await request(app).post(`/api/v1/batches/${batchId}/commercial-details`).set(auth(tokens.admin)).send({
        mrp: 120.0,
        purchaseRate: 80.0,
        discountPercent: 10.0,
        scheme: { desc: '20+2' },
        privateNotes: 'Batch specific commercial details',
      });
      expect(postRes.status).toBe(201);
      expect(postRes.body.commercialDetails.batchId).toBe(batchId);
      expect(postRes.body.commercialDetails.mrp).toBe(120.0);

      // GET after creation -> 200
      const getRes = await request(app).get(`/api/v1/batches/${batchId}/commercial-details`).set(auth(tokens.admin));
      expect(getRes.status).toBe(200);
      expect(getRes.body.commercialDetails.purchaseRate).toBe(80.0);

      // PATCH commercial details on batch
      const patchRes = await request(app).patch(`/api/v1/batches/${batchId}/commercial-details`).set(auth(tokens.admin)).send({
        mrp: 125.0,
        discountPercent: 12.0,
      });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.commercialDetails.mrp).toBe(125.0);
      expect(patchRes.body.commercialDetails.discountPercent).toBe(12.0);
      expect(patchRes.body.commercialDetails.purchaseRate).toBe(80.0);
    });

    it('allows GET /medicines/:medicineId/commercial-details to retrieve latest batch commercials seamlessly', async () => {
      const medRes = await request(app).post('/api/v1/medicines').set(auth(tokens.admin)).send({
        name: unique('MedCommOverview'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        compositionId,
        firstBatch: {
          batchNumber: 'BATCH-OVERVIEW-01',
          manufacturingDate: '2026-01-01',
          expiryDate: '2028-01-01',
          mrp: 180.0,
          purchaseRate: 120.0,
        },
      });
      const medId = medRes.body.medicine.id;

      const overviewRes = await request(app).get(`/api/v1/medicines/${medId}/commercial-details`).set(auth(tokens.admin));
      expect(overviewRes.status).toBe(200);
      expect(overviewRes.body.commercialDetails.mrp).toBe(180.0);
      expect(overviewRes.body.commercialDetails.purchaseRate).toBe(120.0);
      expect(overviewRes.body.commercialDetails.batch.batchNumber).toBe('BATCH-OVERVIEW-01');
    });
  });

  // ==========================================
  // 5. Commercial Protection & Data Leak Prevention
  // ==========================================
  describe('5. Admin vs Employee Authorization & Commercial Protection', () => {
    it('denies Employee access to batch commercial endpoints with 403', async () => {
      const medRes = await request(app).post('/api/v1/medicines').set(auth(tokens.admin)).send({
        name: unique('SecCheckMed'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        compositionId,
        firstBatch: {
          batchNumber: 'BATCH-SEC-01',
          expiryDate: '2028-01-01',
          mrp: 200.0,
          purchaseRate: 130.0,
        },
      });
      const medId = medRes.body.medicine.id;

      const batches = await request(app).get(`/api/v1/batches?medicineId=${medId}`).set(auth(tokens.admin));
      const batchId = batches.body.batches[0].id;

      // Employee GET /batches/:id/commercial-details -> 403
      const empBatchComm = await request(app).get(`/api/v1/batches/${batchId}/commercial-details`).set(auth(tokens.employee));
      expect(empBatchComm.status).toBe(403);

      // Employee GET /medicines/:id/commercial-details -> 403
      const empMedComm = await request(app).get(`/api/v1/medicines/${medId}/commercial-details`).set(auth(tokens.employee));
      expect(empMedComm.status).toBe(403);

      // Unauthenticated -> 401
      const unauth = await request(app).get(`/api/v1/batches/${batchId}/commercial-details`);
      expect(unauth.status).toBe(401);
    });

    it('does NOT leak purchaseRate, privateNotes, or confidential schemes in Employee responses for /medicines or /batches', async () => {
      const secretKeyword = 'SECRET-PURCHASE-RATE-6789.50';
      const secretNote = 'TOP-SECRET-DEALER-TERMS';

      const medRes = await request(app).post('/api/v1/medicines').set(auth(tokens.admin)).send({
        name: unique('LeakCheckMed'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        compositionId,
        firstBatch: {
          batchNumber: 'BATCH-LEAK-01',
          expiryDate: '2028-01-01',
          mrp: 999.0,
          purchaseRate: 6789.50,
          scheme: { confidentialScheme: secretKeyword },
          privateNotes: secretNote,
        },
      });
      const medId = medRes.body.medicine.id;

      const batches = await request(app).get(`/api/v1/batches?medicineId=${medId}`).set(auth(tokens.admin));
      const batchId = batches.body.batches[0].id;

      // Employee views medicine
      const empMed = await request(app).get(`/api/v1/medicines/${medId}`).set(auth(tokens.employee));
      const empMedStr = JSON.stringify(empMed.body);
      expect(empMedStr).not.toContain('6789.50');
      expect(empMedStr).not.toContain(secretKeyword);
      expect(empMedStr).not.toContain(secretNote);
      expect(empMedStr).not.toContain('purchaseRate');

      // Employee views batch
      const empBatch = await request(app).get(`/api/v1/batches/${batchId}`).set(auth(tokens.employee));
      const empBatchStr = JSON.stringify(empBatch.body);
      expect(empBatchStr).not.toContain('6789.50');
      expect(empBatchStr).not.toContain(secretKeyword);
      expect(empBatchStr).not.toContain(secretNote);
      expect(empBatchStr).not.toContain('commercialDetails');
    });
  });

  // ==========================================
  // 6. Financial 2-Decimal Precision & Validation
  // ==========================================
  describe('6. Financial 2-Decimal Precision Validation', () => {
    it('accepts valid 2-decimal financial values and rejects >2 decimals', async () => {
      const medRes = await request(app).post('/api/v1/medicines').set(auth(tokens.admin)).send({
        name: unique('DecimalCheckMed'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        compositionId,
      });
      const medId = medRes.body.medicine.id;

      // Valid 2 decimals (19.99, 55.55, 10.07)
      const validRes = await request(app).post('/api/v1/batches').set(auth(tokens.admin)).send({
        medicineId: medId,
        batchNumber: 'BATCH-VALID-DEC-01',
        manufacturingDate: '2026-01-01',
        expiryDate: '2028-01-01',
        commercialDetails: {
          mrp: 55.55,
          purchaseRate: 19.99,
          discountPercent: 10.07,
        },
      });
      expect(validRes.status).toBe(201);
      expect(validRes.body.batch.commercialDetails.mrp).toBe(55.55);
      expect(validRes.body.batch.commercialDetails.purchaseRate).toBe(19.99);

      // Invalid >2 decimals on MRP
      const invalidMrp = await request(app).post('/api/v1/batches').set(auth(tokens.admin)).send({
        medicineId: medId,
        batchNumber: 'BATCH-INVALID-MRP',
        expiryDate: '2028-01-01',
        commercialDetails: { mrp: 55.555, purchaseRate: 20.0 },
      });
      expect(invalidMrp.status).toBe(400);

      // Invalid >2 decimals on Purchase Rate
      const invalidPurchase = await request(app).post('/api/v1/batches').set(auth(tokens.admin)).send({
        medicineId: medId,
        batchNumber: 'BATCH-INVALID-PR',
        expiryDate: '2028-01-01',
        commercialDetails: { mrp: 50.0, purchaseRate: 19.999 },
      });
      expect(invalidPurchase.status).toBe(400);
    });
  });
});
