import type { RequestHandler } from 'express';
import { AppError } from '../../common/errors/app-error.js';
import {
  createUser,
  deleteUser,
  getProfile,
  getUserById,
  listUsers,
  removeProfileImage,
  updateProfile,
  updateUser,
  updateUserRole,
  updateUserStatus,
} from './user.service.js';
import type { ListUsersInput } from './user.schemas.js';

const authenticatedUserId = (request: Parameters<RequestHandler>[0]): string => {
  if (!request.auth?.userId) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication is required');
  }
  return request.auth.userId;
};

export const listUsersController: RequestHandler = async (request, response) => {
  const input = request.query as unknown as ListUsersInput;
  const result = await listUsers(input);
  response.status(200).json(result);
};

export const getUserController: RequestHandler = async (request, response) => {
  const user = await getUserById(request.params.id as string);
  response.status(200).json({ user });
};

export const createUserController: RequestHandler = async (request, response) => {
  const adminId = authenticatedUserId(request);
  const user = await createUser(request.body, undefined, adminId);
  response.status(201).json({ user });
};

export const updateUserController: RequestHandler = async (request, response) => {
  const adminId = authenticatedUserId(request);
  const user = await updateUser(request.params.id as string, request.body, adminId);
  response.status(200).json({ user });
};

export const updateUserStatusController: RequestHandler = async (request, response) => {
  const adminId = authenticatedUserId(request);
  const user = await updateUserStatus(
    request.params.id as string,
    request.body.active,
    adminId,
  );
  response.status(200).json({ user });
};

export const updateUserRoleController: RequestHandler = async (request, response) => {
  const adminId = authenticatedUserId(request);
  const user = await updateUserRole(
    request.params.id as string,
    request.body.role,
    adminId,
  );
  response.status(200).json({ user });
};

export const deleteUserController: RequestHandler = async (request, response) => {
  const adminId = authenticatedUserId(request);
  const result = await deleteUser(request.params.id as string, adminId);
  response.status(200).json(result);
};

export const getProfileController: RequestHandler = async (request, response) => {
  const user = await getProfile(authenticatedUserId(request));
  response.status(200).json({ user });
};

export const updateProfileController: RequestHandler = async (request, response) => {
  const user = await updateProfile(authenticatedUserId(request), request.body);
  response.status(200).json({ user });
};

export const removeProfileImageController: RequestHandler = async (request, response) => {
  const user = await removeProfileImage(authenticatedUserId(request));
  response.status(200).json({ user });
};
