import { $Enums } from '@prisma/client/index';
import argon2 from 'argon2';
import { decodeJwt, SignJWT } from 'jose';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { env } from '../src/config/env.js';
import { prisma } from '../src/lib/prisma.js';

type UserCredentials = { email: string; phone: string; password: string };
type TokenPair = { admin: string; employee: string };
type ApiBody = Record<string, unknown>;

const password = 'Test-password-123!';
let sequence = 0;
const unique = (prefix: string): string => `${prefix}-${Date.now()}-${sequence++}`;
const phoneSeed = String(Date.now()).slice(-8);
const admin: UserCredentials = { email: `${unique('admin')}@example.com`, phone: `+919${phoneSeed}01`, password };
const employee: UserCredentials = { email: `${unique('employee')}@example.com`, phone: `+919${phoneSeed}02`, password };
let tokens!: TokenPair;
let manufacturerId: string;

const body = <T extends ApiBody>(response: request.Response): T => response.body as T;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const login = async (identifier: string, secret = password): Promise<string> => {
  const response = await request(app).post('/api/v1/auth/login').send({ identifier, password: secret });
  expect(response.status).toBe(200);
  return body<{ accessToken: string }>(response).accessToken;
};

const createSalt = async (name = unique('Salt')): Promise<{ id: string; name: string }> => {
  const response = await request(app)
    .post('/api/v1/salts')
    .set(auth(tokens.admin))
    .send({ name, description: 'Integration salt' });
  expect(response.status).toBe(201);
  return body<{ salt: { id: string; name: string } }>(response).salt;
};

const createCompositionSalt = async (saltId: string, amount = 500): Promise<{ id: string }> => {
  const response = await request(app)
    .post('/api/v1/composition-salts')
    .set(auth(tokens.admin))
    .send({ saltId, amount, unit: 'MG' });
  expect(response.status).toBe(201);
  return body<{ compositionSalt: { id: string } }>(response).compositionSalt;
};

const createComposition = async (compositionSaltIds: string[] = []): Promise<{ id: string }> => {
  const ids = compositionSaltIds.length > 0 ? compositionSaltIds : [
    (await createCompositionSalt((await createSalt()).id)).id,
  ];
  const response = await request(app)
    .post('/api/v1/compositions')
    .set(auth(tokens.admin))
    .send({ displayText: `Composition ${unique('display')}`, description: 'Integration composition', compositionSaltIds: ids });
  expect(response.status).toBe(201);
  return body<{ composition: { id: string } }>(response).composition;
};

const createMr = async (overrides: { company?: string | null } = {}): Promise<{ id: string }> => {
  const response = await request(app)
    .post('/api/v1/mrs')
    .set(auth(tokens.admin))
    .send({
      name: unique('MR'),
      company: overrides.company === undefined ? 'Integration Pharma' : overrides.company,
      phone: '+919876543210',
      email: `${unique('mr')}@example.com`,
      notes: 'Integration MR',
    });
  expect(response.status).toBe(201);
  return body<{ mr: { id: string } }>(response).mr;
};

const createMedicine = async (overrides: { compositionId?: string; mrId?: string | null } = {}): Promise<{ id: string }> => {
  const composition = overrides.compositionId === undefined ? await createComposition() : { id: overrides.compositionId };
  const response = await request(app)
    .post('/api/v1/medicines')
    .set(auth(tokens.admin))
    .send({
      name: unique('Medicine'),
      compositionId: composition.id,
      form: 'TABLET',
      packQuantity: 10,
      packUnit: 'TABLET',
      prescriptionRequired: false,
      manufacturerId,
      mrId: overrides.mrId === undefined ? (await createMr()).id : overrides.mrId,
    });
  expect(response.status).toBe(201);
  return body<{ medicine: { id: string } }>(response).medicine;
};

const createBatch = async (medicineId: string): Promise<{ id: string }> => {
  const response = await request(app)
    .post('/api/v1/batches')
    .set(auth(tokens.admin))
    .send({ medicineId, batchNumber: unique('BATCH'), manufacturingDate: '2026-01-01', expiryDate: '2027-01-01' });
  expect(response.status).toBe(201);
  return body<{ batch: { id: string } }>(response).batch;
};

beforeAll(async () => {
  const passwordHash = await argon2.hash(password);
  await prisma.user.createMany({
    data: [
      { name: 'Integration Admin', email: admin.email, phone: admin.phone, passwordHash, role: $Enums.UserRole.ADMIN, active: true },
      { name: 'Integration Employee', email: employee.email, phone: employee.phone, passwordHash, role: $Enums.UserRole.EMPLOYEE, active: true },
    ],
  });
  const manufacturer = await prisma.manufacturer.create({ data: { name: unique('Manufacturer'), active: true } });
  manufacturerId = manufacturer.id;
  tokens = { admin: await login(admin.email), employee: await login(employee.email) };
});

