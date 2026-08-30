import { $Enums } from '@prisma/client/index';
import argon2 from 'argon2';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

type TokenPair = { admin: string; employee: string };

const password = 'Test-password-123!';
let sequence = 0;
const unique = (prefix: string): string => `${prefix}-${Date.now()}-${sequence++}`;
const phoneSeed = String(Date.now()).slice(-8);
let tokens!: TokenPair;
let manufacturerId: string;

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const login = async (identifier: string, secret = password): Promise<string> => {
  const response = await request(app).post('/api/v1/auth/login').send({ identifier, password: secret });
  expect(response.status).toBe(200);
  return response.body.accessToken;
};

beforeAll(async () => {
  const passwordHash = await argon2.hash(password);
  const adminEmail = `${unique('auto-admin')}@example.com`;
  const adminPhone = `+919${phoneSeed}81`;
  const empEmail = `${unique('auto-emp')}@example.com`;
  const empPhone = `+919${phoneSeed}82`;

  await prisma.user.createMany({
    data: [
      { name: 'Auto Admin', email: adminEmail, phone: adminPhone, passwordHash, role: $Enums.UserRole.ADMIN, active: true },
      { name: 'Auto Employee', email: empEmail, phone: empPhone, passwordHash, role: $Enums.UserRole.EMPLOYEE, active: true },
    ],
  });

  const manufacturer = await prisma.manufacturer.create({
    data: { name: unique('AutoMfg'), active: true },
  });
  manufacturerId = manufacturer.id;

  tokens = {
    admin: await login(adminEmail),
    employee: await login(empEmail),
  };
});

