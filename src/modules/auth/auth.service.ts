import argon2 from 'argon2';
import { Prisma, type User } from '@prisma/client/index';
import { AppError } from '../../common/errors/app-error.js';
import { prisma } from '../../lib/prisma.js';
import type { LoginInput } from './auth.schemas.js';
import { signAccessToken } from './jwt.js';
import { toPublicUser, type PublicUser } from '../users/user.service.js';

const AUTHENTICATION_FAILURE = new AppError(
  401,
  'AUTHENTICATION_FAILED',
  'Invalid identifier or password',
);

export interface AuthStore {
  user: {
    findFirst(args: Prisma.UserFindFirstArgs): PromiseLike<User | null>;
  };
}

export type LoginResult = {
  accessToken: string;
  tokenType: 'Bearer';
  user: PublicUser;
};

export const login = async (input: LoginInput, db: AuthStore = prisma): Promise<LoginResult> => {
  const identifier = input.identifier.trim();
  const normalizedEmail = identifier.toLowerCase();
  const user = await db.user.findFirst({
    where: {
      OR: [{ email: normalizedEmail }, { phone: identifier }],
    },
  });

  if (!user || !user.active || !(await argon2.verify(user.passwordHash, input.password))) {
    throw AUTHENTICATION_FAILURE;
  }

  return {
    accessToken: await signAccessToken({ userId: user.id, role: user.role }),
    tokenType: 'Bearer',
    user: toPublicUser(user),
  };
};