describe('HTTP authentication', () => {
  it('logs in with email and phone', async () => {
    const emailToken = await login(admin.email);
    const phoneToken = await login(admin.phone);
    expect(emailToken).toBeTruthy();
    expect(phoneToken).toBeTruthy();
  });

  it.each([
    ['wrong password', { identifier: admin.email, password: 'wrong-password' }],
    ['unknown identifier', { identifier: `${unique('unknown')}@example.com`, password }],
  ])('returns generic 401 for %s', async (_label, payload) => {
    const response = await request(app).post('/api/v1/auth/login').send(payload);
    expect(response.status).toBe(401);
    expect(response.body.error.message).toBe('Invalid identifier or password');
  });

  it('validates missing login fields', async () => {
    for (const payload of [{ password }, { identifier: admin.email }]) {
      const response = await request(app).post('/api/v1/auth/login').send(payload);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('rejects missing, malformed, invalid, and expired authorization', async () => {
    const expired = await new SignJWT({ role: 'ADMIN' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('expired')
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(env.JWT_SECRET));
    for (const authorization of [undefined, 'Token malformed', 'Bearer invalid', `Bearer ${expired}`]) {
      const builder = request(app).get('/api/v1/salts');
      if (authorization) builder.set('Authorization', authorization);
      const response = await builder;
      expect(response.status).toBe(401);
    }
  });

  it('accepts a valid JWT and exposes only intended claims', async () => {
    const token = await login(admin.email);
    const claims = decodeJwt(token);
    expect(claims).toHaveProperty('sub');
    expect(claims).toHaveProperty('role', 'ADMIN');
    expect(claims).not.toHaveProperty('email');
    expect(claims).not.toHaveProperty('passwordHash');
    const response = await request(app).get('/api/v1/salts').set(auth(token));
    expect(response.status).toBe(200);
  });
});

describe('ADMIN-only users endpoint', () => {
  it('allows admins and denies employees and unauthenticated callers', async () => {
    const adminResponse = await request(app).post('/api/v1/users').set(auth(tokens.admin)).send({
      name: 'Created Employee', email: `${unique('created')}@example.com`, phone: '+919000000099', password, role: 'EMPLOYEE',
    });
    expect(adminResponse.status).toBe(201);
    expect(adminResponse.body.user).not.toHaveProperty('passwordHash');

    const employeeResponse = await request(app).post('/api/v1/users').set(auth(tokens.employee)).send({});
    expect(employeeResponse.status).toBe(403);
    const unauthenticatedResponse = await request(app).post('/api/v1/users').send({});
    expect(unauthenticatedResponse.status).toBe(401);
  });

  it('validates duplicate identifiers and invalid user input', async () => {
    const duplicateEmail = await request(app).post('/api/v1/users').set(auth(tokens.admin)).send({
      name: 'Duplicate', email: admin.email, phone: '+919000000088', password, role: 'EMPLOYEE',
    });
    expect(duplicateEmail.status).toBe(409);
    const invalid = await request(app).post('/api/v1/users').set(auth(tokens.admin)).send({
      name: ' ', email: 'invalid', phone: '1', password: 'short', role: 'INVALID',
    });
    expect(invalid.status).toBe(400);
  });

  it('rejects user creation when both email and phone are omitted, null, or whitespace', async () => {
    const omitted = await request(app).post('/api/v1/users').set(auth(tokens.admin)).send({
      name: 'No Identifier', password, role: 'EMPLOYEE',
    });
    expect(omitted.status).toBe(400);
    expect(omitted.body.error.code).toBe('VALIDATION_ERROR');

    const nulls = await request(app).post('/api/v1/users').set(auth(tokens.admin)).send({
      name: 'Null Identifiers', email: null, phone: null, password, role: 'EMPLOYEE',
    });
    expect(nulls.status).toBe(400);
    expect(nulls.body.error.code).toBe('VALIDATION_ERROR');

    const blanks = await request(app).post('/api/v1/users').set(auth(tokens.admin)).send({
      name: 'Blank Identifiers', email: '   ', phone: '   ', password, role: 'EMPLOYEE',
    });
    expect(blanks.status).toBe(400);
    expect(blanks.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('allows user creation with only email or only phone', async () => {
    const emailOnly = await request(app).post('/api/v1/users').set(auth(tokens.admin)).send({
      name: 'Email Only User', email: `${unique('emailonly')}@example.com`, password, role: 'EMPLOYEE',
    });
    expect(emailOnly.status).toBe(201);
    expect(emailOnly.body.user.phone).toBeNull();

    const phoneOnly = await request(app).post('/api/v1/users').set(auth(tokens.admin)).send({
      name: 'Phone Only User', phone: `+918${String(Date.now()).slice(-8)}`, password, role: 'EMPLOYEE',
    });
    expect(phoneOnly.status).toBe(201);
    expect(phoneOnly.body.user.email).toBeNull();
  });
});

describe('Salt API', () => {
  it('supports admin CRUD, search, soft deactivation, and employee read authorization', async () => {
    const salt = await createSalt('Amoxicillin Integration');
    const get = await request(app).get(`/api/v1/salts/${salt.id}`).set(auth(tokens.employee));
    expect(get.status).toBe(200);
    const search = await request(app).get('/api/v1/salts?active=active&search=AMOXICILLIN').set(auth(tokens.employee));
    expect(search.status).toBe(200);
    expect(search.body.salts.some((item: { id: string }) => item.id === salt.id)).toBe(true);
    const update = await request(app).patch(`/api/v1/salts/${salt.id}`).set(auth(tokens.admin)).send({ name: 'Amoxicillin Updated' });
    expect(update.status).toBe(200);
    const denied = await request(app).patch(`/api/v1/salts/${salt.id}`).set(auth(tokens.employee)).send({ name: 'Nope' });
    expect(denied.status).toBe(403);
    const deleted = await request(app).delete(`/api/v1/salts/${salt.id}`).set(auth(tokens.admin));
    expect(deleted.status).toBe(200);
    const hidden = await request(app).get('/api/v1/salts?active=active').set(auth(tokens.employee));
    expect(hidden.body.salts.some((item: { id: string }) => item.id === salt.id)).toBe(false);
    const duplicate = await request(app).post('/api/v1/salts').set(auth(tokens.admin)).send({ name: 'Amoxicillin Updated' });
    expect(duplicate.status).toBe(409);
  });

  it('returns validation and not-found errors', async () => {
    expect((await request(app).get('/api/v1/salts/not-a-uuid').set(auth(tokens.employee))).status).toBe(400);
    expect((await request(app).get('/api/v1/salts/00000000-0000-4000-8000-000000000000').set(auth(tokens.employee))).status).toBe(404);
    expect((await request(app).post('/api/v1/salts').set(auth(tokens.admin)).send({ name: ' ' })).status).toBe(400);
  });
});

describe('CompositionSalt and Composition APIs', () => {
  it('creates and reads a CompositionSalt with its Salt', async () => {
    const salt = await createSalt();
    const compositionSalt = await createCompositionSalt(salt.id);
    const response = await request(app).get(`/api/v1/composition-salts/${compositionSalt.id}`).set(auth(tokens.employee));
    expect(response.status).toBe(200);
    expect(response.body.compositionSalt.salt).toMatchObject({ id: salt.id, name: salt.name });
    expect((await request(app).patch(`/api/v1/composition-salts/${compositionSalt.id}`).set(auth(tokens.employee)).send({ amount: 600 })).status).toBe(403);
    expect((await request(app).patch(`/api/v1/composition-salts/${compositionSalt.id}`).set(auth(tokens.admin)).send({ amount: 600, unit: 'MG' })).status).toBe(200);
  });

  it('rejects invalid CompositionSalt input and unsupported deletion', async () => {
    const invalid = await request(app).post('/api/v1/composition-salts').set(auth(tokens.admin)).send({ saltId: 'bad', amount: 0, unit: 'BAD' });
    expect(invalid.status).toBe(400);
    const deleted = await request(app).delete('/api/v1/composition-salts/not-a-uuid').set(auth(tokens.admin));
    expect(deleted.status).toBe(400);
  });

  it('creates and updates Composition relationships transactionally through HTTP', async () => {
    const first = await createCompositionSalt((await createSalt()).id);
    const second = await createCompositionSalt((await createSalt()).id);
    const composition = await createComposition([first.id, second.id]);
    const get = await request(app).get(`/api/v1/compositions/${composition.id}`).set(auth(tokens.employee));
    expect(get.status).toBe(200);
    expect(get.body.composition.compositionSalts).toHaveLength(2);
    const update = await request(app).patch(`/api/v1/compositions/${composition.id}`).set(auth(tokens.admin)).send({ compositionSaltIds: [first.id] });
    expect(update.status).toBe(200);
    expect(update.body.composition.compositionSalts).toHaveLength(1);
    expect((await request(app).delete(`/api/v1/compositions/${composition.id}`).set(auth(tokens.admin))).status).toBe(200);
    expect((await request(app).get('/api/v1/compositions').set(auth(tokens.employee))).body.compositions.some((item: { id: string }) => item.id === composition.id)).toBe(false);
  });

  it('rejects invalid and duplicate CompositionSalt relationships', async () => {
    const salt = await createCompositionSalt((await createSalt()).id);
    const duplicate = await request(app).post('/api/v1/compositions').set(auth(tokens.admin)).send({ displayText: 'Duplicate', compositionSaltIds: [salt.id, salt.id] });
    expect(duplicate.status).toBe(400);
    const missing = await request(app).post('/api/v1/compositions').set(auth(tokens.admin)).send({ displayText: 'Missing', compositionSaltIds: ['00000000-0000-4000-8000-000000000000'] });
    expect(missing.status).toBe(404);
  });

  it('prevents compositions from using deactivated salts and preserves existing compositions', async () => {
    // 1. Active Salt -> Composition creation succeeds
    const activeSalt = await createSalt(unique('Active Salt'));
    const compSalt = await createCompositionSalt(activeSalt.id, 250);
    const compResponse = await request(app)
      .post('/api/v1/compositions')
      .set(auth(tokens.admin))
      .send({ displayText: unique('Active Comp'), compositionSaltIds: [compSalt.id] });
    expect(compResponse.status).toBe(201);
    const compId = compResponse.body.composition.id;

    // 2. Deactivate the salt
    await request(app).delete(`/api/v1/salts/${activeSalt.id}`).set(auth(tokens.admin));

    // 3. Existing Composition remains intact after Salt deactivation
    const getComp = await request(app).get(`/api/v1/compositions/${compId}`).set(auth(tokens.employee));
    expect(getComp.status).toBe(200);
    expect(getComp.body.composition.id).toBe(compId);

    // 4. Deactivated Salt -> new Composition creation fails (409)
    const newCompWithDeactivatedSalt = await request(app)
      .post('/api/v1/compositions')
      .set(auth(tokens.admin))
      .send({ displayText: unique('Failed Comp'), compositionSaltIds: [compSalt.id] });
    expect(newCompWithDeactivatedSalt.status).toBe(409);
    expect(newCompWithDeactivatedSalt.body.error.code).toBe('INACTIVE_SALT_REFERENCE');

    // 5. Updating an existing Composition to include a CompositionSalt whose Salt is inactive fails (409)
    const anotherActiveSalt = await createSalt(unique('Another Active Salt'));
    const anotherCompSalt = await createCompositionSalt(anotherActiveSalt.id, 100);
    const compToUpdate = await createComposition([anotherCompSalt.id]);

    const updateWithInactiveSalt = await request(app)
      .patch(`/api/v1/compositions/${compToUpdate.id}`)
      .set(auth(tokens.admin))
      .send({ compositionSaltIds: [anotherCompSalt.id, compSalt.id] });
    expect(updateWithInactiveSalt.status).toBe(409);
    expect(updateWithInactiveSalt.body.error.code).toBe('INACTIVE_SALT_REFERENCE');
  });
});

describe('MR API', () => {
  it('supports optional company, search, admin mutation, and employee active-only reads', async () => {
    const mr = await createMr({ company: null });
    const search = await request(app).get('/api/v1/mrs?search=mr').set(auth(tokens.employee));
    expect(search.status).toBe(200);
    expect(search.body.mrs.some((item: { id: string }) => item.id === mr.id)).toBe(true);
    expect((await request(app).patch(`/api/v1/mrs/${mr.id}`).set(auth(tokens.employee)).send({ name: 'Denied' })).status).toBe(403);
    expect((await request(app).patch(`/api/v1/mrs/${mr.id}`).set(auth(tokens.admin)).send({ notes: 'Updated' })).status).toBe(200);
    expect((await request(app).delete(`/api/v1/mrs/${mr.id}`).set(auth(tokens.admin))).status).toBe(200);
    expect((await request(app).get(`/api/v1/mrs/${mr.id}`).set(auth(tokens.employee))).status).toBe(404);
  });

  it('rejects invalid MR input and UUIDs', async () => {
    expect((await request(app).post('/api/v1/mrs').set(auth(tokens.admin)).send({ company: 'Missing name' })).status).toBe(400);
    expect((await request(app).get('/api/v1/mrs/not-a-uuid').set(auth(tokens.employee))).status).toBe(400);
    expect((await request(app).get('/api/v1/mrs/00000000-0000-4000-8000-000000000000').set(auth(tokens.employee))).status).toBe(404);
  });
});

describe('Medicine and Batch APIs', () => {
  it('creates a Medicine with Composition, Manufacturer, and MR and supports employee reads', async () => {
    const mr = await createMr();
    const medicine = await createMedicine({ mrId: mr.id });
    const get = await request(app).get(`/api/v1/medicines/${medicine.id}`).set(auth(tokens.employee));
    expect(get.status).toBe(200);
    expect(get.body.medicine.composition).toBeDefined();
    expect(get.body.medicine.manufacturer).toMatchObject({ id: manufacturerId });
    expect(get.body.medicine.mr).toMatchObject({ id: mr.id });
    expect((await request(app).patch(`/api/v1/medicines/${medicine.id}`).set(auth(tokens.employee)).send({ name: 'Denied' })).status).toBe(403);
    expect((await request(app).patch(`/api/v1/medicines/${medicine.id}`).set(auth(tokens.admin)).send({ name: 'Updated Medicine' })).status).toBe(200);
    expect((await request(app).delete(`/api/v1/medicines/${medicine.id}`).set(auth(tokens.admin))).status).toBe(200);
    expect((await request(app).get(`/api/v1/medicines/${medicine.id}`).set(auth(tokens.employee))).status).toBe(404);
  });

  it('rejects invalid or missing Medicine relationships', async () => {
    const composition = await createComposition();
    const response = await request(app).post('/api/v1/medicines').set(auth(tokens.admin)).send({
      name: unique('Invalid'), compositionId: composition.id, form: 'INVALID', packQuantity: 0, packUnit: 'TABLET',
      prescriptionRequired: false, manufacturerId: 'bad', mrId: null,
    });
    expect(response.status).toBe(400);
  });

  it('creates and updates Batch with date and uniqueness validation', async () => {
    const medicine = await createMedicine({ mrId: null });
    const batch = await createBatch(medicine.id);
    const list = await request(app).get(`/api/v1/batches?medicineId=${medicine.id}`).set(auth(tokens.employee));
    expect(list.status).toBe(200);
    expect(list.body.batches.some((item: { id: string }) => item.id === batch.id)).toBe(true);
    expect((await request(app).patch(`/api/v1/batches/${batch.id}`).set(auth(tokens.admin)).send({ expiryDate: '2028-01-01' })).status).toBe(200);
    expect((await request(app).post('/api/v1/batches').set(auth(tokens.admin)).send({ medicineId: medicine.id, batchNumber: 'same', manufacturingDate: '2026-01-01', expiryDate: '2027-01-01' })).status).toBe(201);
    expect((await request(app).post('/api/v1/batches').set(auth(tokens.admin)).send({ medicineId: medicine.id, batchNumber: 'same', manufacturingDate: '2026-01-01', expiryDate: '2027-01-01' })).status).toBe(409);
    expect((await request(app).post('/api/v1/batches').set(auth(tokens.admin)).send({ medicineId: medicine.id, batchNumber: 'bad-date', manufacturingDate: '2027-01-01', expiryDate: '2026-01-01' })).status).toBe(400);
  });

  it('allows multiple medicines without barcode (empty string and whitespace normalized to null)', async () => {
    const comp = await createComposition();
    const med1 = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('NoBarcode1'),
        compositionId: comp.id,
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        barcode: '',
        prescriptionRequired: false,
        manufacturerId,
        mrId: null,
      });
    expect(med1.status).toBe(201);
    expect(med1.body.medicine.barcode).toBeNull();

    const med2 = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('NoBarcode2'),
        compositionId: comp.id,
        form: 'CAPSULE',
        packQuantity: 20,
        packUnit: 'CAPSULE',
        barcode: '   ',
        prescriptionRequired: false,
        manufacturerId,
        mrId: null,
      });
    expect(med2.status).toBe(201);
    expect(med2.body.medicine.barcode).toBeNull();

    const medWithBarcode = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('WithBarcode'),
        compositionId: comp.id,
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        barcode: '  TRIMMED-BARCODE-123  ',
        prescriptionRequired: false,
        manufacturerId,
        mrId: null,
      });
    expect(medWithBarcode.status).toBe(201);
    expect(medWithBarcode.body.medicine.barcode).toBe('TRIMMED-BARCODE-123');
  });

  it('supports optional medicine packaging imageUrl across create, update, list, and detail operations', async () => {
    const comp = await createComposition();
    const validImageUrl1 = 'https://cdn.example.com/medicines/packaging-box-1.png';
    const validImageUrl2 = 'https://cdn.example.com/medicines/packaging-bottle-2.png';

    // 1. Medicine can be created without an image (imageUrl is null)
    const medNoImgRes = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('MedNoImage'),
        compositionId: comp.id,
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        mrId: null,
      });
    expect(medNoImgRes.status).toBe(201);
    expect(medNoImgRes.body.medicine.imageUrl).toBeNull();
    const medNoImgId = medNoImgRes.body.medicine.id;

    // 2. Medicine can be created with a valid imageUrl
    const medWithImgRes = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('MedWithImage'),
        compositionId: comp.id,
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        imageUrl: validImageUrl1,
        prescriptionRequired: false,
        manufacturerId,
        mrId: null,
      });
    expect(medWithImgRes.status).toBe(201);
    expect(medWithImgRes.body.medicine.imageUrl).toBe(validImageUrl1);
    const medWithImgId = medWithImgRes.body.medicine.id;

    // 3. Invalid imageUrl is rejected on create and update
    const invalidCreateRes = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: unique('MedInvalidUrl'),
        compositionId: comp.id,
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        imageUrl: 'not-a-valid-url',
        prescriptionRequired: false,
        manufacturerId,
        mrId: null,
      });
    expect(invalidCreateRes.status).toBe(400);
    expect(invalidCreateRes.body.error.code).toBe('VALIDATION_ERROR');

    const invalidUpdateRes = await request(app)
      .patch(`/api/v1/medicines/${medWithImgId}`)
      .set(auth(tokens.admin))
      .send({ imageUrl: 'ftp://bad url' });
    expect(invalidUpdateRes.status).toBe(400);
    expect(invalidUpdateRes.body.error.code).toBe('VALIDATION_ERROR');

    // 4. Existing medicine without an image remains valid
    const getNoImgRes = await request(app)
      .get(`/api/v1/medicines/${medNoImgId}`)
      .set(auth(tokens.employee));
    expect(getNoImgRes.status).toBe(200);
    expect(getNoImgRes.body.medicine.imageUrl).toBeNull();

    // 5. Medicine update can add an imageUrl to a medicine with null imageUrl
    const addImgRes = await request(app)
      .patch(`/api/v1/medicines/${medNoImgId}`)
      .set(auth(tokens.admin))
      .send({ imageUrl: validImageUrl1 });
    expect(addImgRes.status).toBe(200);
    expect(addImgRes.body.medicine.imageUrl).toBe(validImageUrl1);

    // 6. Medicine update can replace an imageUrl
    const replaceImgRes = await request(app)
      .patch(`/api/v1/medicines/${medNoImgId}`)
      .set(auth(tokens.admin))
      .send({ imageUrl: validImageUrl2 });
    expect(replaceImgRes.status).toBe(200);
    expect(replaceImgRes.body.medicine.imageUrl).toBe(validImageUrl2);

    // 7. Medicine update can remove an image by setting imageUrl to null
    const removeImgRes = await request(app)
      .patch(`/api/v1/medicines/${medNoImgId}`)
      .set(auth(tokens.admin))
      .send({ imageUrl: null });
    expect(removeImgRes.status).toBe(200);
    expect(removeImgRes.body.medicine.imageUrl).toBeNull();

    // 8. Omitting imageUrl during update does not remove the existing image
    const preserveImgRes = await request(app)
      .patch(`/api/v1/medicines/${medWithImgId}`)
      .set(auth(tokens.admin))
      .send({ name: 'Preserved Image Medicine' });
    expect(preserveImgRes.status).toBe(200);
    expect(preserveImgRes.body.medicine.name).toBe('Preserved Image Medicine');
    expect(preserveImgRes.body.medicine.imageUrl).toBe(validImageUrl1);

    // 9. Medicine list returns imageUrl
    const listRes = await request(app)
      .get('/api/v1/medicines')
      .set(auth(tokens.employee));
    expect(listRes.status).toBe(200);
    const listedWithImg = listRes.body.medicines.find((m: { id: string }) => m.id === medWithImgId);
    const listedNoImg = listRes.body.medicines.find((m: { id: string }) => m.id === medNoImgId);
    expect(listedWithImg).toBeDefined();
    expect(listedWithImg.imageUrl).toBe(validImageUrl1);
    expect(listedNoImg).toBeDefined();
    expect(listedNoImg.imageUrl).toBeNull();

    // 10. Medicine detail returns imageUrl
    const detailRes = await request(app)
      .get(`/api/v1/medicines/${medWithImgId}`)
      .set(auth(tokens.employee));
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.medicine.imageUrl).toBe(validImageUrl1);
  });
});

