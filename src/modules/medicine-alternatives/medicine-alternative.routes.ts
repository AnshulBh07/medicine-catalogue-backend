import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware.js';
import { requireRole } from '../../middleware/role.middleware.js';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../../middleware/validate.middleware.js';
import {
  createAlternativesController,
  deleteAlternativesController,
  getByMedicineIdController,
  listAlternativesController,
  updateAlternativesController,
} from './medicine-alternative.controller.js';
import {
  createMedicineAlternativeSchema,
  listMedicineAlternativesQuerySchema,
  medicineIdParamSchema,
  sourceMedicineIdParamSchema,
  updateMedicineAlternativeSchema,
} from './medicine-alternative.schemas.js';

export const medicineAlternativesRouter = Router();

medicineAlternativesRouter.get(
  '/',
  authenticate,
  validateQuery(listMedicineAlternativesQuerySchema),
  listAlternativesController,
);

medicineAlternativesRouter.get(
  '/by-medicine/:medicineId',
  authenticate,
  validateParams(medicineIdParamSchema),
  getByMedicineIdController,
);

medicineAlternativesRouter.post(
  '/',
  authenticate,
  requireRole('ADMIN'),
  validateBody(createMedicineAlternativeSchema),
  createAlternativesController,
);

medicineAlternativesRouter.put(
  '/:sourceMedicineId',
  authenticate,
  requireRole('ADMIN'),
  validateParams(sourceMedicineIdParamSchema),
  validateBody(updateMedicineAlternativeSchema),
  updateAlternativesController,
);

medicineAlternativesRouter.delete(
  '/:sourceMedicineId',
  authenticate,
  requireRole('ADMIN'),
  validateParams(sourceMedicineIdParamSchema),
  deleteAlternativesController,
);
