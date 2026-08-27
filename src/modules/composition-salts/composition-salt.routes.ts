import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware.js';
import { requireRole } from '../../middleware/role.middleware.js';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.middleware.js';
import {
  createCompositionSaltController,
  deleteCompositionSaltController,
  getCompositionSaltController,
  listCompositionSaltsController,
  updateCompositionSaltController,
} from './composition-salt.controller.js';
import {
  compositionSaltIdSchema,
  createCompositionSaltSchema,
  listCompositionSaltsSchema,
  updateCompositionSaltSchema,
} from './composition-salt.schemas.js';

export const compositionSaltsRouter = Router();

compositionSaltsRouter.get(
  '/',
  authenticate,
  validateQuery(listCompositionSaltsSchema),
  listCompositionSaltsController,
);
compositionSaltsRouter.get(
  '/:id',
  authenticate,
  validateParams(compositionSaltIdSchema),
  getCompositionSaltController,
);
compositionSaltsRouter.post(
  '/',
  authenticate,
  requireRole('ADMIN'),
  validateBody(createCompositionSaltSchema),
  createCompositionSaltController,
);
compositionSaltsRouter.patch(
  '/:id',
  authenticate,
  requireRole('ADMIN'),
  validateParams(compositionSaltIdSchema),
  validateBody(updateCompositionSaltSchema),
  updateCompositionSaltController,
);
compositionSaltsRouter.delete(
  '/:id',
  authenticate,
  requireRole('ADMIN'),
  validateParams(compositionSaltIdSchema),
  deleteCompositionSaltController,
);
