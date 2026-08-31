import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware.js';
import { requireRole } from '../../middleware/role.middleware.js';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.middleware.js';
import {
  createUserController,
  deleteUserController,
  getProfileController,
  getUserController,
  listUsersController,
  removeProfileImageController,
  updateProfileController,
  updateUserController,
  updateUserRoleController,
  updateUserStatusController,
} from './user.controller.js';
import {
  createUserSchema,
  listUsersSchema,
  updateProfileSchema,
  updateUserRoleSchema,
  updateUserSchema,
  updateUserStatusSchema,
  userIdSchema,
} from './user.schemas.js';

export const usersRouter = Router();

// Authenticated user profile routes
usersRouter.get(
  '/me',
  authenticate,
  getProfileController,
);

usersRouter.patch(
  '/me',
  authenticate,
  validateBody(updateProfileSchema),
  updateProfileController,
);

usersRouter.delete(
  '/me/profile-image',
  authenticate,
  removeProfileImageController,
);

// Admin-only user management routes
usersRouter.get(
  '/',
  authenticate,
  requireRole('ADMIN'),
  validateQuery(listUsersSchema),
  listUsersController,
);

usersRouter.post(
  '/',
  authenticate,
  requireRole('ADMIN'),
  validateBody(createUserSchema),
  createUserController,
);

usersRouter.get(
  '/:id',
  authenticate,
  requireRole('ADMIN'),
  validateParams(userIdSchema),
  getUserController,
);

usersRouter.patch(
  '/:id',
  authenticate,
  requireRole('ADMIN'),
  validateParams(userIdSchema),
  validateBody(updateUserSchema),
  updateUserController,
);

usersRouter.patch(
  '/:id/status',
  authenticate,
  requireRole('ADMIN'),
  validateParams(userIdSchema),
  validateBody(updateUserStatusSchema),
  updateUserStatusController,
);

usersRouter.patch(
  '/:id/role',
  authenticate,
  requireRole('ADMIN'),
  validateParams(userIdSchema),
  validateBody(updateUserRoleSchema),
  updateUserRoleController,
);

usersRouter.delete(
  '/:id',
  authenticate,
  requireRole('ADMIN'),
  validateParams(userIdSchema),
  deleteUserController,
);
