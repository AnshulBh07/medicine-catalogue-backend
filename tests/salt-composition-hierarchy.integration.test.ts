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
  const adminEmail = `${unique('hier-admin')}@example.com`;
  const adminPhone = `+919${phoneSeed}71`;
  const empEmail = `${unique('hier-emp')}@example.com`;
  const empPhone = `+919${phoneSeed}72`;

  await prisma.user.createMany({
    data: [
      { name: 'Hier Admin', email: adminEmail, phone: adminPhone, passwordHash, role: $Enums.UserRole.ADMIN, active: true },
      { name: 'Hier Employee', email: empEmail, phone: empPhone, passwordHash, role: $Enums.UserRole.EMPLOYEE, active: true },
    ],
  });

  const manufacturer = await prisma.manufacturer.create({
    data: { name: unique('HierMfg'), active: true },
  });
  manufacturerId = manufacturer.id;

  tokens = {
    admin: await login(adminEmail),
    employee: await login(empEmail),
  };
});

describe('Salt CRUD & Hierarchy Synchronization (Section 30)', () => {
  it('1. Creates Salt with normalized whitespace and active default', async () => {
    const rawName = `   Amlodipine    Besylate   ${unique('Salt')}   `;
    const res = await request(app)
      .post('/api/v1/salts')
      .set(auth(tokens.admin))
      .send({
        name: rawName,
        description: 'Calcium channel blocker API',
      });

    expect(res.status).toBe(201);
    expect(res.body.salt.name).not.toContain('  ');
    expect(res.body.salt.name.startsWith(' ')).toBe(false);
    expect(res.body.salt.name.endsWith(' ')).toBe(false);
    expect(res.body.salt.active).toBe(true);
  });

  it('2. Prevents duplicate Salt creation case-insensitively', async () => {
    const saltName = `Levocetirizine_${unique('Dup')}`;
    const firstRes = await request(app)
      .post('/api/v1/salts')
      .set(auth(tokens.admin))
      .send({ name: saltName });
    expect(firstRes.status).toBe(201);

    const dupRes = await request(app)
      .post('/api/v1/salts')
      .set(auth(tokens.admin))
      .send({ name: saltName.toLowerCase() });
    expect(dupRes.status).toBe(409);
    expect(dupRes.body.error.code).toBe('DUPLICATE_SALT');
  });

  it('3 & 4. Reads and lists Salts with search and dependency counts', async () => {
    const saltName = `Montelukast_${unique('List')}`;
    const createRes = await request(app)
      .post('/api/v1/salts')
      .set(auth(tokens.admin))
      .send({ name: saltName });
    expect(createRes.status).toBe(201);
    const saltId = createRes.body.salt.id;

    const getRes = await request(app)
      .get(`/api/v1/salts/${saltId}`)
      .set(auth(tokens.employee));
    expect(getRes.status).toBe(200);
    expect(getRes.body.salt.id).toBe(saltId);
    expect(getRes.body.salt.compositionsCount).toBe(0);
    expect(getRes.body.salt.medicinesCount).toBe(0);

    const listRes = await request(app)
      .get(`/api/v1/salts?search=${saltName}`)
      .set(auth(tokens.employee));
    expect(listRes.status).toBe(200);
    expect(listRes.body.salts.length).toBeGreaterThanOrEqual(1);
    expect(listRes.body.salts[0].name).toBe(saltName);
  });

  it('5, 6 & 7. Salt update propagates to dependent Compositions and Medicines', async () => {
    const originalSaltName = `Atorvastatin_${unique('Prop')}`;
    const updatedSaltName = `Atorvastatin Calcium Trihydrate_${unique('Prop')}`;

    // Create salt
    const saltRes = await request(app)
      .post('/api/v1/salts')
      .set(auth(tokens.admin))
      .send({ name: originalSaltName });
    expect(saltRes.status).toBe(201);
    const saltId = saltRes.body.salt.id;

    // Create medicine using this salt (generates composition "Atorvastatin_... 10 MG")
    const medRes = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('MedAtorvaProp'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        salts: [{ saltId, amount: 10, unit: 'MG' }],
      });
    expect(medRes.status).toBe(201);
    const medId = medRes.body.medicine.id;
    const compId = medRes.body.medicine.composition.id;
    expect(medRes.body.medicine.composition.displayText).toContain(originalSaltName);

    // Update the Salt name
    const updateSaltRes = await request(app)
      .patch(`/api/v1/salts/${saltId}`)
      .set(auth(tokens.admin))
      .send({ name: updatedSaltName });
    expect(updateSaltRes.status).toBe(200);
    expect(updateSaltRes.body.salt.name).toBe(updatedSaltName);

    // Verify composition displayText is automatically regenerated!
    const compCheck = await request(app)
      .get(`/api/v1/compositions/${compId}`)
      .set(auth(tokens.employee));
    expect(compCheck.status).toBe(200);
    expect(compCheck.body.composition.displayText).toContain(updatedSaltName);
    expect(compCheck.body.composition.displayText).not.toContain(originalSaltName);

    // Verify medicine GET automatically reflects the updated composition displayText!
    const medCheck = await request(app)
      .get(`/api/v1/medicines/${medId}`)
      .set(auth(tokens.employee));
    expect(medCheck.status).toBe(200);
    expect(medCheck.body.medicine.composition.displayText).toContain(updatedSaltName);
  });

  it('8 & 11. Calculates accurate impact report for Salt before modification/deletion', async () => {
    const saltName = `ImpactSalt_${unique('Impact')}`;
    const saltRes = await request(app)
      .post('/api/v1/salts')
      .set(auth(tokens.admin))
      .send({ name: saltName });
    expect(saltRes.status).toBe(201);
    const saltId = saltRes.body.salt.id;

    // Create 2 medicines with 2 different strengths
    await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('ImpactMed1'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        salts: [{ saltId, amount: 20, unit: 'MG' }],
      });

    await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('ImpactMed2'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        salts: [{ saltId, amount: 40, unit: 'MG' }],
      });

    const impactRes = await request(app)
      .get(`/api/v1/salts/${saltId}/impact`)
      .set(auth(tokens.admin));
    expect(impactRes.status).toBe(200);
    expect(impactRes.body.impact.compositionsCount).toBe(2);
    expect(impactRes.body.impact.medicinesCount).toBe(2);
    expect(impactRes.body.impact.compositions).toHaveLength(2);
    expect(impactRes.body.impact.medicines).toHaveLength(2);
  });

  it('9, 10, 11. Prevents deletion of used Salt, preserves database records, and allows hard deletion of unused Salt', async () => {
    // 1. Used salt
    const usedSaltName = `UsedSalt_${unique('Del')}`;
    const createUsedRes = await request(app)
      .post('/api/v1/salts')
      .set(auth(tokens.admin))
      .send({ name: usedSaltName });
    const usedSaltId = createUsedRes.body.salt.id;

    const medRes = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('MedUsingSalt'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        salts: [{ saltId: usedSaltId, amount: 50, unit: 'MG' }],
      });
    const medId = medRes.body.medicine.id;

    // Attempting to delete used salt must return 409 SALT_IN_USE with structured details
    const deleteUsedRes = await request(app)
      .delete(`/api/v1/salts/${usedSaltId}`)
      .set(auth(tokens.admin));
    expect(deleteUsedRes.status).toBe(409);
    expect(deleteUsedRes.body.error.code).toBe('SALT_IN_USE');
    expect(deleteUsedRes.body.error.details.compositionCount).toBe(1);
    expect(deleteUsedRes.body.error.details.medicineCount).toBe(1);

    // Verify used Salt, Composition, and Medicine remain completely intact after rejected delete
    const saltCheck = await request(app).get(`/api/v1/salts/${usedSaltId}`).set(auth(tokens.admin));
    expect(saltCheck.status).toBe(200);
    expect(saltCheck.body.salt.id).toBe(usedSaltId);

    const medCheck = await request(app).get(`/api/v1/medicines/${medId}`).set(auth(tokens.admin));
    expect(medCheck.status).toBe(200);
    expect(medCheck.body.medicine.id).toBe(medId);

    // Deactivate used salt succeeds safely without deleting records
    const deactRes = await request(app)
      .patch(`/api/v1/salts/${usedSaltId}`)
      .set(auth(tokens.admin))
      .send({ active: false });
    expect(deactRes.status).toBe(200);
    expect(deactRes.body.salt.active).toBe(false);

    // Deactivated salt remains linked and visible in existing medicine
    const medAfterDeact = await request(app).get(`/api/v1/medicines/${medId}`).set(auth(tokens.admin));
    expect(medAfterDeact.status).toBe(200);
    expect(medAfterDeact.body.medicine.composition.displayText).toContain(usedSaltName);

    // Deactivated salt is excluded from active salts list (cannot be selected for new medicines)
    const activeList = await request(app).get('/api/v1/salts?active=active').set(auth(tokens.employee));
    expect(activeList.body.salts.some((s: { id: string }) => s.id === usedSaltId)).toBe(false);

    // Reactivate salt succeeds
    const reactRes = await request(app)
      .patch(`/api/v1/salts/${usedSaltId}`)
      .set(auth(tokens.admin))
      .send({ active: true });
    expect(reactRes.status).toBe(200);
    expect(reactRes.body.salt.active).toBe(true);

    // 2. Unused salt -> Hard delete succeeds
    const unusedSaltName = `UnusedSalt_${unique('Del')}`;
    const createUnusedRes = await request(app)
      .post('/api/v1/salts')
      .set(auth(tokens.admin))
      .send({ name: unusedSaltName });
    const unusedSaltId = createUnusedRes.body.salt.id;

    const deleteUnusedRes = await request(app)
      .delete(`/api/v1/salts/${unusedSaltId}`)
      .set(auth(tokens.admin));
    expect(deleteUnusedRes.status).toBe(200);
    expect(deleteUnusedRes.body.success).toBe(true);
    expect(deleteUnusedRes.body.deletedSaltId).toBe(unusedSaltId);

    // Record is hard deleted from database
    const getDeletedCheck = await request(app).get(`/api/v1/salts/${unusedSaltId}`).set(auth(tokens.admin));
    expect(getDeletedCheck.status).toBe(404);
  });

  it('12 & 13. Enforces authorization on Salt mutations', async () => {
    const unauthRes = await request(app)
      .post('/api/v1/salts')
      .send({ name: 'UnauthorizedSalt' });
    expect(unauthRes.status).toBe(401);

    const empRes = await request(app)
      .post('/api/v1/salts')
      .set(auth(tokens.employee))
      .send({ name: 'EmployeeSalt' });
    expect(empRes.status).toBe(403);

    const empDelRes = await request(app)
      .delete('/api/v1/salts/11111111-1111-4111-8111-111111111111')
      .set(auth(tokens.employee));
    expect(empDelRes.status).toBe(403);
  });
});

