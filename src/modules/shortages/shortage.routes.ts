import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware.js';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.middleware.js';
import {
  createShortageItemController,
  deleteShortageItemController,
  getDailyShortagesController,
  getShortageItemByIdController,
  patchShortageItemController,
} from './shortage.controller.js';
import {
  createShortageItemSchema,
  patchShortageItemSchema,
  shortageDateQuerySchema,
  shortageIdParamsSchema,
} from './shortage.schemas.js';

export const shortagesRouter = Router();

// Shortage notebook is accessible to BOTH ADMIN and EMPLOYEE
shortagesRouter.use(authenticate);

shortagesRouter.get(
  '/',
  validateQuery(shortageDateQuerySchema),
  getDailyShortagesController,
);

shortagesRouter.get(
  '/:id',
  validateParams(shortageIdParamsSchema),
  getShortageItemByIdController,
);

shortagesRouter.post(
  '/',
  validateBody(createShortageItemSchema),
  createShortageItemController,
);

shortagesRouter.patch(
  '/:id',
  validateParams(shortageIdParamsSchema),
  validateBody(patchShortageItemSchema),
  patchShortageItemController,
);

shortagesRouter.delete(
  '/:id',
  validateParams(shortageIdParamsSchema),
  deleteShortageItemController,
);
