import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware.js';
import { requireRole } from '../../middleware/role.middleware.js';
import { validateBody, validateParams } from '../../middleware/validate.middleware.js';
import {
  createCommercialDetailsController,
  getCommercialDetailsController,
  updateCommercialDetailsController,
} from './commercial-details.controller.js';
import {
  commercialDetailsMedicineIdSchema,
  createCommercialDetailsSchema,
  updateCommercialDetailsSchema,
} from './commercial-details.schemas.js';

export const commercialDetailsRouter = Router();

commercialDetailsRouter.use(authenticate, requireRole('ADMIN'));
commercialDetailsRouter.get(
  '/:medicineId/commercial-details',
  validateParams(commercialDetailsMedicineIdSchema),
  getCommercialDetailsController,
);
commercialDetailsRouter.post(
  '/:medicineId/commercial-details',
  validateParams(commercialDetailsMedicineIdSchema),
  validateBody(createCommercialDetailsSchema),
  createCommercialDetailsController,
);
commercialDetailsRouter.patch(
  '/:medicineId/commercial-details',
  validateParams(commercialDetailsMedicineIdSchema),
  validateBody(updateCommercialDetailsSchema),
  updateCommercialDetailsController,
);