describe('Composition CRUD & Synchronization (Section 31)', () => {
  it('1. Creates Composition with direct salts array', async () => {
    const saltA = `Glimepiride_${unique('CompCreate')}`;
    const saltB = `Metformin_${unique('CompCreate')}`;

    const res = await request(app)
      .post('/api/v1/compositions')
      .set(auth(tokens.admin))
      .send({
        description: 'Anti-diabetic dual formula',
        salts: [
          { name: saltA, amount: 2, unit: 'MG' },
          { name: saltB, amount: 500, unit: 'MG' },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.composition.displayText).toContain('2 MG');
    expect(res.body.composition.displayText).toContain('500 MG');
    expect(res.body.composition.compositionSalts).toHaveLength(2);
  });

  it('2 & 3. Reads and lists Compositions with search and counts', async () => {
    const saltName = `Vildagliptin_${unique('CompList')}`;
    const createRes = await request(app)
      .post('/api/v1/compositions')
      .set(auth(tokens.admin))
      .send({
        salts: [{ name: saltName, amount: 50, unit: 'MG' }],
      });
    expect(createRes.status).toBe(201);
    const compId = createRes.body.composition.id;

    const getRes = await request(app)
      .get(`/api/v1/compositions/${compId}`)
      .set(auth(tokens.employee));
    expect(getRes.status).toBe(200);
    expect(getRes.body.composition.id).toBe(compId);
    expect(getRes.body.composition.compositionSalts[0].salt.name).toBe(saltName);

    const listRes = await request(app)
      .get(`/api/v1/compositions?search=${saltName}`)
      .set(auth(tokens.employee));
    expect(listRes.status).toBe(200);
    expect(listRes.body.compositions.length).toBeGreaterThanOrEqual(1);
  });

  it('4, 5, 6 & 7. Admin updates Composition (modifies salts/strengths) and propagates to all linked Medicines', async () => {
    const salt1 = `Telmisartan_${unique('AdminCompEdit')}`;
    const salt2 = `Amlodipine_${unique('AdminCompEdit')}`;
    const salt3 = `Hydrochlorothiazide_${unique('AdminCompEdit')}`;

    // 1. Create composition with Telmisartan 40mg + Amlodipine 5mg
    const compRes = await request(app)
      .post('/api/v1/compositions')
      .set(auth(tokens.admin))
      .send({
        salts: [
          { name: salt1, amount: 40, unit: 'MG' },
          { name: salt2, amount: 5, unit: 'MG' },
        ],
      });
    expect(compRes.status).toBe(201);
    const compId = compRes.body.composition.id;

    // 2. Link 2 medicines to this composition
    const med1Res = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('TelmiAmlod1'),
        compositionId: compId,
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
      });
    expect(med1Res.status).toBe(201);
    const med1Id = med1Res.body.medicine.id;

    const med2Res = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('TelmiAmlod2'),
        compositionId: compId,
        form: 'TABLET',
        packQuantity: 30,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
      });
    expect(med2Res.status).toBe(201);
    const med2Id = med2Res.body.medicine.id;

    // 3. Admin modifies Composition: changes Amlodipine to 10mg AND adds Hydrochlorothiazide 12.5mg
    const patchCompRes = await request(app)
      .patch(`/api/v1/compositions/${compId}`)
      .set(auth(tokens.admin))
      .send({
        salts: [
          { name: salt1, amount: 40, unit: 'MG' },
          { name: salt2, amount: 10, unit: 'MG' }, // Changed strength
          { name: salt3, amount: 12.5, unit: 'MG' }, // Added salt
        ],
      });
    expect(patchCompRes.status).toBe(200);
    expect(patchCompRes.body.composition.displayText).toContain('10 MG');
    expect(patchCompRes.body.composition.displayText).toContain('12.5 MG');

    // 4. Verify BOTH medicines now reflect the updated composition without changing compositionId!
    const med1Check = await request(app)
      .get(`/api/v1/medicines/${med1Id}`)
      .set(auth(tokens.employee));
    expect(med1Check.status).toBe(200);
    expect(med1Check.body.medicine.composition.id).toBe(compId);
    expect(med1Check.body.medicine.composition.displayText).toContain('10 MG');
    expect(med1Check.body.medicine.composition.displayText).toContain('12.5 MG');

    const med2Check = await request(app)
      .get(`/api/v1/medicines/${med2Id}`)
      .set(auth(tokens.employee));
    expect(med2Check.status).toBe(200);
    expect(med2Check.body.medicine.composition.id).toBe(compId);
    expect(med2Check.body.medicine.composition.displayText).toContain('10 MG');
    expect(med2Check.body.medicine.composition.displayText).toContain('12.5 MG');
  });

  it('8 & 9. Canonical order-independent identity prevents duplicate compositions', async () => {
    const saltA = `Cilnidipine_${unique('OrderCanon')}`;
    const saltB = `Telmisartan_${unique('OrderCanon')}`;

    // Create Order 1: Cilnidipine 10mg + Telmisartan 40mg
    const comp1Res = await request(app)
      .post('/api/v1/compositions')
      .set(auth(tokens.admin))
      .send({
        salts: [
          { name: saltA, amount: 10, unit: 'MG' },
          { name: saltB, amount: 40, unit: 'MG' },
        ],
      });
    expect(comp1Res.status).toBe(201);

    // Attempt Order 2: Telmisartan 40mg + Cilnidipine 10mg (reverse order)
    const comp2Res = await request(app)
      .post('/api/v1/compositions')
      .set(auth(tokens.admin))
      .send({
        salts: [
          { name: saltB, amount: 40, unit: 'MG' },
          { name: saltA, amount: 10, unit: 'MG' },
        ],
      });
    expect(comp2Res.status).toBe(409);
    expect(comp2Res.body.error.code).toBe('DUPLICATE_COMPOSITION');
  });

  it('10 & 11. Prevents deletion of used Composition and allows deletion of unused Composition', async () => {
    // 1. Used composition
    const saltUsed = `UsedCompSalt_${unique('Del')}`;
    const usedCompRes = await request(app)
      .post('/api/v1/compositions')
      .set(auth(tokens.admin))
      .send({
        salts: [{ name: saltUsed, amount: 100, unit: 'MG' }],
      });
    expect(usedCompRes.status).toBe(201);
    const usedCompId = usedCompRes.body.composition.id;

    await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('MedUsingComp'),
        compositionId: usedCompId,
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
      });

    const deleteUsedRes = await request(app)
      .delete(`/api/v1/compositions/${usedCompId}`)
      .set(auth(tokens.admin));
    expect(deleteUsedRes.status).toBe(409);
    expect(deleteUsedRes.body.error.code).toBe('COMPOSITION_IN_USE');
    expect(deleteUsedRes.body.error.details.medicineCount).toBe(1);

    // Deactivate used composition succeeds
    const deactCompRes = await request(app)
      .patch(`/api/v1/compositions/${usedCompId}`)
      .set(auth(tokens.admin))
      .send({ active: false });
    expect(deactCompRes.status).toBe(200);
    expect(deactCompRes.body.composition.active).toBe(false);

    // 2. Unused composition -> Hard delete succeeds
    const saltUnused = `UnusedCompSalt_${unique('Del')}`;
    const unusedCompRes = await request(app)
      .post('/api/v1/compositions')
      .set(auth(tokens.admin))
      .send({
        salts: [{ name: saltUnused, amount: 100, unit: 'MG' }],
      });
    expect(unusedCompRes.status).toBe(201);
    const unusedCompId = unusedCompRes.body.composition.id;

    const deleteUnusedRes = await request(app)
      .delete(`/api/v1/compositions/${unusedCompId}`)
      .set(auth(tokens.admin));
    expect(deleteUnusedRes.status).toBe(200);
    expect(deleteUnusedRes.body.success).toBe(true);
    expect(deleteUnusedRes.body.deletedCompositionId).toBe(unusedCompId);

    // Record is hard deleted
    const getDeletedComp = await request(app).get(`/api/v1/compositions/${unusedCompId}`).set(auth(tokens.admin));
    expect(getDeletedComp.status).toBe(404);
  });
});