describe('Automatic Salt Management Tests (Section 24)', () => {
  it('1. Existing salt is reused when creating a medicine', async () => {
    const saltName = unique('ExistingSalt');
    const createSaltRes = await request(app)
      .post('/api/v1/salts')
      .set(auth(tokens.admin))
      .send({ name: saltName, description: 'Pre-existing salt' });
    expect(createSaltRes.status).toBe(201);
    const existingSaltId = createSaltRes.body.salt.id;

    // Create medicine using the exact same salt name
    const medRes = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('MedWithExistingSalt'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        salts: [{ name: saltName, amount: 500, unit: 'MG' }],
      });
    expect(medRes.status).toBe(201);

    // Verify composition salts link to existing salt ID
    const compId = medRes.body.medicine.composition.id;
    const comp = await prisma.composition.findUnique({
      where: { id: compId },
      include: {
        compositionSaltLinks: {
          include: { compositionSalt: true },
        },
      },
    });
    expect(comp).not.toBeNull();
    expect(comp?.compositionSaltLinks[0].compositionSalt.saltId).toBe(existingSaltId);
  });

  it('2. New salt is automatically created when registering a medicine', async () => {
    const novelSaltName = unique('NovelBioSalt');

    // Confirm it does not exist in DB yet
    const beforeCheck = await prisma.salt.findFirst({
      where: { name: { equals: novelSaltName, mode: 'insensitive' } },
    });
    expect(beforeCheck).toBeNull();

    const medRes = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('MedWithNovelSalt'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        salts: [{ name: novelSaltName, amount: 100, unit: 'MG' }],
      });
    expect(medRes.status).toBe(201);

    // Verify novel salt record was created in DB
    const afterCheck = await prisma.salt.findFirst({
      where: { name: { equals: novelSaltName, mode: 'insensitive' } },
    });
    expect(afterCheck).not.toBeNull();
    expect(afterCheck?.name).toBe(novelSaltName);
    expect(afterCheck?.active).toBe(true);
  });

  it('3. Case differences do not create duplicate salts', async () => {
    const baseName = `Paracetamol_${unique('Case')}`;
    const lowerName = baseName.toLowerCase();
    const upperName = baseName.toUpperCase();

    // 1st Medicine with original casing
    const med1Res = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('MedCase1'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        salts: [{ name: baseName, amount: 500, unit: 'MG' }],
      });
    expect(med1Res.status).toBe(201);

    // 2nd Medicine with lowercase
    const med2Res = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('MedCase2'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        salts: [{ name: lowerName, amount: 500, unit: 'MG' }],
      });
    expect(med2Res.status).toBe(201);

    // 3rd Medicine with uppercase
    const med3Res = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('MedCase3'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        salts: [{ name: upperName, amount: 500, unit: 'MG' }],
      });
    expect(med3Res.status).toBe(201);

    // Verify in DB only 1 salt record exists for this name
    const allMatching = await prisma.salt.findMany({
      where: { name: { equals: baseName, mode: 'insensitive' } },
    });
    expect(allMatching).toHaveLength(1);
  });

  it('4. Whitespace differences do not create duplicate salts', async () => {
    const baseName = `Amlodipine_${unique('Space')}`;

    // 1st Medicine with base name
    const med1Res = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('MedSpace1'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        salts: [{ name: baseName, amount: 5, unit: 'MG' }],
      });
    expect(med1Res.status).toBe(201);

    // 2nd Medicine with leading and trailing whitespace
    const med2Res = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('MedSpace2'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        salts: [{ name: `   ${baseName}   `, amount: 5, unit: 'MG' }],
      });
    expect(med2Res.status).toBe(201);

    const allMatching = await prisma.salt.findMany({
      where: { name: { equals: baseName, mode: 'insensitive' } },
    });
    expect(allMatching).toHaveLength(1);
  });

  it('5. Similar-but-different salt names are not incorrectly merged', async () => {
    const saltA = `Amoxicillin_${unique('Diff')}`;
    const saltB = `Ampicillin_${unique('Diff')}`;

    const medARes = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('MedDiffA'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        salts: [{ name: saltA, amount: 500, unit: 'MG' }],
      });
    expect(medARes.status).toBe(201);

    const medBRes = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('MedDiffB'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        salts: [{ name: saltB, amount: 500, unit: 'MG' }],
      });
    expect(medBRes.status).toBe(201);

    const recordA = await prisma.salt.findFirst({ where: { name: saltA } });
    const recordB = await prisma.salt.findFirst({ where: { name: saltB } });
    expect(recordA).not.toBeNull();
    expect(recordB).not.toBeNull();
    expect(recordA?.id).not.toBe(recordB?.id);
  });

  it('6. Multiple salts are supported in a single medicine', async () => {
    const salt1 = `Paracetamol_${unique('Multi')}`;
    const salt2 = `Caffeine_${unique('Multi')}`;

    const medRes = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('MedMultiSalt'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        salts: [
          { name: salt1, amount: 500, unit: 'MG' },
          { name: salt2, amount: 65, unit: 'MG' },
        ],
      });
    expect(medRes.status).toBe(201);
    expect(medRes.body.medicine.composition.displayText).toContain('500');
    expect(medRes.body.medicine.composition.displayText).toContain('65');

    const comp = await prisma.composition.findUnique({
      where: { id: medRes.body.medicine.composition.id },
      include: { compositionSaltLinks: { include: { compositionSalt: { include: { salt: true } } } } },
    });
    expect(comp?.compositionSaltLinks).toHaveLength(2);
  });

  it('7. Strength is stored correctly in composition relationship', async () => {
    const saltName = `Diclofenac_${unique('Strength')}`;
    const medRes = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('MedStrength'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        salts: [{ name: saltName, amount: 75.5, unit: 'MG' }],
      });
    expect(medRes.status).toBe(201);

    const comp = await prisma.composition.findUnique({
      where: { id: medRes.body.medicine.composition.id },
      include: { compositionSaltLinks: { include: { compositionSalt: true } } },
    });
    expect(Number(comp?.compositionSaltLinks[0].compositionSalt.amount)).toBe(75.5);
    expect(comp?.compositionSaltLinks[0].compositionSalt.unit).toBe('MG');
  });

  it('8. Different strengths of the same salt reuse the same Salt record', async () => {
    const saltName = `Metoprolol_${unique('DiffStr')}`;

    const med1Res = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('MedStr25'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        salts: [{ name: saltName, amount: 25, unit: 'MG' }],
      });
    expect(med1Res.status).toBe(201);

    const med2Res = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('MedStr50'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        salts: [{ name: saltName, amount: 50, unit: 'MG' }],
      });
    expect(med2Res.status).toBe(201);

    // Only 1 Salt record
    const salts = await prisma.salt.findMany({ where: { name: { equals: saltName, mode: 'insensitive' } } });
    expect(salts).toHaveLength(1);

    // 2 different Compositions
    expect(med1Res.body.medicine.composition.id).not.toBe(med2Res.body.medicine.composition.id);
  });
});

