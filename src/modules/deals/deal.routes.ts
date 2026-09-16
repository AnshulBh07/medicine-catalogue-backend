import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware.js';
import { requireRole } from '../../middleware/role.middleware.js';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.middleware.js';
import {
  checkPendingDealController,
  createDealController,
  deleteDealController,
  getDealController,
  listDealsController,
  updateDealController,
  updateDealStatusController,
} from './deal.controller.js';
import {
  checkPendingDealQuerySchema,
  createDealSchema,
  dealIdSchema,
  listDealsSchema,
  updateDealSchema,
  updateDealStatusSchema,
} from './deal.schemas.js';

export const dealsRouter = Router();

dealsRouter.use(authenticate, requireRole('ADMIN'));

dealsRouter.get('/check-pending', validateQuery(checkPendingDealQuerySchema), checkPendingDealController);
dealsRouter.get('/', validateQuery(listDealsSchema), listDealsController);
dealsRouter.get('/:id', validateParams(dealIdSchema), getDealController);
dealsRouter.post('/', validateBody(createDealSchema), createDealController);
dealsRouter.patch('/:id', validateParams(dealIdSchema), validateBody(updateDealSchema), updateDealController);
dealsRouter.patch('/:id/status', validateParams(dealIdSchema), validateBody(updateDealStatusSchema), updateDealStatusController);
dealsRouter.delete('/:id', validateParams(dealIdSchema), deleteDealController);
