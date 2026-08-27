import argon2 from 'argon2';
import { Prisma, type $Enums, type User } from '@prisma/client/index';
import { AppError } from '../../common/errors/app-error.js';
import { prisma } from '../../lib/prisma.js';
import type { CreateUserInput } from './user.schemas.js';

export type PublicUser = Omit<User, 'passwordHash'>;
export interface UserStore {
  user: {
    create(args: Prisma.UserCreateArgs): PromiseLike<User>;
  };
}

export const toPublicUser = (user: User): PublicUser => {
  const { passwordHash, ...publicUser } = user;
  void passwordHash;
  return publicUser;
};

export const createUser = async (
  input: CreateUserInput,
  db: UserStore = prisma,
): Promise<PublicUser> => {
  const passwordHash = await argon2.hash(input.password);

  try {
    const user = await db.user.create({
      data: {
        name: input.name,
        email: input.email ?? null,
        phone: input.phone ?? null,
        passwordHash,
        role: input.role as $Enums.UserRole,
        active: true,
      },
    });

    return toPublicUser(user);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError(409, 'DUPLICATE_IDENTIFIER', 'Email or phone is already in use');
    }

    throw error;
  }
};
