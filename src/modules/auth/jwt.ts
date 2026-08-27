import { jwtVerify, SignJWT } from 'jose';
import type { $Enums } from '@prisma/client/index';
import { z } from 'zod';
import { AppError } from '../../common/errors/app-error.js';
import { env } from '../../config/env.js';

const signingKey = new TextEncoder().encode(env.JWT_SECRET);
const roleSchema = z.enum(['ADMIN', 'EMPLOYEE']);

export type AuthClaims = {
  userId: string;
  role: $Enums.UserRole;
};

export const signAccessToken = async (claims: AuthClaims): Promise<string> =>
  new SignJWT({ role: claims.role })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.userId)
    .setIssuedAt()
    .setExpirationTime(env.JWT_EXPIRES_IN)
    .sign(signingKey);

export const verifyAccessToken = async (token: string): Promise<AuthClaims> => {
  try {
    const { payload } = await jwtVerify(token, signingKey, {
      algorithms: ['HS256'],
    });

    const role = roleSchema.safeParse(payload.role);

    if (typeof payload.sub !== 'string' || !role.success) {
      throw new Error('Invalid authentication claims');
    }

    return {
      userId: payload.sub,
      role: role.data as $Enums.UserRole,
    };
  } catch {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication is required');
  }
};