describe('Medicine vs Master-Data Edit Distinction (Section 32)', () => {
  it('1. Editing Medicine salt inputs resolves/creates appropriate Composition without modifying the shared Composition', async () => {
    const saltA = `Paracetamol_${unique('MedVsComp')}`;
    const saltB = `Caffeine_${unique('MedVsComp')}`;

    // 1. Create Composition with Paracetamol 500mg + Caffeine 30mg
    const compRes = await request(app)
      .post('/api/v1/compositions')
      .set(auth(tokens.admin))
      .send({
        salts: [
          { name: saltA, amount: 500, unit: 'MG' },
          { name: saltB, amount: 30, unit: 'MG' },
        ],
      });
    expect(compRes.status).toBe(201);
    const originalCompId = compRes.body.composition.id;

    // 2. Medicine 1 and Medicine 2 both use this composition
    const med1Res = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('Med1_ParaCaff'),
        compositionId: originalCompId,
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
      });
    const med1Id = med1Res.body.medicine.id;

    const med2Res = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('Med2_ParaCaff'),
        compositionId: originalCompId,
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
      });
    const med2Id = med2Res.body.medicine.id;

    // 3. User edits Medicine 1: changes Caffeine from 30mg to 65mg
    const editMed1Res = await request(app)
      .patch(`/api/v1/medicines/${med1Id}`)
      .set(auth(tokens.admin))
      .send({
        salts: [
          { name: saltA, amount: 500, unit: 'MG' },
          { name: saltB, amount: 65, unit: 'MG' },
        ],
      });
    expect(editMed1Res.status).toBe(200);
    expect(editMed1Res.body.medicine.composition.displayText).toContain('65 MG');
    expect(editMed1Res.body.medicine.composition.id).not.toBe(originalCompId);

    // 4. Verify Medicine 2 STILL points to the original composition (30mg) untouched!
    const med2Check = await request(app)
      .get(`/api/v1/medicines/${med2Id}`)
      .set(auth(tokens.employee));
    expect(med2Check.status).toBe(200);
    expect(med2Check.body.medicine.composition.id).toBe(originalCompId);
    expect(med2Check.body.medicine.composition.displayText).toContain('30 MG');
    expect(med2Check.body.medicine.composition.displayText).not.toContain('65 MG');
  });
});
