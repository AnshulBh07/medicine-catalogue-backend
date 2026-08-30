import { Prisma, $Enums } from '@prisma/client/index';
import { SignJWT } from 'jose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import argon2 from 'argon2';
import { authenticate, type AuthRequest } from '../src/middleware/auth.middleware.js';
import { requireRole, type RoleRequest } from '../src/middleware/role.middleware.js';
import { env } from '../src/config/env.js';
import { logger } from '../src/lib/logger.js';
import { signAccessToken, verifyAccessToken } from '../src/modules/auth/jwt.js';
import { login } from '../src/modules/auth/auth.service.js';
import { createUser } from '../src/modules/users/user.service.js';
import { createUserSchema, type CreateUserInput } from '../src/modules/users/user.schemas.js';

const password = 'correct-horse-battery-staple';

const makeAuthGet = (authorization?: string): AuthRequest['get'] => {
  function get(name: 'set-cookie'): string[] | undefined;
  function get(name: string): string | undefined;
  function get(name: string): string[] | string | undefined {
    return name === 'set-cookie' ? undefined : authorization;
  }

  return get;
};

const makeUser = async (overrides: Partial<{
  active: boolean;
  email: string | null;
  phone: string | null;
  profileImageUrl: string | null;
}> = {}) => ({
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Admin User',
  phone: overrides.phone ?? '+911234567890',
  email: overrides.email ?? 'admin@example.com',
  passwordHash: await argon2.hash(password),
  role: $Enums.UserRole.ADMIN,
  profileImageUrl: overrides.profileImageUrl ?? null,
  active: overrides.active ?? true,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe('authentication service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('logs in successfully and returns no passwordHash with profileImageUrl null', async () => {
    const user = await makeUser({ profileImageUrl: null });
    const store = { user: { findFirst: vi.fn().mockResolvedValue(user) } };

    const result = await login({ identifier: user.email!, password }, store);
    const claims = await verifyAccessToken(result.accessToken);

    expect(result.user).not.toHaveProperty('passwordHash');
    expect(result.user.email).toBe(user.email);
    expect(result.user.profileImageUrl).toBeNull();
    expect(claims).toEqual({ userId: user.id, role: $Enums.UserRole.ADMIN });
    expect(result.accessToken).not.toContain(password);
  });

  it('logs in successfully and returns profileImageUrl when present', async () => {
    const testUrl = 'https://images.example.com/profile-images/user-123/avatar.jpg';
    const user = await makeUser({ profileImageUrl: testUrl });
    const store = { user: { findFirst: vi.fn().mockResolvedValue(user) } };

    const result = await login({ identifier: user.email!, password }, store);

    expect(result.user.profileImageUrl).toBe(testUrl);
  });

  it.each([
    ['wrong password', { identifier: 'admin@example.com', password: 'wrong-password' }],
    ['unknown identifier', { identifier: 'unknown@example.com', password }],
  ])('rejects %s with a generic authentication failure', async (_name, input) => {
    const user = await makeUser();
    const store = {
      user: {
        findFirst: vi.fn().mockResolvedValue(
          input.identifier === user.email ? user : null,
        ),
      },
    };

    await expect(login(input, store)).rejects.toMatchObject({
      statusCode: 401,
      code: 'AUTHENTICATION_FAILED',
      message: 'Invalid identifier or password',
    });
  });

  it('rejects inactive users with the same generic authentication failure', async () => {
    const user = await makeUser({ active: false });
    const store = { user: { findFirst: vi.fn().mockResolvedValue(user) } };

    await expect(login({ identifier: user.email!, password }, store)).rejects.toMatchObject({
      statusCode: 401,
      message: 'Invalid identifier or password',
    });
  });
});

