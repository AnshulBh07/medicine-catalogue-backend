import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware.js';
import { requireRole } from '../../middleware/role.middleware.js';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.middleware.js';
import {
  createSaltController,
  deleteSaltController,
  getSaltController,
  getSaltImpactController,
  listSaltsController,
  updateSaltController,
} from './salt.controller.js';
import { createSaltSchema, listSaltsSchema, saltIdSchema, updateSaltSchema } from './salt.schemas.js';

export const saltsRouter = Router();

saltsRouter.get('/', authenticate, validateQuery(listSaltsSchema), listSaltsController);
saltsRouter.get('/:id', authenticate, validateParams(saltIdSchema), getSaltController);
saltsRouter.get('/:id/impact', authenticate, validateParams(saltIdSchema), getSaltImpactController);

saltsRouter.post(
  '/',
  authenticate,
  requireRole('ADMIN'),
  validateBody(createSaltSchema),
  createSaltController,
);

saltsRouter.patch(
  '/:id',
  authenticate,
  requireRole('ADMIN'),
  validateParams(saltIdSchema),
  validateBody(updateSaltSchema),
  updateSaltController,
);

saltsRouter.delete(
  '/:id',
  authenticate,
  requireRole('ADMIN'),
  validateParams(saltIdSchema),
  deleteSaltController,
);
