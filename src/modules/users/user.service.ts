import argon2 from 'argon2';
import { Prisma, type $Enums, type User } from '@prisma/client/index';
import { AppError } from '../../common/errors/app-error.js';
import { prisma } from '../../lib/prisma.js';
import { r2StorageService } from '../../services/storage/r2.service.js';
import type { CreateUserInput, UpdateProfileInput } from './user.schemas.js';

export type PublicUser = Omit<User, 'passwordHash'>;
export interface UserStore {
  user: {
    create(args: Prisma.UserCreateArgs): PromiseLike<User>;
    findUnique(args: Prisma.UserFindUniqueArgs): PromiseLike<User | null>;
    update(args: Prisma.UserUpdateArgs): PromiseLike<User>;
  };
}

export const toPublicUser = (user: User): PublicUser => {
  const { passwordHash, ...publicUser } = user;
  void passwordHash;
  return {
    ...publicUser,
    profileImageUrl: user.profileImageUrl ?? null,
  };
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

export const getProfile = async (
  userId: string,
  db: UserStore = prisma,
): Promise<PublicUser> => {
  const user = await db.user.findUnique({
    where: { id: userId },
  });

  if (!user || !user.active) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  }

  return toPublicUser(user);
};

export const updateProfile = async (
  userId: string,
  input: UpdateProfileInput,
  db: UserStore = prisma,
): Promise<PublicUser> => {
  const existingUser = await db.user.findUnique({
    where: { id: userId },
  });

  if (!existingUser || !existingUser.active) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  }

  const oldProfileImageUrl = existingUser.profileImageUrl;

  try {
    const updatedUser = await db.user.update({
      where: { id: userId },
      data: {
        name: input.name !== undefined ? input.name : undefined,
        email: input.email !== undefined ? input.email : undefined,
        phone: input.phone !== undefined ? input.phone : undefined,
        profileImageUrl: input.profileImageUrl !== undefined ? input.profileImageUrl : undefined,
      },
    });

    // If a new image was set and an old image existed, safely delete the old image
    if (
      input.profileImageUrl !== undefined &&
      oldProfileImageUrl &&
      oldProfileImageUrl !== input.profileImageUrl
    ) {
      await r2StorageService.deleteObjectByPublicUrl(oldProfileImageUrl);
    }

    return toPublicUser(updatedUser);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError(409, 'DUPLICATE_IDENTIFIER', 'Email or phone is already in use');
    }

    throw error;
  }
};

export const removeProfileImage = async (
  userId: string,
  db: UserStore = prisma,
): Promise<PublicUser> => {
  const existingUser = await db.user.findUnique({
    where: { id: userId },
  });

  if (!existingUser || !existingUser.active) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  }

  const oldProfileImageUrl = existingUser.profileImageUrl;

  const updatedUser = await db.user.update({
    where: { id: userId },
    data: {
      profileImageUrl: null,
    },
  });

  if (oldProfileImageUrl) {
    await r2StorageService.deleteObjectByPublicUrl(oldProfileImageUrl);
  }

  return toPublicUser(updatedUser);
};
