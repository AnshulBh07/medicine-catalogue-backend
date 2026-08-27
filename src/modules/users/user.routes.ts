import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware.js';
import { requireRole } from '../../middleware/role.middleware.js';
import { validateBody } from '../../middleware/validate.middleware.js';
import { createUserController } from './user.controller.js';
import { createUserSchema } from './user.schemas.js';

export const usersRouter = Router();

usersRouter.post(
  '/',
  authenticate,
  requireRole('ADMIN'),
  validateBody(createUserSchema),
  createUserController,
);
