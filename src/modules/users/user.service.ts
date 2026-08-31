import argon2 from 'argon2';
import { Prisma, type $Enums, type User } from '@prisma/client/index';
import { AppError } from '../../common/errors/app-error.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { r2StorageService } from '../../services/storage/r2.service.js';
import type {
  CreateUserInput,
  ListUsersInput,
  UpdateProfileInput,
  UpdateUserInput,
} from './user.schemas.js';

export type PublicUser = Omit<User, 'passwordHash' | 'monthlySalary'> & {
  monthlySalary?: number | null;
};

export interface ListUsersResult {
  users: PublicUser[];
  total: number;
  page: number;
  limit: number;
}

export interface UserStore {
  user: {
    create(args: Prisma.UserCreateArgs): PromiseLike<User>;
    findUnique(args: Prisma.UserFindUniqueArgs): PromiseLike<User | null>;
    findMany(args: Prisma.UserFindManyArgs): PromiseLike<User[]>;
    count(args?: Prisma.UserCountArgs): PromiseLike<number>;
    update(args: Prisma.UserUpdateArgs): PromiseLike<User>;
    delete(args: Prisma.UserDeleteArgs): PromiseLike<User>;
  };
  commercialDetails?: {
    count(args?: Prisma.CommercialDetailsCountArgs): PromiseLike<number>;
  };
}

export const toPublicUser = (user: User): PublicUser => {
  const { passwordHash, ...publicUser } = user;
  void passwordHash;
  return {
    ...publicUser,
    monthlySalary: user.monthlySalary !== null && user.monthlySalary !== undefined ? Number(user.monthlySalary) : null,
    profileImageUrl: user.profileImageUrl ?? null,
  };
};

export const listUsers = async (
  input: ListUsersInput,
  db: UserStore = prisma,
): Promise<ListUsersResult> => {
  const where: Prisma.UserWhereInput = {};

  if (input.search) {
    const term = input.search.trim();
    where.OR = [
      { name: { contains: term, mode: 'insensitive' } },
      { email: { contains: term, mode: 'insensitive' } },
      { phone: { contains: term, mode: 'insensitive' } },
    ];
  }

  if (input.role) {
    where.role = input.role as $Enums.UserRole;
  }

  if (input.active !== undefined) {
    where.active = typeof input.active === 'string' ? input.active === 'true' : Boolean(input.active);
  }

  const page = input.page ? Number(input.page) : 1;
  const limit = input.limit ? Number(input.limit) : 50;
  const skip = (page - 1) * limit;
  const take = limit;

  const sortBy = input.sortBy || 'name';
  const sortOrder = input.sortOrder || 'asc';

  const orderBy: Prisma.UserOrderByWithRelationInput = {
    [sortBy]: sortOrder,
  };

  const [users, total] = await Promise.all([
    db.user.findMany({
      where,
      orderBy,
      skip,
      take,
    }),
    db.user.count({ where }),
  ]);

  return {
    users: users.map(toPublicUser),
    total,
    page,
    limit,
  };
};

export const getUserById = async (
  userId: string,
  db: UserStore = prisma,
): Promise<PublicUser> => {
  const user = await db.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  }

  return toPublicUser(user);
};

export const createUser = async (
  input: CreateUserInput,
  db: UserStore = prisma,
  requestingAdminId?: string,
): Promise<PublicUser> => {
  const passwordHash = await argon2.hash(input.password);

  try {
    const user = await db.user.create({
      data: {
        name: input.name,
        email: input.email ? input.email.trim().toLowerCase() : null,
        phone: input.phone ? input.phone.trim() : null,
        passwordHash,
        role: input.role as $Enums.UserRole,
        monthlySalary: input.monthlySalary !== undefined ? (input.monthlySalary === null ? null : input.monthlySalary) : undefined,
        active: true,
      },
    });

    if (requestingAdminId) {
      logger.info(
        { adminId: requestingAdminId, createdUserId: user.id, role: user.role },
        'Admin created new user',
      );
    }

    return toPublicUser(user);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError(409, 'DUPLICATE_IDENTIFIER', 'Email or phone is already in use');
    }

    throw error;
  }
};

