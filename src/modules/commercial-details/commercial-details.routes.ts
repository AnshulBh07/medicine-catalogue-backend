import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware.js';
import { requireRole } from '../../middleware/role.middleware.js';
import { validateBody, validateParams } from '../../middleware/validate.middleware.js';
import {
  createBatchCommercialDetailsController,
  createMedicineCommercialDetailsController,
  getBatchCommercialDetailsController,
  getMedicineCommercialDetailsController,
  updateBatchCommercialDetailsController,
  updateMedicineCommercialDetailsController,
} from './commercial-details.controller.js';
import {
  commercialDetailsBatchIdSchema,
  commercialDetailsMedicineIdSchema,
  createCommercialDetailsSchema,
  updateCommercialDetailsSchema,
} from './commercial-details.schemas.js';

// Mounted on /medicines
export const commercialDetailsRouter = Router();

commercialDetailsRouter.use(authenticate, requireRole('ADMIN'));
commercialDetailsRouter.get(
  '/:medicineId/commercial-details',
  validateParams(commercialDetailsMedicineIdSchema),
  getMedicineCommercialDetailsController,
);
commercialDetailsRouter.post(
  '/:medicineId/commercial-details',
  validateParams(commercialDetailsMedicineIdSchema),
  validateBody(createCommercialDetailsSchema),
  createMedicineCommercialDetailsController,
);
commercialDetailsRouter.patch(
  '/:medicineId/commercial-details',
  validateParams(commercialDetailsMedicineIdSchema),
  validateBody(updateCommercialDetailsSchema),
  updateMedicineCommercialDetailsController,
);

// Mounted on /batches
export const batchCommercialDetailsRouter = Router();

batchCommercialDetailsRouter.use(authenticate, requireRole('ADMIN'));
batchCommercialDetailsRouter.get(
  '/:batchId/commercial-details',
  validateParams(commercialDetailsBatchIdSchema),
  getBatchCommercialDetailsController,
);
batchCommercialDetailsRouter.post(
  '/:batchId/commercial-details',
  validateParams(commercialDetailsBatchIdSchema),
  validateBody(createCommercialDetailsSchema),
  createBatchCommercialDetailsController,
);
batchCommercialDetailsRouter.patch(
  '/:batchId/commercial-details',
  validateParams(commercialDetailsBatchIdSchema),
  validateBody(updateCommercialDetailsSchema),
  updateBatchCommercialDetailsController,
);
