import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware.js';
import { requireRole } from '../../middleware/role.middleware.js';
import { validateBody } from '../../middleware/validate.middleware.js';
import {
  createUserController,
  getProfileController,
  removeProfileImageController,
  updateProfileController,
} from './user.controller.js';
import { createUserSchema, updateProfileSchema } from './user.schemas.js';

export const usersRouter = Router();

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

usersRouter.post(
  '/',
  authenticate,
  requireRole('ADMIN'),
  validateBody(createUserSchema),
  createUserController,
);
