import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { signAccessToken } from '../src/modules/auth/jwt.js';

describe('OCR Medicine Photo Scanner Integration Tests', () => {
  let adminToken: string;
  let adminUserId: string;

  const testSuffix = Date.now().toString();

  beforeAll(async () => {
    const passwordHash = await argon2.hash('TestPassword123');

    const adminUser = await prisma.user.create({
      data: {
        name: `OCR Admin ${testSuffix}`,
        email: `ocr-admin-${testSuffix}@example.com`,
        phone: `+9198000${testSuffix.slice(-5)}`,
        passwordHash,
        role: 'ADMIN',
        active: true,
      },
    });
    adminUserId = adminUser.id;
    adminToken = await signAccessToken({ userId: adminUserId, role: 'ADMIN' });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { id: adminUserId },
    });
  });

  it('1. rejects unauthenticated requests with 401', async () => {
    const res = await request(app)
      .post('/api/v1/ocr/scan-medicine')
      .send({ images: [{ text: 'Dolo 650' }] });

    expect(res.status).toBe(401);
  });

  it('2. extracts medicine fields from single photograph text', async () => {
    const rawPackaging = `
      DOLO 650
      Paracetamol Tablets IP 650 mg
      Micro Labs Limited
      Batch No.: G24019
      Mfg. Date: 03/2024
      Exp. Date: 02/2027
      M.R.P. Rs. 34.15
      Incl. of all taxes
      Strip of 15 Tablets
    `;

    const res = await request(app)
      .post('/api/v1/ocr/scan-medicine')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        images: [{ text: rawPackaging, label: 'front' }],
      });

    expect(res.status).toBe(200);
    expect(res.body.extracted.name).toBe('DOLO 650');
    expect(res.body.extracted.manufacturer).toContain('Micro Labs');
    expect(res.body.extracted.batchNumber).toBe('G24019');
    expect(res.body.extracted.manufacturingDate).toBe('2024-03-01');
    expect(res.body.extracted.expiryDate).toBe('2027-02-28');
    expect(res.body.extracted.mrp).toBe('34.15');
    expect(res.body.extracted.form).toBe('TABLET');
    expect(res.body.extracted.packQuantity).toBe('15');
    expect(res.body.extracted.salts).toEqual([
      { name: 'Paracetamol', amount: '650', unit: 'MG' },
    ]);
    expect(res.body.conflicts).toHaveLength(0);
    expect(res.body.photosProcessed).toBe(1);
  });

  it('3. merges complementary information across multiple photographs', async () => {
    // Photo 1: Front (Brand name, Manufacturer)
    const photo1 = `
      AUGMENTIN 625 DUO
      Amoxycillin and Potassium Clavulanate Tablets IP
      GlaxoSmithKline Pharmaceuticals Ltd
    `;

    // Photo 2: Back (Composition, Active Ingredients)
    const photo2 = `
      Each film coated tablet contains:
      Amoxycillin Trihydrate IP equivalent to Amoxycillin 500 mg
      Potassium Clavulanate Diluted IP equivalent to Clavulanic Acid 125 mg
      Dosage: As directed by the physician.
      Store in a dry place below 25°C.
    `;

    // Photo 3: Side Flap (Batch, Dates, MRP)
    const photo3 = `
      B.No. BT230911
      MFD. 08/2024
      EXP. 07/2026
      M.R.P. Rs. 201.50
      INCL. OF ALL TAXES
      10 Tablets
    `;

    const res = await request(app)
      .post('/api/v1/ocr/scan-medicine')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        images: [
          { text: photo1, label: 'front' },
          { text: photo2, label: 'back' },
          { text: photo3, label: 'side' },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.extracted.name).toBe('AUGMENTIN 625 DUO');
    expect(res.body.extracted.manufacturer).toContain('GlaxoSmithKline');
    expect(res.body.extracted.batchNumber).toBe('BT230911');
    expect(res.body.extracted.manufacturingDate).toBe('2024-08-01');
    expect(res.body.extracted.expiryDate).toBe('2026-07-31');
    expect(res.body.extracted.mrp).toBe('201.50');
    expect(res.body.extracted.packQuantity).toBe('10');
    expect(res.body.extracted.salts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Amoxycillin', amount: '500', unit: 'MG' }),
        expect.objectContaining({ name: 'Clavulanic Acid', amount: '125', unit: 'MG' }),
      ]),
    );
    expect(res.body.conflicts).toHaveLength(0);
    expect(res.body.photosProcessed).toBe(3);
  });

  it('4. detects and flags conflicting values across photographs for review', async () => {
    // Photo 1 has MRP 155.00
    const photo1 = `
      PAN 40
      Pantoprazole Gastro-resistant Tablets IP 40 mg
      Alkem Laboratories Ltd
      M.R.P. Rs. 155.00
      B.No. ALK001
    `;

    // Photo 2 has MRP 165.00 and different Batch ALK002
    const photo2 = `
      PAN 40
      M.R.P. Rs. 165.00
      B.No. ALK002
      EXP. 11/2026
    `;

    const res = await request(app)
      .post('/api/v1/ocr/scan-medicine')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        images: [
          { text: photo1, label: 'photo1' },
          { text: photo2, label: 'photo2' },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.conflicts.length).toBeGreaterThanOrEqual(1);

    const mrpConflict = res.body.conflicts.find((c: { field: string }) => c.field === 'mrp');
    expect(mrpConflict).toBeTruthy();
    expect(mrpConflict.values).toContain('155.00');
    expect(mrpConflict.values).toContain('165.00');

    const batchConflict = res.body.conflicts.find((c: { field: string }) => c.field === 'batchNumber');
    expect(batchConflict).toBeTruthy();
    expect(batchConflict.values).toContain('ALK001');
    expect(batchConflict.values).toContain('ALK002');
  });

  it('5. does not fabricate missing information', async () => {
    const minimalText = `
      CETIRIZINE 10
      Cipla Limited
    `;

    const res = await request(app)
      .post('/api/v1/ocr/scan-medicine')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        images: [{ text: minimalText }],
      });

    expect(res.status).toBe(200);
    expect(res.body.extracted.name).toBe('CETIRIZINE 10');
    expect(res.body.extracted.manufacturer).toBe('Cipla Limited');
    expect(res.body.extracted.mrp).toBeUndefined();
    expect(res.body.extracted.batchNumber).toBeUndefined();
    expect(res.body.extracted.expiryDate).toBeUndefined();
    expect(res.body.extracted.manufacturingDate).toBeUndefined();
  });
});