describe('JWT authentication middleware', () => {
  it('rejects a missing token with 401', async () => {
    const request: AuthRequest = { get: makeAuthGet() };
    const next = vi.fn();

    await authenticate(request, {}, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('rejects an invalid token with 401', async () => {
    const request: AuthRequest = { get: makeAuthGet('Bearer invalid-token') };
    const next = vi.fn();

    await authenticate(request, {}, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('rejects an expired token with 401', async () => {
    const key = new TextEncoder().encode(env.JWT_SECRET);
    const token = await new SignJWT({ role: $Enums.UserRole.ADMIN })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-id')
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(key);
    const request: AuthRequest = { get: makeAuthGet(`Bearer ${token}`) };
    const next = vi.fn();

    await authenticate(request, {}, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('attaches valid JWT claims to the request', async () => {
    const token = await signAccessToken({ userId: 'user-id', role: $Enums.UserRole.ADMIN });
    const request: AuthRequest = { get: makeAuthGet(`Bearer ${token}`) };
    const next = vi.fn();

    await authenticate(request, {}, next);

    expect(request.auth).toEqual({ userId: 'user-id', role: $Enums.UserRole.ADMIN });
    expect(next).toHaveBeenCalledWith();
  });
});

describe('role authorization middleware', () => {
  it('rejects unauthenticated requests with 401', () => {
    const next = vi.fn();

    const request: RoleRequest = {};

    requireRole($Enums.UserRole.ADMIN)(request, {}, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('allows ADMIN users on ADMIN-only routes', () => {
    const next = vi.fn();

    const request: RoleRequest = {
      auth: { userId: 'admin-id', role: $Enums.UserRole.ADMIN },
    };

    requireRole($Enums.UserRole.ADMIN)(request, {}, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('denies EMPLOYEE users from ADMIN-only routes with 403', () => {
    const next = vi.fn();

    const request: RoleRequest = {
      auth: { userId: 'employee-id', role: $Enums.UserRole.EMPLOYEE },
    };

    requireRole($Enums.UserRole.ADMIN)(request, {}, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });
});

describe('user creation service', () => {
  const input: CreateUserInput = {
    name: 'Employee User',
    email: 'employee@example.com',
    phone: '+919876543210',
    password,
    role: 'EMPLOYEE',
  };

  it('hashes the password, defaults active to true, and omits passwordHash', async () => {
    const createdUser = {
      ...(await makeUser()),
      name: input.name,
      email: input.email,
      phone: input.phone,
      role: $Enums.UserRole.EMPLOYEE,
      active: true,
    };
    const create = vi.fn().mockImplementation(async ({ data }) => ({
      ...createdUser,
      passwordHash: data.passwordHash,
      active: data.active,
    }));
    const store = { user: { create } };

    const result = await createUser(input, store);
    const storedPasswordHash = create.mock.calls[0][0].data.passwordHash as string;

    expect(storedPasswordHash).not.toBe(password);
    expect(await argon2.verify(storedPasswordHash, password)).toBe(true);
    expect(create.mock.calls[0][0].data.active).toBe(true);
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('maps duplicate email or phone errors to a conflict', async () => {
    const duplicateError = new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002',
      clientVersion: '7.10.0',
    });
    const store = { user: { create: vi.fn().mockRejectedValue(duplicateError) } };

    await expect(createUser(input, store)).rejects.toMatchObject({
      statusCode: 409,
      code: 'DUPLICATE_IDENTIFIER',
    });
  });
});

describe('sensitive authentication data', () => {
  it('does not log passwords or JWTs during login', async () => {
    const user = await makeUser();
    const store = { user: { findFirst: vi.fn().mockResolvedValue(user) } };
    const info = vi.spyOn(logger, 'info');
    const error = vi.spyOn(logger, 'error');

    const result = await login({ identifier: user.email!, password }, store);

    expect(info).not.toHaveBeenCalledWith(expect.stringContaining(password));
    expect(error).not.toHaveBeenCalled();
    expect(info.mock.calls.flat().join(' ')).not.toContain(result.accessToken);
  });

  it('does not include personal fields in JWT payloads', async () => {
    const token = await signAccessToken({ userId: 'user-id', role: $Enums.UserRole.EMPLOYEE });
    const [, payload] = token.split('.');
    const decoded = JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8')) as Record<string, unknown>;

    expect(decoded).not.toHaveProperty('email');
    expect(decoded).not.toHaveProperty('phone');
    expect(decoded).not.toHaveProperty('password');
    expect(decoded).not.toHaveProperty('passwordHash');
  });
});

describe('user creation validation', () => {
  const base = {
    name: 'Validation User',
    password: 'password123',
    role: 'EMPLOYEE' as const,
  };

  it.each([
    ['empty object', {}],
    ['both email and phone omitted', { ...base }],
    ['both email and phone null', { ...base, email: null, phone: null }],
    ['both email and phone empty strings', { ...base, email: '', phone: '' }],
    ['both email and phone whitespace', { ...base, email: '   ', phone: '   ' }],
  ])('rejects %s', (_label, payload) => {
    const result = createUserSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it.each([
    ['valid email only', { ...base, email: 'valid@example.com' }],
    ['valid email with phone null', { ...base, email: 'valid@example.com', phone: null }],
    ['valid phone only', { ...base, phone: '+919876543210' }],
    ['valid phone with email null', { ...base, email: null, phone: '+919876543210' }],
    ['both valid email and phone', { ...base, email: 'valid@example.com', phone: '+919876543210' }],
  ])('accepts %s', (_label, payload) => {
    const result = createUserSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });
});

