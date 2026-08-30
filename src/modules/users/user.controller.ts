import type { RequestHandler } from 'express';
import { AppError } from '../../common/errors/app-error.js';
import {
  createUser,
  getProfile,
  removeProfileImage,
  updateProfile,
} from './user.service.js';

const authenticatedUserId = (request: Parameters<RequestHandler>[0]): string => {
  if (!request.auth?.userId) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication is required');
  }
  return request.auth.userId;
};

export const createUserController: RequestHandler = async (request, response) => {
  const user = await createUser(request.body);
  response.status(201).json({ user });
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