describe('CommercialDetails security', () => {
  it('allows admin CRUD and denies every employee endpoint', async () => {
    const medicine = await createMedicine({ mrId: null });
    const path = `/api/v1/medicines/${medicine.id}/commercial-details`;
    const payload = { purchaseRate: 10.25, mrp: 15, discountPercent: 5, scheme: { type: 'box' }, privateNotes: 'SECRET-COMMERCIAL-VALUE' };
    const created = await request(app).post(path).set(auth(tokens.admin)).send(payload);
    expect(created.status).toBe(201);
    expect(created.body.commercialDetails).not.toHaveProperty('passwordHash');
    expect(created.body.commercialDetails.updatedBy.id).toBeDefined();
    expect((await request(app).get(path).set(auth(tokens.admin))).status).toBe(200);
    expect((await request(app).patch(path).set(auth(tokens.admin)).send({ mrp: 16 })).status).toBe(200);
    expect((await request(app).post(path).set(auth(tokens.admin)).send(payload)).status).toBe(409);
    for (const method of ['get', 'post', 'patch'] as const) {
      const response = method === 'get'
        ? await request(app).get(path).set(auth(tokens.employee))
        : method === 'post'
          ? await request(app).post(path).set(auth(tokens.employee)).send(payload)
          : await request(app).patch(path).set(auth(tokens.employee)).send({ mrp: 20 });
      expect(response.status).toBe(403);
    }
  });

  it('does not leak commercial values through employee-visible Medicine or Batch responses', async () => {
    const medicine = await createMedicine({ mrId: null });
    const batch = await createBatch(medicine.id);
    const path = `/api/v1/medicines/${medicine.id}/commercial-details`;
    await request(app).post(path).set(auth(tokens.admin)).send({ purchaseRate: 999.91, mrp: 1999.91, discountPercent: 7, scheme: { secret: 'LEAK-CHECK' }, privateNotes: 'PRIVATE-LEAK-CHECK' });
    const medicineResponse = await request(app).get(`/api/v1/medicines/${medicine.id}`).set(auth(tokens.employee));
    const batchResponse = await request(app).get(`/api/v1/batches/${batch.id}`).set(auth(tokens.employee));
    for (const response of [medicineResponse, batchResponse]) {
      expect(JSON.stringify(response.body)).not.toContain('999.91');
      expect(JSON.stringify(response.body)).not.toContain('LEAK-CHECK');
      expect(JSON.stringify(response.body)).not.toContain('PRIVATE-LEAK-CHECK');
    }
  });

  it('validates financial 2-decimal numbers correctly (19.99, 0.29, 1.14, 55.55, 100.07) and rejects >2 decimals', async () => {
    const testCases = [
      { purchaseRate: 19.99, mrp: 55.55, discountPercent: 10.07 },
      { purchaseRate: 0.29, mrp: 1.14, discountPercent: 0 },
      { purchaseRate: 100.07, mrp: 150.00, discountPercent: 55.55 },
    ];

    for (const values of testCases) {
      const medicine = await createMedicine({ mrId: null });
      const path = `/api/v1/medicines/${medicine.id}/commercial-details`;
      const response = await request(app).post(path).set(auth(tokens.admin)).send({
        purchaseRate: values.purchaseRate,
        mrp: values.mrp,
        discountPercent: values.discountPercent,
      });
      expect(response.status).toBe(201);
      expect(response.body.commercialDetails.purchaseRate).toBe(values.purchaseRate);
      expect(response.body.commercialDetails.mrp).toBe(values.mrp);
      expect(response.body.commercialDetails.discountPercent).toBe(values.discountPercent);
    }

    // Invalid >2 decimals
    const invalidDecimals = [
      { purchaseRate: 19.999, mrp: 50, discountPercent: 5 },
      { purchaseRate: 10, mrp: 0.291, discountPercent: 5 },
      { purchaseRate: 10, mrp: 50, discountPercent: 1.145 },
      { purchaseRate: 10, mrp: 50, discountPercent: 55.555 },
    ];

    for (const values of invalidDecimals) {
      const medicine = await createMedicine({ mrId: null });
      const path = `/api/v1/medicines/${medicine.id}/commercial-details`;
      const response = await request(app).post(path).set(auth(tokens.admin)).send(values);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
  });
});

describe('cross-module relationship preservation', () => {
  it('keeps a Medicine relationship after MR deactivation', async () => {
    const mr = await createMr();
    const medicine = await createMedicine({ mrId: mr.id });
    await request(app).delete(`/api/v1/mrs/${mr.id}`).set(auth(tokens.admin));
    const record = await prisma.medicine.findUnique({ where: { id: medicine.id }, select: { mrId: true } });
    expect(record?.mrId).toBe(mr.id);
  });
});

describe('Manufacturer API', () => {
  it('supports authenticated reads, admin CRUD, search, validation, and soft deactivation', async () => {
    const unauthenticated = await request(app).get('/api/v1/manufacturers');
    expect(unauthenticated.status).toBe(401);

    const create = await request(app)
      .post('/api/v1/manufacturers')
      .set(auth(tokens.admin))
      .send({ name: '  Sun Pharma Integration  ' });
    expect(create.status).toBe(201);
    expect(create.body.manufacturer.name).toBe('Sun Pharma Integration');
    expect(create.body.manufacturer.active).toBe(true);
    expect(Object.keys(create.body.manufacturer).sort()).toEqual([
      'active', 'createdAt', 'id', 'name', 'updatedAt',
    ]);
    const manufacturerId = create.body.manufacturer.id as string;

    const employeeList = await request(app)
      .get('/api/v1/manufacturers?search=sUn%20pHaRmA')
      .set(auth(tokens.employee));
    expect(employeeList.status).toBe(200);
    expect(employeeList.body.manufacturers).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: manufacturerId, name: 'Sun Pharma Integration' })]),
    );

    const employeeGet = await request(app)
      .get(`/api/v1/manufacturers/${manufacturerId}`)
      .set(auth(tokens.employee));
    expect(employeeGet.status).toBe(200);

    const employeeCreate = await request(app)
      .post('/api/v1/manufacturers')
      .set(auth(tokens.employee))
      .send({ name: unique('Employee Manufacturer') });
    expect(employeeCreate.status).toBe(403);
    const employeeUpdate = await request(app)
      .patch(`/api/v1/manufacturers/${manufacturerId}`)
      .set(auth(tokens.employee))
      .send({ name: 'Employee Cannot Update' });
    expect(employeeUpdate.status).toBe(403);
    const employeeDelete = await request(app)
      .delete(`/api/v1/manufacturers/${manufacturerId}`)
      .set(auth(tokens.employee));
    expect(employeeDelete.status).toBe(403);

    const update = await request(app)
      .patch(`/api/v1/manufacturers/${manufacturerId}`)
      .set(auth(tokens.admin))
      .send({ name: 'Sun Pharma Updated' });
    expect(update.status).toBe(200);
    expect(update.body.manufacturer.name).toBe('Sun Pharma Updated');

    const duplicate = await request(app)
      .post('/api/v1/manufacturers')
      .set(auth(tokens.admin))
      .send({ name: 'sun pharma updated' });
    expect(duplicate.status).toBe(409);

    const invalidBody = await request(app)
      .post('/api/v1/manufacturers')
      .set(auth(tokens.admin))
      .send({ name: '   ' });
    expect(invalidBody.status).toBe(400);
    const missingName = await request(app)
      .post('/api/v1/manufacturers')
      .set(auth(tokens.admin))
      .send({});
    expect(missingName.status).toBe(400);
    const invalidUuid = await request(app)
      .get('/api/v1/manufacturers/not-a-uuid')
      .set(auth(tokens.employee));
    expect(invalidUuid.status).toBe(400);
    const notFound = await request(app)
      .get('/api/v1/manufacturers/00000000-0000-4000-8000-000000000000')
      .set(auth(tokens.employee));
    expect(notFound.status).toBe(404);

    const deactivated = await request(app)
      .delete(`/api/v1/manufacturers/${manufacturerId}`)
      .set(auth(tokens.admin));
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.manufacturer.active).toBe(false);

    const hiddenGet = await request(app)
      .get(`/api/v1/manufacturers/${manufacturerId}`)
      .set(auth(tokens.employee));
    expect(hiddenGet.status).toBe(404);
    const hiddenList = await request(app)
      .get('/api/v1/manufacturers')
      .set(auth(tokens.employee));
    expect(hiddenList.status).toBe(200);
    expect(hiddenList.body.manufacturers.some((item: { id: string }) => item.id === manufacturerId)).toBe(false);

    const adminInactiveGet = await request(app)
      .get(`/api/v1/manufacturers/${manufacturerId}`)
      .set(auth(tokens.admin));
    expect(adminInactiveGet.status).toBe(200);
    expect(adminInactiveGet.body.manufacturer.active).toBe(false);
    const adminInactiveList = await request(app)
      .get('/api/v1/manufacturers?includeInactive=true')
      .set(auth(tokens.admin));
    expect(adminInactiveList.status).toBe(200);
    expect(adminInactiveList.body.manufacturers.some((item: { id: string }) => item.id === manufacturerId)).toBe(true);
    const employeeInactiveList = await request(app)
      .get('/api/v1/manufacturers?includeInactive=true')
      .set(auth(tokens.employee));
    expect(employeeInactiveList.status).toBe(403);

    const persisted = await prisma.manufacturer.findUnique({ where: { id: manufacturerId } });
    expect(persisted).not.toBeNull();
    expect(persisted?.active).toBe(false);
  });
});