describe('Composition Resolution Tests (Section 25)', () => {
  it('1. New single-salt composition is created', async () => {
    const saltName = `Cefixime_${unique('SingleComp')}`;
    const medRes = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('MedCefixime'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        salts: [{ name: saltName, amount: 200, unit: 'MG' }],
      });
    expect(medRes.status).toBe(201);
    expect(medRes.body.medicine.composition.id).toBeDefined();
    expect(medRes.body.medicine.composition.displayText).toContain('Cefixime');
  });

  it('2. Existing composition is reused for identical single salt + strength', async () => {
    const saltName = `Azithromycin_${unique('ReuseComp')}`;
    const med1Res = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('MedAzithro1'),
        form: 'TABLET',
        packQuantity: 3,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        salts: [{ name: saltName, amount: 500, unit: 'MG' }],
      });
    expect(med1Res.status).toBe(201);

    const med2Res = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('MedAzithro2'),
        form: 'TABLET',
        packQuantity: 6,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        salts: [{ name: saltName, amount: 500, unit: 'MG' }],
      });
    expect(med2Res.status).toBe(201);
    expect(med2Res.body.medicine.composition.id).toBe(med1Res.body.medicine.composition.id);
  });

  it('3. Multiple-salt composition is created', async () => {
    const saltA = `Amox_${unique('MultiComp')}`;
    const saltB = `Clav_${unique('MultiComp')}`;

    const medRes = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('MedAugmentin'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        salts: [
          { name: saltA, amount: 500, unit: 'MG' },
          { name: saltB, amount: 125, unit: 'MG' },
        ],
      });
    expect(medRes.status).toBe(201);
    expect(medRes.body.medicine.composition.displayText).toContain('500');
    expect(medRes.body.medicine.composition.displayText).toContain('125');
  });

  it('4. Composition ordering does not matter (order-agnostic reuse)', async () => {
    const saltA = `Amlodipine_${unique('Order')}`;
    const saltB = `Atorvastatin_${unique('Order')}`;

    // Order 1: Amlodipine 5mg + Atorvastatin 10mg
    const med1Res = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('MedOrder1'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        salts: [
          { name: saltA, amount: 5, unit: 'MG' },
          { name: saltB, amount: 10, unit: 'MG' },
        ],
      });
    expect(med1Res.status).toBe(201);
    const comp1Id = med1Res.body.medicine.composition.id;

    // Order 2: Atorvastatin 10mg + Amlodipine 5mg
    const med2Res = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('MedOrder2'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        salts: [
          { name: saltB, amount: 10, unit: 'MG' },
          { name: saltA, amount: 5, unit: 'MG' },
        ],
      });
    expect(med2Res.status).toBe(201);
    const comp2Id = med2Res.body.medicine.composition.id;

    // Must resolve to the exact same composition!
    expect(comp2Id).toBe(comp1Id);
  });

  it('5. Different strengths create different compositions', async () => {
    const saltA = `Amlodipine_${unique('StrDiff')}`;
    const saltB = `Atorvastatin_${unique('StrDiff')}`;

    // Amlodipine 5mg + Atorvastatin 10mg
    const med1Res = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('MedStrDiff1'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        salts: [
          { name: saltA, amount: 5, unit: 'MG' },
          { name: saltB, amount: 10, unit: 'MG' },
        ],
      });
    expect(med1Res.status).toBe(201);

    // Amlodipine 10mg + Atorvastatin 10mg (different strength for Amlodipine)
    const med2Res = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('MedStrDiff2'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        salts: [
          { name: saltA, amount: 10, unit: 'MG' },
          { name: saltB, amount: 10, unit: 'MG' },
        ],
      });
    expect(med2Res.status).toBe(201);

    expect(med1Res.body.medicine.composition.id).not.toBe(med2Res.body.medicine.composition.id);
  });

  it('6. Same salts + same strengths reuse the same composition across multiple medicines', async () => {
    const saltA = `Telmisartan_${unique('Same')}`;
    const saltB = `Hydrochlorothiazide_${unique('Same')}`;

    const med1Res = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('MedSame1'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        salts: [
          { name: saltA, amount: 40, unit: 'MG' },
          { name: saltB, amount: 12.5, unit: 'MG' },
        ],
      });
    expect(med1Res.status).toBe(201);

    const med2Res = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('MedSame2'),
        form: 'TABLET',
        packQuantity: 30,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        salts: [
          { name: saltA, amount: 40, unit: 'MG' },
          { name: saltB, amount: 12.5, unit: 'MG' },
        ],
      });
    expect(med2Res.status).toBe(201);
    expect(med1Res.body.medicine.composition.id).toBe(med2Res.body.medicine.composition.id);
  });

  it('7. Duplicate salt entries in the same submission are rejected', async () => {
    const saltName = `DuplicateSalt_${unique('Dup')}`;
    const res = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('MedDupSalt'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        salts: [
          { name: saltName, amount: 500, unit: 'MG' },
          { name: saltName, amount: 500, unit: 'MG' },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('Medicine Creation Tests (Section 26)', () => {
  it('1. Medicine with one existing salt', async () => {
    const salt = await prisma.salt.create({
      data: { name: unique('OneExist'), active: true },
    });

    const res = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('MedOneExist'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        salts: [{ saltId: salt.id, amount: 100, unit: 'MG' }],
      });
    expect(res.status).toBe(201);
    expect(res.body.medicine.composition.displayText).toContain('100');
  });

  it('2. Medicine with one new salt', async () => {
    const newName = unique('OneNewSalt');
    const res = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('MedOneNew'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        salts: [{ name: newName, amount: 250, unit: 'MG' }],
      });
    expect(res.status).toBe(201);
    expect(res.body.medicine.composition.displayText).toContain(newName);
  });

  it('3. Medicine with multiple existing salts', async () => {
    const salt1 = await prisma.salt.create({ data: { name: unique('Exist1'), active: true } });
    const salt2 = await prisma.salt.create({ data: { name: unique('Exist2'), active: true } });

    const res = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('MedMultiExist'),
        form: 'CAPSULE',
        packQuantity: 10,
        packUnit: 'CAPSULE',
        prescriptionRequired: false,
        manufacturerId,
        salts: [
          { saltId: salt1.id, amount: 250, unit: 'MG' },
          { saltId: salt2.id, amount: 50, unit: 'MG' },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.medicine.composition.displayText).toContain('250');
    expect(res.body.medicine.composition.displayText).toContain('50');
  });

  it('4. Medicine with a mixture of existing and new salts', async () => {
    const existingSalt = await prisma.salt.create({ data: { name: unique('MixExist'), active: true } });
    const newSaltName = unique('MixNew');

    const res = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('MedMix'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        salts: [
          { saltId: existingSalt.id, amount: 500, unit: 'MG' },
          { name: newSaltName, amount: 10, unit: 'MG' },
        ],
      });
    expect(res.status).toBe(201);

    const createdSalt = await prisma.salt.findFirst({ where: { name: newSaltName } });
    expect(createdSalt).not.toBeNull();
  });

  it('5. Medicine creation correctly receives compositionId and returns it in response', async () => {
    const res = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('MedCompIdCheck'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        salts: [{ name: unique('CheckSalt'), amount: 10, unit: 'MG' }],
      });
    expect(res.status).toBe(201);
    expect(res.body.medicine.composition.id).toBeDefined();
    expect(typeof res.body.medicine.composition.id).toBe('string');
    expect(res.body.medicine.composition.displayText).toBeTruthy();
  });

  it('6 & 7. Failed Medicine creation rolls back all newly created records transactionally', async () => {
    const conflictingBarcode = 'BC-' + unique('ROLLBACK');
    const existingMed = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('ExistingMedBarcode'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        barcode: conflictingBarcode,
        prescriptionRequired: false,
        manufacturerId,
        salts: [{ name: unique('RollbackBaseSalt'), amount: 100, unit: 'MG' }],
      });
    expect(existingMed.status).toBe(201);

    const novelSaltName = unique('RollbackNovelSalt');

    // Attempt creation with duplicate barcode and a novel salt
    const failRes = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('FailingMed'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        barcode: conflictingBarcode, // Collides with existing medicine
        prescriptionRequired: false,
        manufacturerId,
        salts: [{ name: novelSaltName, amount: 200, unit: 'MG' }],
      });
    expect(failRes.status).toBe(409);
    expect(failRes.body.error.code).toBe('DUPLICATE_BARCODE');

    // Verify novel salt record was NOT committed
    const saltCheck = await prisma.salt.findFirst({ where: { name: novelSaltName } });
    expect(saltCheck).toBeNull();
  });

  it('8. Existing Medicine records and relations remain unaffected', async () => {
    const medName = unique('StableMed');
    const medRes = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: medName,
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        salts: [{ name: unique('StableSalt'), amount: 50, unit: 'MG' }],
      });
    expect(medRes.status).toBe(201);
    const medId = medRes.body.medicine.id;

    // Create another unrelated medicine
    await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('OtherMed'),
        form: 'CAPSULE',
        packQuantity: 20,
        packUnit: 'CAPSULE',
        prescriptionRequired: false,
        manufacturerId,
        salts: [{ name: unique('OtherSalt'), amount: 10, unit: 'MG' }],
      });

    // Check first medicine is completely intact
    const verify = await request(app)
      .get(`/api/v1/medicines/${medId}`)
      .set(auth(tokens.employee));
    expect(verify.status).toBe(200);
    expect(verify.body.medicine.name).toBe(medName);
  });
});

