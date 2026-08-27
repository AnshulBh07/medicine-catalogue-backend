import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware.js';
import { requireRole } from '../../middleware/role.middleware.js';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.middleware.js';
import {
  createMrController,
  deactivateMrController,
  getMrController,
  listMrsController,
  updateMrController,
} from './mr.controller.js';
import { createMrSchema, listMrsSchema, mrIdSchema, updateMrSchema } from './mr.schemas.js';

export const mrsRouter = Router();

mrsRouter.get('/', authenticate, validateQuery(listMrsSchema), listMrsController);
mrsRouter.get('/:id', authenticate, validateParams(mrIdSchema), getMrController);
mrsRouter.post(
  '/',
  authenticate,
  requireRole('ADMIN'),
  validateBody(createMrSchema),
  createMrController,
);
mrsRouter.patch(
  '/:id',
  authenticate,
  requireRole('ADMIN'),
  validateParams(mrIdSchema),
  validateBody(updateMrSchema),
  updateMrController,
);
mrsRouter.delete(
  '/:id',
  authenticate,
  requireRole('ADMIN'),
  validateParams(mrIdSchema),
  deactivateMrController,
);
