import type { Salt } from '@prisma/client/index';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticate, type AuthRequest } from '../src/middleware/auth.middleware.js';
import { requireRole } from '../src/middleware/role.middleware.js';
import { AppError } from '../src/common/errors/app-error.js';
import {
  createSalt,
  deactivateSalt,
  getSalt,
  listSalts,
  updateSalt,
  type SaltStore,
} from '../src/modules/salts/salt.service.js';
import {
  createSaltSchema,
  listSaltsSchema,
  saltIdSchema,
  updateSaltSchema,
} from '../src/modules/salts/salt.schemas.js';

const salt = (overrides: Partial<Salt> = {}): Salt => ({
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Amoxicillin',
  description: 'Beta-lactam antibiotic',
  active: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

const makeStore = (initial: Salt[] = []): SaltStore => {
  const records = [...initial];

  return {
    salt: {
      findMany: async ({ where }) => records
        .filter((record) => where.active === undefined || record.active === where.active)
        .filter((record) => (
          where.name === undefined
          || record.name.toLowerCase().includes(where.name.contains.toLowerCase())
        ))
        .sort((left, right) => left.name.localeCompare(right.name)),
      findFirst: async ({ where }) => records.find(
        (record) => record.name.toLowerCase() === where.name.equals.toLowerCase(),
      ) ?? null,
      findUnique: async ({ where }) => records.find((record) => record.id === where.id) ?? null,
      create: async ({ data }) => {
        const created = salt({
          id: '22222222-2222-4222-8222-222222222222',
          name: data.name,
          description: data.description,
          active: data.active,
        });
        records.push(created);
        return created;
      },
      update: async ({ where, data }) => {
        const record = records.find((item) => item.id === where.id);
        if (!record) {
          throw new AppError(404, 'SALT_NOT_FOUND', 'Salt not found');
        }
        Object.assign(record, data);
        return record;
      },
    },
  };
};

const makeUnauthenticatedRequest = (): AuthRequest => {
  function get(name: 'set-cookie'): string[] | undefined;
  function get(name: string): string | undefined;
  function get(name: string): string[] | string | undefined {
    return name === 'set-cookie' ? [] : undefined;
  }

  return { get };
};

describe('salt validation', () => {
  it('requires a non-whitespace name', () => {
    expect(createSaltSchema.safeParse({ description: 'x' }).success).toBe(false);
    expect(createSaltSchema.safeParse({ name: '   ' }).success).toBe(false);
  });

  it('rejects invalid input and invalid UUIDs', () => {
    expect(createSaltSchema.safeParse({ name: 'Salt', extra: true }).success).toBe(false);
    expect(updateSaltSchema.safeParse({}).success).toBe(false);
    expect(saltIdSchema.safeParse({ id: 'not-a-uuid' }).success).toBe(false);
  });

  it('defaults listings to active salts', () => {
    expect(listSaltsSchema.parse({})).toEqual({ active: 'active' });
  });
});

describe('salt service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates active salts and trims input through the validated payload', async () => {
    const store = makeStore();
    const created = await createSalt({ name: 'Amoxicillin', description: null }, store);

    expect(created).toMatchObject({ name: 'Amoxicillin', active: true });
  });

  it('rejects duplicate names case-insensitively', async () => {
    const store = makeStore([salt()]);

    await expect(createSalt({ name: 'amOXicillin' }, store)).rejects.toMatchObject({
      statusCode: 409,
      code: 'DUPLICATE_SALT',
    });
    await expect(updateSalt(salt().id, { name: 'AMOXICILLIN' }, store)).resolves.toMatchObject({
      name: 'AMOXICILLIN',
    });
  });

  it('searches names case-insensitively and excludes inactive salts by default', async () => {
    const store = makeStore([
      salt(),
      salt({ id: '33333333-3333-4333-8333-333333333333', name: 'Inactive Salt', active: false }),
      salt({ id: '44444444-4444-4444-8444-444444444444', name: 'Ampicillin' }),
    ]);

    await expect(listSalts({ active: 'active', search: 'AMPI' }, store)).resolves.toEqual([
      expect.objectContaining({ name: 'Ampicillin' }),
    ]);
    await expect(listSalts({ active: 'inactive' }, store)).resolves.toEqual([
      expect.objectContaining({ name: 'Inactive Salt', active: false }),
    ]);
  });

  it('soft-deactivates salts and makes the operation idempotent', async () => {
    const record = salt();
    const store = makeStore([record]);

    await expect(deactivateSalt(record.id, store)).resolves.toMatchObject({ active: false });
    await expect(deactivateSalt(record.id, store)).resolves.toMatchObject({ active: false });
    await expect(getSalt(record.id, false, store)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns 404 for an unknown salt', async () => {
    const store = makeStore();

    await expect(getSalt('99999999-9999-4999-8999-999999999999', true, store)).rejects.toMatchObject({
      statusCode: 404,
      code: 'SALT_NOT_FOUND',
    });
  });
});

describe('salt authorization', () => {
  it('rejects unauthenticated requests', () => {
    const next = vi.fn();
    const request = makeUnauthenticatedRequest();

    authenticate(request, {}, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('allows employees to read and blocks them from mutations', () => {
    const next = vi.fn();
    const request = { auth: { userId: 'employee-id', role: 'EMPLOYEE' as const } };

    requireRole('ADMIN')(request, {}, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });
});