export const updateUser = async (
  targetUserId: string,
  input: UpdateUserInput,
  requestingAdminId: string,
  db: UserStore = prisma,
): Promise<PublicUser> => {
  const existingUser = await db.user.findUnique({
    where: { id: targetUserId },
  });

  if (!existingUser) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  }

  // Safety rule: Admin cannot demote themselves from ADMIN
  if (targetUserId === requestingAdminId && input.role && input.role !== 'ADMIN') {
    throw new AppError(400, 'CANNOT_DEMOTE_SELF', 'You cannot change your own administrator role');
  }

  // Safety rule: Admin cannot deactivate their own account
  if (targetUserId === requestingAdminId && input.active === false) {
    throw new AppError(400, 'CANNOT_DEACTIVATE_SELF', 'You cannot deactivate your own account');
  }

  let passwordHash: string | undefined;
  if (input.password) {
    passwordHash = await argon2.hash(input.password);
  }

  try {
    const updatedUser = await db.user.update({
      where: { id: targetUserId },
      data: {
        name: input.name !== undefined ? input.name : undefined,
        email: input.email !== undefined ? (input.email ? input.email.trim().toLowerCase() : null) : undefined,
        phone: input.phone !== undefined ? (input.phone ? input.phone.trim() : null) : undefined,
        role: input.role !== undefined ? (input.role as $Enums.UserRole) : undefined,
        active: input.active !== undefined ? input.active : undefined,
        monthlySalary: input.monthlySalary !== undefined ? (input.monthlySalary === null ? null : input.monthlySalary) : undefined,
        passwordHash,
      },
    });

    logger.info(
      { adminId: requestingAdminId, targetUserId, changes: Object.keys(input) },
      'Admin updated user details',
    );

    return toPublicUser(updatedUser);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError(409, 'DUPLICATE_IDENTIFIER', 'Email or phone is already in use');
    }

    throw error;
  }
};

export const updateUserStatus = async (
  targetUserId: string,
  active: boolean,
  requestingAdminId: string,
  db: UserStore = prisma,
): Promise<PublicUser> => {
  return updateUser(targetUserId, { active }, requestingAdminId, db);
};

export const updateUserRole = async (
  targetUserId: string,
  role: 'ADMIN' | 'EMPLOYEE',
  requestingAdminId: string,
  db: UserStore = prisma,
): Promise<PublicUser> => {
  return updateUser(targetUserId, { role }, requestingAdminId, db);
};

export const deleteUser = async (
  targetUserId: string,
  requestingAdminId: string,
  db: UserStore = prisma,
): Promise<{ message: string }> => {
  // Safety rule: Admin cannot delete their own account
  if (targetUserId === requestingAdminId) {
    throw new AppError(400, 'CANNOT_DELETE_SELF', 'You cannot delete your own account');
  }

  const existingUser = await db.user.findUnique({
    where: { id: targetUserId },
  });

  if (!existingUser) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  }

  // Check if user has updated commercial details
  if (db.commercialDetails) {
    const commercialCount = await db.commercialDetails.count({
      where: { updatedBy: targetUserId },
    });

    if (commercialCount > 0) {
      throw new AppError(
        409,
        'USER_HAS_DEPENDENCIES',
        'User has recorded commercial updates and cannot be permanently deleted. Please deactivate the account instead.',
      );
    }
  }

  const oldProfileImageUrl = existingUser.profileImageUrl;

  try {
    await db.user.delete({
      where: { id: targetUserId },
    });

    if (oldProfileImageUrl) {
      await r2StorageService.deleteObjectByPublicUrl(oldProfileImageUrl);
    }

    logger.info(
      { adminId: requestingAdminId, deletedUserId: targetUserId },
      'Admin deleted user',
    );

    return { message: 'User deleted successfully' };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      throw new AppError(
        409,
        'USER_HAS_DEPENDENCIES',
        'User has associated records and cannot be deleted. Deactivate the account instead.',
      );
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
        email: input.email !== undefined ? (input.email ? input.email.trim().toLowerCase() : null) : undefined,
        phone: input.phone !== undefined ? (input.phone ? input.phone.trim() : null) : undefined,
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