describe('Medicine Edit Tests (Section 27)', () => {
  it('1. Change strength on existing medicine resolves/creates new composition', async () => {
    const saltName = `Atorvastatin_${unique('EditStr')}`;
    const createRes = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('MedEditStr'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        salts: [{ name: saltName, amount: 10, unit: 'MG' }],
      });
    expect(createRes.status).toBe(201);
    const medId = createRes.body.medicine.id;
    const initialCompId = createRes.body.medicine.composition.id;

    // Update strength to 20mg
    const updateRes = await request(app)
      .patch(`/api/v1/medicines/${medId}`)
      .set(auth(tokens.admin))
      .send({
        salts: [{ name: saltName, amount: 20, unit: 'MG' }],
      });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.medicine.composition.displayText).toContain('20');
    expect(updateRes.body.medicine.composition.id).not.toBe(initialCompId);
  });

  it('2. Add salt to existing medicine creates multi-salt composition', async () => {
    const salt1 = `Losartan_${unique('AddSalt')}`;
    const salt2 = `Hydrochlorothiazide_${unique('AddSalt')}`;

    const createRes = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('MedAddSalt'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        salts: [{ name: salt1, amount: 50, unit: 'MG' }],
      });
    expect(createRes.status).toBe(201);
    const medId = createRes.body.medicine.id;

    // Add second salt
    const updateRes = await request(app)
      .patch(`/api/v1/medicines/${medId}`)
      .set(auth(tokens.admin))
      .send({
        salts: [
          { name: salt1, amount: 50, unit: 'MG' },
          { name: salt2, amount: 12.5, unit: 'MG' },
        ],
      });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.medicine.composition.displayText).toContain('50');
    expect(updateRes.body.medicine.composition.displayText).toContain('12.5');
  });

  it('3. Remove salt from existing medicine resolves to reduced composition', async () => {
    const salt1 = `Amox_${unique('RemSalt')}`;
    const salt2 = `Clav_${unique('RemSalt')}`;

    const createRes = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('MedRemSalt'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        salts: [
          { name: salt1, amount: 500, unit: 'MG' },
          { name: salt2, amount: 125, unit: 'MG' },
        ],
      });
    expect(createRes.status).toBe(201);
    const medId = createRes.body.medicine.id;

    // Remove salt2, leaving only salt1
    const updateRes = await request(app)
      .patch(`/api/v1/medicines/${medId}`)
      .set(auth(tokens.admin))
      .send({
        salts: [{ name: salt1, amount: 500, unit: 'MG' }],
      });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.medicine.composition.displayText).toContain('500');
    expect(updateRes.body.medicine.composition.displayText).not.toContain('125');
  });

  it('4 & 5. Reuses existing composition when edited medicine matches existing composition', async () => {
    const saltA = `SaltA_${unique('Match')}`;
    const saltB = `SaltB_${unique('Match')}`;

    // Create Reference Medicine with SaltA (10mg) + SaltB (20mg)
    const refMedRes = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('RefMed'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        salts: [
          { name: saltA, amount: 10, unit: 'MG' },
          { name: saltB, amount: 20, unit: 'MG' },
        ],
      });
    expect(refMedRes.status).toBe(201);
    const targetCompId = refMedRes.body.medicine.composition.id;

    // Create Second Medicine with only SaltA (10mg)
    const secondMedRes = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('SecondMed'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        salts: [{ name: saltA, amount: 10, unit: 'MG' }],
      });
    expect(secondMedRes.status).toBe(201);
    const secondMedId = secondMedRes.body.medicine.id;

    // Edit Second Medicine to have SaltB (20mg) + SaltA (10mg) (different order!)
    const updateRes = await request(app)
      .patch(`/api/v1/medicines/${secondMedId}`)
      .set(auth(tokens.admin))
      .send({
        salts: [
          { name: saltB, amount: 20, unit: 'MG' },
          { name: saltA, amount: 10, unit: 'MG' },
        ],
      });
    expect(updateRes.status).toBe(200);
    // Must reuse the targetCompId
    expect(updateRes.body.medicine.composition.id).toBe(targetCompId);
  });

  it('6, 7 & 8. Old composition and salts remain intact when another medicine removes them', async () => {
    const saltA = `SharedSaltA_${unique('Intact')}`;
    const saltB = `SharedSaltB_${unique('Intact')}`;

    // Med1 has SaltA + SaltB
    const med1Res = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('MedShared1'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        salts: [
          { name: saltA, amount: 10, unit: 'MG' },
          { name: saltB, amount: 20, unit: 'MG' },
        ],
      });
    expect(med1Res.status).toBe(201);
    const sharedCompId = med1Res.body.medicine.composition.id;

    // Med2 also has SaltA + SaltB (shares the composition)
    const med2Res = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('MedShared2'),
        form: 'TABLET',
        packQuantity: 20,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        salts: [
          { name: saltA, amount: 10, unit: 'MG' },
          { name: saltB, amount: 20, unit: 'MG' },
        ],
      });
    expect(med2Res.status).toBe(201);
    expect(med2Res.body.medicine.composition.id).toBe(sharedCompId);

    // Edit Med1 to only have SaltA
    const updateMed1Res = await request(app)
      .patch(`/api/v1/medicines/${med1Res.body.medicine.id}`)
      .set(auth(tokens.admin))
      .send({
        salts: [{ name: saltA, amount: 10, unit: 'MG' }],
      });
    expect(updateMed1Res.status).toBe(200);

    // Verify Med2 still points to sharedCompId
    const checkMed2 = await request(app)
      .get(`/api/v1/medicines/${med2Res.body.medicine.id}`)
      .set(auth(tokens.employee));
    expect(checkMed2.status).toBe(200);
    expect(checkMed2.body.medicine.composition.id).toBe(sharedCompId);

    // Verify SaltB was not deleted
    const checkSaltB = await prisma.salt.findFirst({ where: { name: saltB } });
    expect(checkSaltB).not.toBeNull();
    expect(checkSaltB?.active).toBe(true);
  });
});
