import { $Enums } from '@prisma/client/index';
import argon2 from 'argon2';
import { decodeJwt, SignJWT } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { env } from '../src/config/env.js';
import { prisma } from '../src/lib/prisma.js';
import { seedDatabase } from '../src/scripts/seed.js';

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

const createMedicine = async (overrides: { name?: string; packQuantity?: number; compositionId?: string; mrId?: string | null } = {}): Promise<{ id: string }> => {
  const composition = overrides.compositionId === undefined ? await createComposition() : { id: overrides.compositionId };
  const response = await request(app)
    .post('/api/v1/medicines')
    .set(auth(tokens.admin))
    .send({
      name: overrides.name ?? unique('Medicine'),
      compositionId: composition.id,
      form: 'TABLET',
      packQuantity: overrides.packQuantity ?? 10,
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
    const deactivated = await request(app).patch(`/api/v1/salts/${salt.id}`).set(auth(tokens.admin)).send({ active: false });
    expect(deactivated.status).toBe(200);
    const hidden = await request(app).get('/api/v1/salts?active=active').set(auth(tokens.employee));
    expect(hidden.body.salts.some((item: { id: string }) => item.id === salt.id)).toBe(false);
    const duplicate = await request(app).post('/api/v1/salts').set(auth(tokens.admin)).send({ name: 'Amoxicillin Updated' });
    expect(duplicate.status).toBe(409);
    const deleted = await request(app).delete(`/api/v1/salts/${salt.id}`).set(auth(tokens.admin));
    expect(deleted.status).toBe(200);
    expect(deleted.body.success).toBe(true);
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
    await request(app).patch(`/api/v1/salts/${activeSalt.id}`).set(auth(tokens.admin)).send({ active: false });

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
  it('supports full CRUD, search, company filter, sorting, pagination, and associated medicines', async () => {
    // 1. Create MR
    const uniqueSuffix = unique('MR');
    const mrName = `Dr. Representative ${uniqueSuffix}`;
    const mrCompany = `Apex Pharma ${uniqueSuffix}`;
    const mrEmail = `rep.${uniqueSuffix.toLowerCase()}@apexpharma.com`;
    const mrPhone = '9876543210';

    const createRes = await request(app)
      .post('/api/v1/mrs')
      .set(auth(tokens.admin))
      .send({
        name: mrName,
        company: mrCompany,
        phone: mrPhone,
        email: mrEmail,
        notes: 'Senior medical representative for Northern division',
      });

    expect(createRes.status).toBe(201);
    const createdMr = createRes.body.mr;
    expect(createdMr.name).toBe(mrName);
    expect(createdMr.company).toBe(mrCompany);
    expect(createdMr.phone).toBe(mrPhone);
    expect(createdMr.email).toBe(mrEmail);
    expect(createdMr.active).toBe(true);

    // 2. Create another MR for filter/sort verification
    const secondMrName = `A-Alpha Rep ${uniqueSuffix}`;
    const secondCompany = `Beta Pharma ${uniqueSuffix}`;
    const secondMrRes = await request(app)
      .post('/api/v1/mrs')
      .set(auth(tokens.admin))
      .send({
        name: secondMrName,
        company: secondCompany,
        phone: '9123456789',
        email: `alpha.${uniqueSuffix.toLowerCase()}@betapharma.com`,
      });
    expect(secondMrRes.status).toBe(201);
    const secondMr = secondMrRes.body.mr;

    // 3. Associate Medicine with first MR
    const medicine = await createMedicine({ mrId: createdMr.id });

    // 4. Get MR Details - verify associated medicine is present
    const detailsRes = await request(app)
      .get(`/api/v1/mrs/${createdMr.id}`)
      .set(auth(tokens.employee));
    expect(detailsRes.status).toBe(200);
    expect(detailsRes.body.mr.id).toBe(createdMr.id);
    expect(detailsRes.body.mr.medicinesCount).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(detailsRes.body.mr.medicines)).toBe(true);
    expect(detailsRes.body.mr.medicines.some((m: { id: string }) => m.id === medicine.id)).toBe(true);

    // 5. Search by name, company, email, phone
    const searchByName = await request(app)
      .get(`/api/v1/mrs?search=${encodeURIComponent(mrName)}`)
      .set(auth(tokens.employee));
    expect(searchByName.status).toBe(200);
    expect(searchByName.body.mrs.some((item: { id: string }) => item.id === createdMr.id)).toBe(true);

    const searchByPhone = await request(app)
      .get(`/api/v1/mrs?search=${mrPhone}`)
      .set(auth(tokens.employee));
    expect(searchByPhone.status).toBe(200);
    expect(searchByPhone.body.mrs.some((item: { id: string }) => item.id === createdMr.id)).toBe(true);

    // 6. Filter by company
    const filterByCompany = await request(app)
      .get(`/api/v1/mrs?company=${encodeURIComponent(mrCompany)}`)
      .set(auth(tokens.employee));
    expect(filterByCompany.status).toBe(200);
    expect(filterByCompany.body.mrs.every((item: { company: string }) => item.company?.includes(mrCompany))).toBe(true);

    // 7. Sort by name asc & desc
    const sortAsc = await request(app)
      .get('/api/v1/mrs?sortBy=name&sortOrder=asc')
      .set(auth(tokens.employee));
    expect(sortAsc.status).toBe(200);

    const sortDesc = await request(app)
      .get('/api/v1/mrs?sortBy=name&sortOrder=desc')
      .set(auth(tokens.employee));
    expect(sortDesc.status).toBe(200);

    // 8. Pagination
    const paginated = await request(app)
      .get('/api/v1/mrs?page=1&limit=2')
      .set(auth(tokens.employee));
    expect(paginated.status).toBe(200);
    expect(paginated.body.mrs.length).toBeLessThanOrEqual(2);
    expect(paginated.body.page).toBe(1);
    expect(paginated.body.limit).toBe(2);
    expect(typeof paginated.body.total).toBe('number');

    // 9. Update MR
    const updateRes = await request(app)
      .patch(`/api/v1/mrs/${createdMr.id}`)
      .set(auth(tokens.admin))
      .send({ notes: 'Updated notes with coverage territory' });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.mr.notes).toBe('Updated notes with coverage territory');

    // 10. Soft-delete MR
    const deleteRes = await request(app)
      .delete(`/api/v1/mrs/${createdMr.id}`)
      .set(auth(tokens.admin));
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.mr.active).toBe(false);

    // Verify non-admin cannot view deactivated MR
    const getDeleted = await request(app)
      .get(`/api/v1/mrs/${createdMr.id}`)
      .set(auth(tokens.employee));
    expect(getDeleted.status).toBe(404);

    // Verify Medicine referencing deactivated MR still exists
    const getMed = await request(app)
      .get(`/api/v1/medicines/${medicine.id}`)
      .set(auth(tokens.employee));
    expect(getMed.status).toBe(200);
    expect(getMed.body.medicine.mr.id).toBe(createdMr.id);

    // Cleanup second MR
    await request(app).delete(`/api/v1/mrs/${secondMr.id}`).set(auth(tokens.admin));
  });

  it('searches MRs by associated medicine name with case-insensitivity, partial matching, deduplication, active filtering, and sorting', async () => {
    const seed = unique('MedSearchMR');
    
    // 1. Create MR 1 (Active) with two medicines
    const mr1Res = await request(app)
      .post('/api/v1/mrs')
      .set(auth(tokens.admin))
      .send({
        name: `Amit Patel ${seed}`,
        company: `Dr. Reddy's ${seed}`,
        phone: '9876543212',
        email: `amit.${seed.toLowerCase()}@drreddys.com`,
      });
    expect(mr1Res.status).toBe(201);
    const mr1 = mr1Res.body.mr;

    // Create 2 medicines for MR 1: Amoxycillin 500mg Tablet and Amoxyclav 625mg Tablet
    await createMedicine({
      name: `Amoxycillin 500mg Tablet ${seed}`,
      mrId: mr1.id,
    });
    await createMedicine({
      name: `Amoxyclav 625mg Tablet ${seed}`,
      mrId: mr1.id,
    });

    // 2. Create MR 2 (Inactive) with matching medicine
    const mr2Res = await request(app)
      .post('/api/v1/mrs')
      .set(auth(tokens.admin))
      .send({
        name: `Sunil Sharma ${seed}`,
        company: `Cipla ${seed}`,
        phone: '9123456788',
        email: `sunil.${seed.toLowerCase()}@cipla.com`,
      });
    expect(mr2Res.status).toBe(201);
    const mr2 = mr2Res.body.mr;

    await createMedicine({
      name: `Amoxycillin Suspension ${seed}`,
      mrId: mr2.id,
    });

    // Deactivate MR 2
    await request(app)
      .delete(`/api/v1/mrs/${mr2.id}`)
      .set(auth(tokens.admin));

    // 3. Create MR 3 (Active) with unrelated medicine
    const mr3Res = await request(app)
      .post('/api/v1/mrs')
      .set(auth(tokens.admin))
      .send({
        name: `Vikas Gupta ${seed}`,
        company: `Sun Pharma ${seed}`,
        phone: '9988776655',
        email: `vikas.${seed.toLowerCase()}@sunpharma.com`,
      });
    expect(mr3Res.status).toBe(201);
    const mr3 = mr3Res.body.mr;

    await createMedicine({
      name: `Paracetamol 650mg ${seed}`,
      mrId: mr3.id,
    });

    // TEST 1: Exact medicine name search matches MR 1
    const exactSearch = await request(app)
      .get(`/api/v1/mrs?search=Amoxycillin`)
      .set(auth(tokens.employee));
    expect(exactSearch.status).toBe(200);
    expect(exactSearch.body.mrs.some((m: { id: string }) => m.id === mr1.id)).toBe(true);
    expect(exactSearch.body.mrs.some((m: { id: string }) => m.id === mr3.id)).toBe(false);

    // TEST 2: Case-insensitive search ('amoxycillin', 'AMOXYCILLIN')
    const lowerSearch = await request(app)
      .get(`/api/v1/mrs?search=amoxycillin`)
      .set(auth(tokens.employee));
    expect(lowerSearch.status).toBe(200);
    expect(lowerSearch.body.mrs.some((m: { id: string }) => m.id === mr1.id)).toBe(true);

    const upperSearch = await request(app)
      .get(`/api/v1/mrs?search=AMOXYCILLIN`)
      .set(auth(tokens.employee));
    expect(upperSearch.status).toBe(200);
    expect(upperSearch.body.mrs.some((m: { id: string }) => m.id === mr1.id)).toBe(true);

    // TEST 3: Partial substring search ('amoxi', '500mg', 'tablet')
    const partialSearch = await request(app)
      .get(`/api/v1/mrs?search=amoxy`)
      .set(auth(tokens.employee));
    expect(partialSearch.status).toBe(200);
    expect(partialSearch.body.mrs.some((m: { id: string }) => m.id === mr1.id)).toBe(true);

    const doseSearch = await request(app)
      .get(`/api/v1/mrs?search=500mg`)
      .set(auth(tokens.employee));
    expect(doseSearch.status).toBe(200);
    expect(doseSearch.body.mrs.some((m: { id: string }) => m.id === mr1.id)).toBe(true);

    // TEST 4: Multiple matching medicines for same MR (Amoxycillin AND Amoxyclav) returns MR only once
    const multiMedMatches = exactSearch.body.mrs.filter((m: { id: string }) => m.id === mr1.id);
    expect(multiMedMatches).toHaveLength(1);
    expect(multiMedMatches[0].medicinesCount).toBe(2);

    // TEST 5: Active filter excludes inactive MR 2 by default
    expect(exactSearch.body.mrs.some((m: { id: string }) => m.id === mr2.id)).toBe(false);

    // TEST 6: includeInactive=true includes inactive MR 2
    const inactiveSearch = await request(app)
      .get(`/api/v1/mrs?search=Amoxycillin&includeInactive=true`)
      .set(auth(tokens.admin));
    expect(inactiveSearch.status).toBe(200);
    expect(inactiveSearch.body.mrs.some((m: { id: string }) => m.id === mr1.id)).toBe(true);
    expect(inactiveSearch.body.mrs.some((m: { id: string }) => m.id === mr2.id)).toBe(true);

    // TEST 7: Search with sorting
    const sortedSearch = await request(app)
      .get(`/api/v1/mrs?search=Amoxycillin&sortBy=name&sortOrder=desc&includeInactive=true`)
      .set(auth(tokens.admin));
    expect(sortedSearch.status).toBe(200);
    const matchingIds = sortedSearch.body.mrs
      .filter((m: { id: string }) => m.id === mr1.id || m.id === mr2.id)
      .map((m: { id: string }) => m.id);
    expect(matchingIds).toEqual([mr2.id, mr1.id]); // 'Sunil Sharma' before 'Amit Patel' in DESC

    // TEST 8: Non-matching medicine search returns empty results
    const nonMatching = await request(app)
      .get(`/api/v1/mrs?search=NonExistentMedicineName9999`)
      .set(auth(tokens.employee));
    expect(nonMatching.status).toBe(200);
    expect(nonMatching.body.mrs).toHaveLength(0);
    expect(nonMatching.body.total).toBe(0);

    // Cleanup
    await request(app).delete(`/api/v1/mrs/${mr1.id}`).set(auth(tokens.admin));
    await request(app).delete(`/api/v1/mrs/${mr3.id}`).set(auth(tokens.admin));
  });

  it('rejects invalid MR input, invalid sort/filter, and enforces authorization', async () => {
    // 400 on missing name
    expect((await request(app).post('/api/v1/mrs').set(auth(tokens.admin)).send({ company: 'Missing name' })).status).toBe(400);

    // 400 on invalid UUID
    expect((await request(app).get('/api/v1/mrs/not-a-uuid').set(auth(tokens.employee))).status).toBe(400);

    // 404 on non-existent UUID
    expect((await request(app).get('/api/v1/mrs/00000000-0000-4000-8000-000000000000').set(auth(tokens.employee))).status).toBe(404);

    // 401 on unauthenticated mutation
    expect((await request(app).post('/api/v1/mrs').send({ name: 'Unauth MR' })).status).toBe(401);

    // 403 on non-admin mutation
    expect((await request(app).post('/api/v1/mrs').set(auth(tokens.employee)).send({ name: 'Forbidden MR' })).status).toBe(403);
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

  it('atomically creates medicine with multiple inline salts, commercialDetails, and reuses identical composition', async () => {
    const saltA = await createSalt('Paracetamol-' + unique('Salt'));
    const saltB = await createSalt('Caffeine-' + unique('Salt'));

    const mr = await createMr();
    const barcode = 'BC-' + unique('CODE');

    // 1. Create medicine with 2 salts and commercialDetails inline
    const createRes = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: 'MultiSalt Medicine ' + unique('Name'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        shortDescription: 'Analgesic combination',
        imageUrl: 'https://cdn.example.com/combo.png',
        uses: 'Headaches and pain',
        recommendedAgeGroup: 'Adults',
        directions: 'Take 1 tablet every 6 hours',
        warnings: 'Do not exceed maximum daily dosage',
        storageInstructions: 'Store in cool dry place',
        barcode,
        prescriptionRequired: false,
        manufacturerId,
        mrId: mr.id,
        salts: [
          { saltId: saltA.id, amount: 500, unit: 'MG' },
          { saltId: saltB.id, amount: 65, unit: 'MG' },
        ],
        commercialDetails: {
          purchaseRate: 8.5,
          mrp: 15.0,
          discountPercent: 10,
          privateNotes: 'Initial commercial contract',
        },
      });

    expect(createRes.status).toBe(201);
    const med1 = createRes.body.medicine;
    expect(med1.id).toBeDefined();
    expect(med1.composition.displayText).toContain('500');
    expect(med1.composition.displayText).toContain('65');
    expect(med1.mrp).toBe(15);
    expect(med1.barcode).toBe(barcode);
    expect(med1.mr.id).toBe(mr.id);

    // Verify commercialDetails record was created
    const commRes = await request(app)
      .get(`/api/v1/medicines/${med1.id}/commercial-details`)
      .set(auth(tokens.admin));
    expect(commRes.status).toBe(200);
    expect(commRes.body.commercialDetails.purchaseRate).toBe(8.5);
    expect(commRes.body.commercialDetails.mrp).toBe(15);
    expect(commRes.body.commercialDetails.discountPercent).toBe(10);

    // 2. Create another medicine with EXACT same salts and amounts -> must reuse existing compositionId!
    const createRes2 = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: 'Second MultiSalt Medicine ' + unique('Name'),
        form: 'CAPSULE',
        packQuantity: 20,
        packUnit: 'CAPSULE',
        prescriptionRequired: false,
        manufacturerId,
        mrId: null,
        salts: [
          { saltId: saltA.id, amount: 500, unit: 'MG' },
          { saltId: saltB.id, amount: 65, unit: 'MG' },
        ],
      });

    expect(createRes2.status).toBe(201);
    const med2 = createRes2.body.medicine;
    expect(med2.composition.id).toBe(med1.composition.id);

    // 3. Reject duplicate barcode
    const dupBarcodeRes = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: 'Dup Barcode Med ' + unique('Name'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        barcode, // already used above
        prescriptionRequired: false,
        manufacturerId,
        mrId: null,
        compositionId: med1.composition.id,
      });
    expect(dupBarcodeRes.status).toBe(409);
    expect(dupBarcodeRes.body.error.code).toBe('DUPLICATE_BARCODE');

    // 4. Reject non-existent salt
    const badSaltRes = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: 'Bad Salt Med ' + unique('Name'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        mrId: null,
        salts: [{ saltId: '00000000-0000-4000-8000-000000000000', amount: 100, unit: 'MG' }],
      });
    expect(badSaltRes.status).toBe(404);
    expect(badSaltRes.body.error.code).toBe('SALT_NOT_FOUND');

    // 5. Reject missing composition and salts
    const missingCompRes = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: 'Missing Comp Med ' + unique('Name'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerId,
        mrId: null,
      });
    expect(missingCompRes.status).toBe(400);
    expect(missingCompRes.body.error.code).toBe('VALIDATION_ERROR');
  });

  describe('Medicine Editing (PATCH /api/v1/medicines/:id)', () => {
    it('handles comprehensive medicine updates including salts, commercialDetails, metadata, and relations', async () => {
      const salt1 = await createSalt('UpdateSalt-A-' + unique('S'));
      const salt2 = await createSalt('UpdateSalt-B-' + unique('S'));
      const salt3 = await createSalt('UpdateSalt-C-' + unique('S'));
      const mr1 = await createMr();
      const mr2 = await createMr();
      const initialBarcode = 'BC-INIT-' + unique('CODE');

      // Create base medicine
      const createRes = await request(app)
        .post('/api/v1/medicines')
        .set(auth(tokens.admin))
        .send({
          name: 'Original Med Name ' + unique('N'),
          form: 'TABLET',
          packQuantity: 10,
          packUnit: 'TABLET',
          shortDescription: 'Original description',
          imageUrl: 'https://cdn.example.com/initial.png',
          uses: 'Original uses',
          recommendedAgeGroup: 'Adults',
          directions: 'Original directions',
          warnings: 'Original warnings',
          storageInstructions: 'Store cool',
          barcode: initialBarcode,
          prescriptionRequired: false,
          manufacturerId,
          mrId: mr1.id,
          salts: [{ saltId: salt1.id, amount: 250, unit: 'MG' }],
          commercialDetails: {
            purchaseRate: 50.0,
            mrp: 100.0,
            discountPercent: 10,
            privateNotes: 'Initial commercial notes',
          },
        });
      expect(createRes.status).toBe(201);
      const medId = createRes.body.medicine.id;

      // 1. Update basic fields (name, form, packQuantity, packUnit, medical fields, prescription)
      const updateBasicRes = await request(app)
        .patch(`/api/v1/medicines/${medId}`)
        .set(auth(tokens.admin))
        .send({
          name: 'Updated Med Name ' + unique('N'),
          form: 'CAPSULE',
          packQuantity: 30,
          packUnit: 'CAPSULE',
          shortDescription: 'Updated category',
          uses: 'Updated therapeutic uses',
          recommendedAgeGroup: 'Elderly',
          directions: 'Take 2 capsules daily',
          warnings: 'Severe warnings apply',
          storageInstructions: 'Refrigerate 2-8 C',
          prescriptionRequired: true,
        });
      expect(updateBasicRes.status).toBe(200);
      expect(updateBasicRes.body.medicine.name).toContain('Updated Med Name');
      expect(updateBasicRes.body.medicine.form).toBe('CAPSULE');
      expect(updateBasicRes.body.medicine.packQuantity).toBe(30);
      expect(updateBasicRes.body.medicine.packUnit).toBe('CAPSULE');
      expect(updateBasicRes.body.medicine.shortDescription).toBe('Updated category');
      expect(updateBasicRes.body.medicine.uses).toBe('Updated therapeutic uses');
      expect(updateBasicRes.body.medicine.recommendedAgeGroup).toBe('Elderly');
      expect(updateBasicRes.body.medicine.directions).toBe('Take 2 capsules daily');
      expect(updateBasicRes.body.medicine.warnings).toBe('Severe warnings apply');
      expect(updateBasicRes.body.medicine.storageInstructions).toBe('Refrigerate 2-8 C');
      expect(updateBasicRes.body.medicine.prescriptionRequired).toBe(true);
      // Unspecified fields preserved
      expect(updateBasicRes.body.medicine.barcode).toBe(initialBarcode);
      expect(updateBasicRes.body.medicine.imageUrl).toBe('https://cdn.example.com/initial.png');
      expect(updateBasicRes.body.medicine.mr.id).toBe(mr1.id);

      // 2. Update MR (switch to another MR and clear MR)
      const switchMrRes = await request(app)
        .patch(`/api/v1/medicines/${medId}`)
        .set(auth(tokens.admin))
        .send({ mrId: mr2.id });
      expect(switchMrRes.status).toBe(200);
      expect(switchMrRes.body.medicine.mr.id).toBe(mr2.id);

      const clearMrRes = await request(app)
        .patch(`/api/v1/medicines/${medId}`)
        .set(auth(tokens.admin))
        .send({ mrId: null });
      expect(clearMrRes.status).toBe(200);
      expect(clearMrRes.body.medicine.mr).toBeNull();

      // 3. Update salts (add second salt, edit strength, remove salt)
      const multiSaltRes = await request(app)
        .patch(`/api/v1/medicines/${medId}`)
        .set(auth(tokens.admin))
        .send({
          salts: [
            { saltId: salt1.id, amount: 500, unit: 'MG' },
            { saltId: salt2.id, amount: 65, unit: 'MG' },
          ],
        });
      expect(multiSaltRes.status).toBe(200);
      expect(multiSaltRes.body.medicine.composition.displayText).toContain('500');
      expect(multiSaltRes.body.medicine.composition.displayText).toContain('65');

      const replaceSaltRes = await request(app)
        .patch(`/api/v1/medicines/${medId}`)
        .set(auth(tokens.admin))
        .send({
          salts: [{ saltId: salt3.id, amount: 10, unit: 'ML' }],
        });
      expect(replaceSaltRes.status).toBe(200);
      expect(replaceSaltRes.body.medicine.composition.displayText).toContain('10');
      expect(replaceSaltRes.body.medicine.composition.displayText).toContain('ML');

      // 4. Update Commercial Details & MRP
      const commUpdateRes = await request(app)
        .patch(`/api/v1/medicines/${medId}`)
        .set(auth(tokens.admin))
        .send({
          commercialDetails: {
            purchaseRate: 75.5,
            mrp: 150.0,
            discountPercent: 15,
            privateNotes: 'Updated supplier terms 45 days',
          },
        });
      expect(commUpdateRes.status).toBe(200);
      expect(commUpdateRes.body.medicine.mrp).toBe(150.0);

      const getCommRes = await request(app)
        .get(`/api/v1/medicines/${medId}/commercial-details`)
        .set(auth(tokens.admin));
      expect(getCommRes.status).toBe(200);
      expect(getCommRes.body.commercialDetails.purchaseRate).toBe(75.5);
      expect(getCommRes.body.commercialDetails.mrp).toBe(150.0);
      expect(getCommRes.body.commercialDetails.discountPercent).toBe(15);
      expect(getCommRes.body.commercialDetails.privateNotes).toBe('Updated supplier terms 45 days');

      // 5. Barcode updates & duplicate barcode conflict
      const updatedBarcode = 'BC-NEW-' + unique('CODE');
      const updateBarcodeRes = await request(app)
        .patch(`/api/v1/medicines/${medId}`)
        .set(auth(tokens.admin))
        .send({ barcode: updatedBarcode });
      expect(updateBarcodeRes.status).toBe(200);
      expect(updateBarcodeRes.body.medicine.barcode).toBe(updatedBarcode);

      // Duplicate barcode conflict test
      const med2 = await createMedicine();
      const dupBarcodeRes = await request(app)
        .patch(`/api/v1/medicines/${med2.id}`)
        .set(auth(tokens.admin))
        .send({ barcode: updatedBarcode });
      expect(dupBarcodeRes.status).toBe(409);
      expect(dupBarcodeRes.body.error.code).toBe('DUPLICATE_BARCODE');

      // 6. Error handling: invalid UUID, not found, unauthorized
      const badUuidRes = await request(app)
        .patch('/api/v1/medicines/invalid-uuid')
        .set(auth(tokens.admin))
        .send({ name: 'Test' });
      expect(badUuidRes.status).toBe(400);

      const notFoundRes = await request(app)
        .patch('/api/v1/medicines/00000000-0000-4000-8000-000000000000')
        .set(auth(tokens.admin))
        .send({ name: 'Test' });
      expect(notFoundRes.status).toBe(404);
      expect(notFoundRes.body.error.code).toBe('MEDICINE_NOT_FOUND');

      const employeeForbiddenRes = await request(app)
        .patch(`/api/v1/medicines/${medId}`)
        .set(auth(tokens.employee))
        .send({ name: 'Unauthorized Name' });
      expect(employeeForbiddenRes.status).toBe(403);

      const noAuthRes = await request(app)
        .patch(`/api/v1/medicines/${medId}`)
        .send({ name: 'No Auth Name' });
      expect(noAuthRes.status).toBe(401);
    });
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
    await request(app).post(path).set(auth(tokens.admin)).send({ purchaseRate: 888.81, mrp: 1999.91, discountPercent: 7, scheme: { secret: 'LEAK-CHECK' }, privateNotes: 'PRIVATE-LEAK-CHECK' });
    const medicineResponse = await request(app).get(`/api/v1/medicines/${medicine.id}`).set(auth(tokens.employee));
    const batchResponse = await request(app).get(`/api/v1/batches/${batch.id}`).set(auth(tokens.employee));
    for (const response of [medicineResponse, batchResponse]) {
      expect(JSON.stringify(response.body)).not.toContain('888.81');
      expect(JSON.stringify(response.body)).not.toContain('purchaseRate');
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

  it('handles invalid UUID, non-existent medicine, and missing commercial details correctly', async () => {
    // 1. Invalid UUID
    const invalidPath = '/api/v1/medicines/invalid-uuid-12345/commercial-details';
    const invalidRes = await request(app).get(invalidPath).set(auth(tokens.admin));
    expect(invalidRes.status).toBe(400);
    expect(invalidRes.body.error.code).toBe('VALIDATION_ERROR');

    // 2. Non-existent medicine
    const nonExistentPath = '/api/v1/medicines/00000000-0000-4000-8000-000000000000/commercial-details';
    const nonExistentRes = await request(app).get(nonExistentPath).set(auth(tokens.admin));
    expect(nonExistentRes.status).toBe(404);
    expect(nonExistentRes.body.error.code).toBe('MEDICINE_NOT_FOUND');

    // 3. Medicine exists but has no CommercialDetails
    const medicine = await createMedicine({ mrId: null });
    const missingPath = `/api/v1/medicines/${medicine.id}/commercial-details`;
    const missingRes = await request(app).get(missingPath).set(auth(tokens.admin));
    expect(missingRes.status).toBe(404);
    expect(missingRes.body.error.code).toBe('COMMERCIAL_DETAILS_NOT_FOUND');
  });

  it('supports server-side MRP filtering in GET /api/v1/medicines', async () => {
    const medA = await createMedicine({ mrId: null });
    const medB = await createMedicine({ mrId: null });
    await request(app)
      .post(`/api/v1/medicines/${medA.id}/commercial-details`)
      .set(auth(tokens.admin))
      .send({ purchaseRate: 20, mrp: 50, discountPercent: 5 });
    await request(app)
      .post(`/api/v1/medicines/${medB.id}/commercial-details`)
      .set(auth(tokens.admin))
      .send({ purchaseRate: 100, mrp: 250, discountPercent: 10 });

    // Query with price filter [40, 100]
    const resFiltered = await request(app)
      .get('/api/v1/medicines?minPrice=40&maxPrice=100')
      .set(auth(tokens.employee));
    expect(resFiltered.status).toBe(200);
    const ids = resFiltered.body.medicines.map((m: { id: string }) => m.id);
    expect(ids).toContain(medA.id);
    expect(ids).not.toContain(medB.id);

    // Verify mrp field is included on PublicMedicine
    const medAResponse = resFiltered.body.medicines.find((m: { id: string }) => m.id === medA.id);
    expect(medAResponse.mrp).toBe(50);
  });

  it('supports server-side sorting for name, mrp, packQuantity, createdAt, updatedAt', async () => {
    const med1 = await createMedicine({ name: 'Alpha-Medicine', packQuantity: 10, mrId: null });
    const med2 = await createMedicine({ name: 'Beta-Medicine', packQuantity: 50, mrId: null });
    await request(app)
      .post(`/api/v1/medicines/${med1.id}/commercial-details`)
      .set(auth(tokens.admin))
      .send({ purchaseRate: 10, mrp: 100, discountPercent: 0 });
    await request(app)
      .post(`/api/v1/medicines/${med2.id}/commercial-details`)
      .set(auth(tokens.admin))
      .send({ purchaseRate: 10, mrp: 30, discountPercent: 0 });

    // 1. Sort by name asc (Alpha before Beta)
    const resNameAsc = await request(app).get('/api/v1/medicines?sortBy=name&sortOrder=asc').set(auth(tokens.employee));
    expect(resNameAsc.status).toBe(200);
    const namesAsc = resNameAsc.body.medicines.map((m: { name: string }) => m.name);
    const alphaIdx1 = namesAsc.indexOf('Alpha-Medicine');
    const betaIdx1 = namesAsc.indexOf('Beta-Medicine');
    expect(alphaIdx1).toBeLessThan(betaIdx1);

    // 2. Sort by name desc (Beta before Alpha)
    const resNameDesc = await request(app).get('/api/v1/medicines?sortBy=name&sortOrder=desc').set(auth(tokens.employee));
    expect(resNameDesc.status).toBe(200);
    const namesDesc = resNameDesc.body.medicines.map((m: { name: string }) => m.name);
    const alphaIdx2 = namesDesc.indexOf('Alpha-Medicine');
    const betaIdx2 = namesDesc.indexOf('Beta-Medicine');
    expect(betaIdx2).toBeLessThan(alphaIdx2);

    // 3. Sort by mrp asc (med2 ₹30 before med1 ₹100)
    const resMrpAsc = await request(app).get('/api/v1/medicines?sortBy=mrp&sortOrder=asc').set(auth(tokens.employee));
    expect(resMrpAsc.status).toBe(200);
    const idsMrpAsc = resMrpAsc.body.medicines.map((m: { id: string }) => m.id);
    expect(idsMrpAsc.indexOf(med2.id)).toBeLessThan(idsMrpAsc.indexOf(med1.id));

    // 4. Sort by mrp desc (med1 ₹100 before med2 ₹30)
    const resMrpDesc = await request(app).get('/api/v1/medicines?sortBy=mrp&sortOrder=desc').set(auth(tokens.employee));
    expect(resMrpDesc.status).toBe(200);
    const idsMrpDesc = resMrpDesc.body.medicines.map((m: { id: string }) => m.id);
    expect(idsMrpDesc.indexOf(med1.id)).toBeLessThan(idsMrpDesc.indexOf(med2.id));

    // 5. Sort by packQuantity asc (med1 10 before med2 50)
    const resQtyAsc = await request(app).get('/api/v1/medicines?sortBy=packQuantity&sortOrder=asc').set(auth(tokens.employee));
    expect(resQtyAsc.status).toBe(200);
    const idsQtyAsc = resQtyAsc.body.medicines.map((m: { id: string }) => m.id);
    expect(idsQtyAsc.indexOf(med1.id)).toBeLessThan(idsQtyAsc.indexOf(med2.id));

    // 6. Sort by packQuantity desc (med2 50 before med1 10)
    const resQtyDesc = await request(app).get('/api/v1/medicines?sortBy=packQuantity&sortOrder=desc').set(auth(tokens.employee));
    expect(resQtyDesc.status).toBe(200);
    const idsQtyDesc = resQtyDesc.body.medicines.map((m: { id: string }) => m.id);
    expect(idsQtyDesc.indexOf(med2.id)).toBeLessThan(idsQtyDesc.indexOf(med1.id));

    // 7. Invalid sort field -> 400 validation error
    const resInvalid = await request(app).get('/api/v1/medicines?sortBy=unsupportedField').set(auth(tokens.employee));
    expect(resInvalid.status).toBe(400);
    expect(resInvalid.body.error.code).toBe('VALIDATION_ERROR');
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

  it('supports autocomplete dynamic manufacturer and salt creation and reuse during medicine create and update', async () => {
    const novelMfgName = 'Novel Pharma ' + unique('Mfg');
    const novelSaltA = 'NovelSaltA ' + unique('Salt');
    const novelSaltB = 'NovelSaltB ' + unique('Salt');
    const barcode = 'AC-' + unique('BC');

    // 1. Create medicine with new manufacturer by name and new salts by name
    const createRes = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: 'Autocomplete Medicine ' + unique('Name'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerName: novelMfgName,
        barcode,
        salts: [
          { name: novelSaltA, amount: 250, unit: 'MG' },
          { name: novelSaltB, amount: 50, unit: 'MG' },
        ],
      });

    expect(createRes.status).toBe(201);
    const med1 = createRes.body.medicine;
    expect(med1.id).toBeDefined();
    expect(med1.manufacturer.name).toBe(novelMfgName);
    expect(med1.composition.displayText).toContain(novelSaltA);
    expect(med1.composition.displayText).toContain(novelSaltB);

    // Verify manufacturer was persisted in DB
    const mfgRecord = await prisma.manufacturer.findUnique({ where: { id: med1.manufacturer.id } });
    expect(mfgRecord).not.toBeNull();
    expect(mfgRecord?.name).toBe(novelMfgName);

    // Verify salts were persisted in DB
    const saltRecordA = await prisma.salt.findFirst({ where: { name: novelSaltA } });
    const saltRecordB = await prisma.salt.findFirst({ where: { name: novelSaltB } });
    expect(saltRecordA).not.toBeNull();
    expect(saltRecordB).not.toBeNull();

    // 2. Create another medicine with case-insensitive existing manufacturer name and salt names -> MUST reuse existing records!
    const createRes2 = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: 'Second Autocomplete Medicine ' + unique('Name'),
        form: 'CAPSULE',
        packQuantity: 20,
        packUnit: 'CAPSULE',
        prescriptionRequired: false,
        manufacturerName: novelMfgName.toLowerCase(),
        salts: [
          { name: novelSaltA.toUpperCase(), amount: 250, unit: 'MG' },
          { name: novelSaltB.toLowerCase(), amount: 50, unit: 'MG' },
        ],
      });

    expect(createRes2.status).toBe(201);
    const med2 = createRes2.body.medicine;
    expect(med2.manufacturer.id).toBe(med1.manufacturer.id);
    expect(med2.composition.id).toBe(med1.composition.id);

    // 3. Update medicine with a new manufacturer and a new salt
    const updatedMfgName = 'Updated Novel Pharma ' + unique('Mfg');
    const updatedSaltName = 'UpdatedNovelSalt ' + unique('Salt');

    const updateRes = await request(app)
      .patch(`/api/v1/medicines/${med1.id}`)
      .set(auth(tokens.admin))
      .send({
        manufacturerName: updatedMfgName,
        salts: [
          { name: updatedSaltName, amount: 100, unit: 'MG' },
        ],
      });

    expect(updateRes.status).toBe(200);
    const updatedMed = updateRes.body.medicine;
    expect(updatedMed.manufacturer.name).toBe(updatedMfgName);
    expect(updatedMed.composition.displayText).toContain(updatedSaltName);

    // 4. Transaction rollback on barcode conflict with a new manufacturer
    const unpersistedMfg = 'ShouldRollback Pharma ' + unique('Mfg');
    const conflictRes = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: 'Conflict Medicine',
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerName: unpersistedMfg,
        barcode, // duplicate barcode from med1
        salts: [{ name: novelSaltA, amount: 250, unit: 'MG' }],
      });

    expect(conflictRes.status).toBe(409);
    expect(conflictRes.body.error.code).toBe('DUPLICATE_BARCODE');

    const rollbackMfg = await prisma.manufacturer.findFirst({ where: { name: unpersistedMfg } });
    expect(rollbackMfg).toBeNull();
  });

  it('DELETE /api/v1/medicines/:id handles authorization, soft-deletion, shared entities, and catalogue exclusions', async () => {
    // 1. Setup a medicine with a shared manufacturer, shared composition, batches, and commercial details
    const mfgName = 'Shared Mfg ' + unique('Mfg');
    const saltName = 'Shared Salt ' + unique('Salt');
    const createRes = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: 'Delete Target Medicine ' + unique('Med'),
        form: 'TABLET',
        packQuantity: 10,
        packUnit: 'TABLET',
        prescriptionRequired: false,
        manufacturerName: mfgName,
        salts: [{ name: saltName, amount: 500, unit: 'MG' }],
        commercialDetails: {
          mrp: 120.0,
          purchaseRate: 90.0,
          discountPercent: 10.0,
        },
      });

    expect(createRes.status).toBe(201);
    const targetMedicine = createRes.body.medicine;
    const targetId = targetMedicine.id;
    const mfgId = targetMedicine.manufacturer.id;
    const compId = targetMedicine.composition.id;

    // Create a batch for the target medicine
    await prisma.batch.create({
      data: {
        medicineId: targetId,
        batchNumber: 'BATCH-DEL-001',
        expiryDate: new Date('2028-12-31'),
      },
    });

    // Create a second medicine sharing the same manufacturer and composition
    const secondMedRes = await request(app)
      .post('/api/v1/medicines')
      .set(auth(tokens.admin))
      .send({
        name: 'Sibling Medicine ' + unique('Med'),
        form: 'CAPSULE',
        packQuantity: 20,
        packUnit: 'CAPSULE',
        prescriptionRequired: false,
        manufacturerName: mfgName,
        salts: [{ name: saltName, amount: 500, unit: 'MG' }],
      });

    expect(secondMedRes.status).toBe(201);
    const siblingMedicine = secondMedRes.body.medicine;

    // 2. Authentication and Authorization checks
    // Unauthenticated request -> 401
    const unauthRes = await request(app).delete(`/api/v1/medicines/${targetId}`);
    expect(unauthRes.status).toBe(401);

    // Non-admin (EMPLOYEE) request -> 403
    const forbiddenRes = await request(app)
      .delete(`/api/v1/medicines/${targetId}`)
      .set(auth(tokens.employee));
    expect(forbiddenRes.status).toBe(403);

    // Invalid UUID format -> 400
    const badIdRes = await request(app)
      .delete('/api/v1/medicines/invalid-uuid')
      .set(auth(tokens.admin));
    expect(badIdRes.status).toBe(400);

    // Non-existent UUID -> 404
    const notFoundRes = await request(app)
      .delete('/api/v1/medicines/00000000-0000-4000-8000-000000000000')
      .set(auth(tokens.admin));
    expect(notFoundRes.status).toBe(404);

    // 3. Successful Deletion (Admin)
    const deleteRes = await request(app)
      .delete(`/api/v1/medicines/${targetId}`)
      .set(auth(tokens.admin));

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.medicine.id).toBe(targetId);
    expect(deleteRes.body.medicine.active).toBe(false);

    // 4. Verify DB State: Medicine is soft-deleted, relations intact
    const dbMed = await prisma.medicine.findUnique({
      where: { id: targetId },
      include: { batches: true, commercialDetails: true },
    });
    expect(dbMed).not.toBeNull();
    expect(dbMed?.active).toBe(false);
    expect(dbMed?.batches.length).toBe(1);
    expect(dbMed?.commercialDetails).not.toBeNull();

    // 5. Shared entities remain active and untouched
    const dbMfg = await prisma.manufacturer.findUnique({ where: { id: mfgId } });
    expect(dbMfg?.active).toBe(true);

    const dbComp = await prisma.composition.findUnique({ where: { id: compId } });
    expect(dbComp?.active).toBe(true);

    // Sibling medicine remains active
    const dbSibling = await prisma.medicine.findUnique({ where: { id: siblingMedicine.id } });
    expect(dbSibling?.active).toBe(true);

    // 6. Catalogue exclusions: Deleted medicine disappears from normal catalogue
    const getDeletedNormal = await request(app)
      .get(`/api/v1/medicines/${targetId}`)
      .set(auth(tokens.employee));
    expect(getDeletedNormal.status).toBe(404);

    const listNormal = await request(app)
      .get('/api/v1/medicines')
      .set(auth(tokens.employee));
    expect(listNormal.status).toBe(200);
    const listedIds = listNormal.body.medicines.map((m: { id: string }) => m.id);
    expect(listedIds).not.toContain(targetId);
    expect(listedIds).toContain(siblingMedicine.id);

    // 7. Repeated deletion request is handled idempotently
    const repeatDeleteRes = await request(app)
      .delete(`/api/v1/medicines/${targetId}`)
      .set(auth(tokens.admin));
    expect(repeatDeleteRes.status).toBe(200);
    expect(repeatDeleteRes.body.medicine.active).toBe(false);
  });

  it('manages MR medicine assignments (get, assign, reassign, unassign, conflict check)', async () => {
    // 1. Create two MRs
    const mr1Res = await request(app)
      .post('/api/v1/mrs')
      .set(auth(tokens.admin))
      .send({ name: unique('AssigneeMR1'), company: 'Pharma One', phone: '+91 99999 11111' });
    expect(mr1Res.status).toBe(201);
    const mr1Id = mr1Res.body.mr.id;

    const mr2Res = await request(app)
      .post('/api/v1/mrs')
      .set(auth(tokens.admin))
      .send({ name: unique('AssigneeMR2'), company: 'Pharma Two', phone: '+91 99999 22222' });
    expect(mr2Res.status).toBe(201);
    const mr2Id = mr2Res.body.mr.id;

    // 2. Create medicines
    const comp = await createComposition();
    const med1 = await createMedicine({ compositionId: comp.id, name: unique('AssignedMed1'), mrId: null });
    const med2 = await createMedicine({ compositionId: comp.id, name: unique('AssignedMed2'), mrId: null });
    const med3 = await createMedicine({ compositionId: comp.id, name: unique('AssignedMed3'), mrId: null });

    // 3. GET /mrs/:id/medicines when empty
    const getEmptyRes = await request(app)
      .get(`/api/v1/mrs/${mr1Id}/medicines`)
      .set(auth(tokens.employee));
    expect(getEmptyRes.status).toBe(200);
    expect(getEmptyRes.body.medicines).toEqual([]);
    expect(getEmptyRes.body.count).toBe(0);

    // 4. Authorization checks
    const unauthPut = await request(app)
      .put(`/api/v1/mrs/${mr1Id}/medicines`)
      .send({ medicineIds: [med1.id] });
    expect(unauthPut.status).toBe(401);

    const employeePut = await request(app)
      .put(`/api/v1/mrs/${mr1Id}/medicines`)
      .set(auth(tokens.employee))
      .send({ medicineIds: [med1.id] });
    expect(employeePut.status).toBe(403);

    // 5. Validation errors
    const invalidMrId = await request(app)
      .put('/api/v1/mrs/not-a-uuid/medicines')
      .set(auth(tokens.admin))
      .send({ medicineIds: [med1.id] });
    expect(invalidMrId.status).toBe(400);

    const nonExistentMr = await request(app)
      .put('/api/v1/mrs/00000000-0000-4000-8000-000000000000/medicines')
      .set(auth(tokens.admin))
      .send({ medicineIds: [med1.id] });
    expect(nonExistentMr.status).toBe(404);

    const nonExistentMed = await request(app)
      .put(`/api/v1/mrs/${mr1Id}/medicines`)
      .set(auth(tokens.admin))
      .send({ medicineIds: ['00000000-0000-4000-8000-000000000000'] });
    expect(nonExistentMed.status).toBe(404);

    // 6. Assign multiple medicines to MR 1
    const assignRes = await request(app)
      .put(`/api/v1/mrs/${mr1Id}/medicines`)
      .set(auth(tokens.admin))
      .send({ medicineIds: [med1.id, med2.id] });
    expect(assignRes.status).toBe(200);
    expect(assignRes.body.count).toBe(2);
    const assignedIds = assignRes.body.medicines.map((m: { id: string }) => m.id);
    expect(assignedIds).toContain(med1.id);
    expect(assignedIds).toContain(med2.id);

    // Verify GET /mrs/:id/medicines reflects new assignments
    const getAssignedRes = await request(app)
      .get(`/api/v1/mrs/${mr1Id}/medicines`)
      .set(auth(tokens.employee));
    expect(getAssignedRes.status).toBe(200);
    expect(getAssignedRes.body.count).toBe(2);

    // 7. Conflict detection: MR 2 tries to assign med1 which is assigned to MR 1
    const conflictRes = await request(app)
      .put(`/api/v1/mrs/${mr2Id}/medicines`)
      .set(auth(tokens.admin))
      .send({ medicineIds: [med1.id, med3.id], allowReassign: false });
    expect(conflictRes.status).toBe(409);
    expect(conflictRes.body.error.code).toBe('ASSIGNMENT_CONFLICT');

    // 8. Reassignment with allowReassign: true
    const reassignRes = await request(app)
      .put(`/api/v1/mrs/${mr2Id}/medicines`)
      .set(auth(tokens.admin))
      .send({ medicineIds: [med1.id, med3.id], allowReassign: true });
    expect(reassignRes.status).toBe(200);
    expect(reassignRes.body.count).toBe(2);

    // Verify med1 is now under MR 2 and removed from MR 1
    const mr1Check = await request(app)
      .get(`/api/v1/mrs/${mr1Id}/medicines`)
      .set(auth(tokens.employee));
    expect(mr1Check.body.count).toBe(1);
    expect(mr1Check.body.medicines[0].id).toBe(med2.id);

    // 9. Unassign all medicines from MR 1
    const clearRes = await request(app)
      .put(`/api/v1/mrs/${mr1Id}/medicines`)
      .set(auth(tokens.admin))
      .send({ medicineIds: [] });
    expect(clearRes.status).toBe(200);
    expect(clearRes.body.count).toBe(0);
  });

  it('creates new MR with optional associated medicines (zero, one, multiple, conflict, atomic rollback)', async () => {
    const comp = await createComposition();
    const medA = await createMedicine({ compositionId: comp.id, name: unique('InitMedA'), mrId: null });
    const medB = await createMedicine({ compositionId: comp.id, name: unique('InitMedB'), mrId: null });
    const medC = await createMedicine({ compositionId: comp.id, name: unique('InitMedC'), mrId: null });

    // 1. Create MR with zero medicines (medicineIds omitted)
    const zeroRes = await request(app)
      .post('/api/v1/mrs')
      .set(auth(tokens.admin))
      .send({
        name: unique('ZeroMedMR'),
        company: 'Zero Pharma',
        phone: '+91 91111 00000',
      });
    expect(zeroRes.status).toBe(201);
    expect(zeroRes.body.mr.medicinesCount).toBe(0);
    expect(zeroRes.body.mr.medicines).toEqual([]);

    // 2. Create MR with single medicine
    const singleRes = await request(app)
      .post('/api/v1/mrs')
      .set(auth(tokens.admin))
      .send({
        name: unique('SingleMedMR'),
        company: 'Single Pharma',
        phone: '+91 92222 00000',
        medicineIds: [medA.id],
      });
    expect(singleRes.status).toBe(201);
    expect(singleRes.body.mr.medicinesCount).toBe(1);
    expect(singleRes.body.mr.medicines).toHaveLength(1);
    expect(singleRes.body.mr.medicines[0].id).toBe(medA.id);

    // Verify GET /mrs/:id returns assigned medicine
    const getSingle = await request(app)
      .get(`/api/v1/mrs/${singleRes.body.mr.id}`)
      .set(auth(tokens.employee));
    expect(getSingle.status).toBe(200);
    expect(getSingle.body.mr.medicinesCount).toBe(1);
    expect(getSingle.body.mr.medicines[0].id).toBe(medA.id);

    // 3. Create MR with multiple medicines and duplicate IDs
    const multiRes = await request(app)
      .post('/api/v1/mrs')
      .set(auth(tokens.admin))
      .send({
        name: unique('MultiMedMR'),
        company: 'Multi Pharma',
        phone: '+91 93333 00000',
        medicineIds: [medB.id, medC.id, medB.id], // duplicate medB.id
      });
    expect(multiRes.status).toBe(201);
    expect(multiRes.body.mr.medicinesCount).toBe(2);
    const multiIds = multiRes.body.mr.medicines.map((m: { id: string }) => m.id);
    expect(multiIds).toContain(medB.id);
    expect(multiIds).toContain(medC.id);

    // 4. Non-existent medicine ID -> 404 MEDICINE_NOT_FOUND and does NOT create MR
    const nonExistentName = unique('NonExistentMR');
    const badMedRes = await request(app)
      .post('/api/v1/mrs')
      .set(auth(tokens.admin))
      .send({
        name: nonExistentName,
        medicineIds: ['00000000-0000-4000-8000-000000000000'],
      });
    expect(badMedRes.status).toBe(404);
    expect(badMedRes.body.error.code).toBe('MEDICINE_NOT_FOUND');
    const checkMrNotCreated = await prisma.mR.findFirst({ where: { name: nonExistentName } });
    expect(checkMrNotCreated).toBeNull();

    // 5. Already assigned medicine conflict without allowReassign -> 409 ASSIGNMENT_CONFLICT and does NOT create MR
    const conflictName = unique('ConflictMR');
    const conflictRes = await request(app)
      .post('/api/v1/mrs')
      .set(auth(tokens.admin))
      .send({
        name: conflictName,
        medicineIds: [medA.id], // already assigned to SingleMedMR
        allowReassign: false,
      });
    expect(conflictRes.status).toBe(409);
    expect(conflictRes.body.error.code).toBe('ASSIGNMENT_CONFLICT');
    const checkConflictMr = await prisma.mR.findFirst({ where: { name: conflictName } });
    expect(checkConflictMr).toBeNull();

    // 6. Already assigned medicine with allowReassign: true -> creates MR and reassigns
    const reassignName = unique('ReassignMR');
    const reassignRes = await request(app)
      .post('/api/v1/mrs')
      .set(auth(tokens.admin))
      .send({
        name: reassignName,
        medicineIds: [medA.id],
        allowReassign: true,
      });
    expect(reassignRes.status).toBe(201);
    expect(reassignRes.body.mr.medicinesCount).toBe(1);
    expect(reassignRes.body.mr.medicines[0].id).toBe(medA.id);

    // Verify medA was unassigned from SingleMedMR
    const singleMrCheck = await request(app)
      .get(`/api/v1/mrs/${singleRes.body.mr.id}`)
      .set(auth(tokens.employee));
    expect(singleMrCheck.body.mr.medicinesCount).toBe(0);
    expect(singleMrCheck.body.mr.medicines).toEqual([]);

    // 7. Verify MR Registry list count matches
    const listRes = await request(app)
      .get(`/api/v1/mrs?search=${encodeURIComponent(reassignName)}`)
      .set(auth(tokens.employee));
    expect(listRes.status).toBe(200);
    expect(listRes.body.mrs[0].medicinesCount).toBe(1);
  });

  afterAll(async () => {
    await seedDatabase();
  });
});

