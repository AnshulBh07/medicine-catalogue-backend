import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware.js';
import { requireRole } from '../../middleware/role.middleware.js';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.middleware.js';
import {
  createBatchController,
  getBatchController,
  listBatchesController,
  updateBatchController,
  deleteBatchController,
} from './batch.controller.js';
import { batchIdSchema, createBatchSchema, listBatchesSchema, updateBatchSchema } from './batch.schemas.js';

export const batchesRouter = Router();

batchesRouter.get('/', authenticate, validateQuery(listBatchesSchema), listBatchesController);
batchesRouter.get('/:id', authenticate, validateParams(batchIdSchema), getBatchController);
batchesRouter.post(
  '/',
  authenticate,
  requireRole('ADMIN'),
  validateBody(createBatchSchema),
  createBatchController,
);
batchesRouter.patch(
  '/:id',
  authenticate,
  requireRole('ADMIN'),
  validateParams(batchIdSchema),
  validateBody(updateBatchSchema),
  updateBatchController,
);
batchesRouter.delete(
  '/:id',
  authenticate,
  requireRole('ADMIN'),
  validateParams(batchIdSchema),
  deleteBatchController,
);
