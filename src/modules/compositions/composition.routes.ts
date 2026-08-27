import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware.js';
import { requireRole } from '../../middleware/role.middleware.js';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.middleware.js';
import {
  createCompositionController,
  deactivateCompositionController,
  getCompositionController,
  listCompositionsController,
  updateCompositionController,
} from './composition.controller.js';
import {
  compositionIdSchema,
  createCompositionSchema,
  listCompositionsSchema,
  updateCompositionSchema,
} from './composition.schemas.js';

export const compositionsRouter = Router();

compositionsRouter.get(
  '/',
  authenticate,
  validateQuery(listCompositionsSchema),
  listCompositionsController,
);
compositionsRouter.get(
  '/:id',
  authenticate,
  validateParams(compositionIdSchema),
  getCompositionController,
);
compositionsRouter.post(
  '/',
  authenticate,
  requireRole('ADMIN'),
  validateBody(createCompositionSchema),
  createCompositionController,
);
compositionsRouter.patch(
  '/:id',
  authenticate,
  requireRole('ADMIN'),
  validateParams(compositionIdSchema),
  validateBody(updateCompositionSchema),
  updateCompositionController,
);
compositionsRouter.delete(
  '/:id',
  authenticate,
  requireRole('ADMIN'),
  validateParams(compositionIdSchema),
  deactivateCompositionController,
);
