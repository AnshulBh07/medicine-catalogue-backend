import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware.js';
import { requireRole } from '../../middleware/role.middleware.js';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.middleware.js';
import {
  createManufacturerController,
  deactivateManufacturerController,
  getManufacturerController,
  listManufacturersController,
  updateManufacturerController,
} from './manufacturer.controller.js';
import {
  createManufacturerSchema,
  listManufacturersSchema,
  manufacturerIdSchema,
  updateManufacturerSchema,
} from './manufacturer.schemas.js';

export const manufacturersRouter = Router();

manufacturersRouter.get('/', authenticate, validateQuery(listManufacturersSchema), listManufacturersController);
manufacturersRouter.get('/:id', authenticate, validateParams(manufacturerIdSchema), getManufacturerController);
manufacturersRouter.post(
  '/',
  authenticate,
  requireRole('ADMIN'),
  validateBody(createManufacturerSchema),
  createManufacturerController,
);
manufacturersRouter.patch(
  '/:id',
  authenticate,
  requireRole('ADMIN'),
  validateParams(manufacturerIdSchema),
  validateBody(updateManufacturerSchema),
  updateManufacturerController,
);
manufacturersRouter.delete(
  '/:id',
  authenticate,
  requireRole('ADMIN'),
  validateParams(manufacturerIdSchema),
  deactivateManufacturerController,
);
