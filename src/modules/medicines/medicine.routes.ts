import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware.js';
import { requireRole } from '../../middleware/role.middleware.js';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.middleware.js';
import {
  createMedicineController,
  deactivateMedicineController,
  getMedicineController,
  listMedicinesController,
  updateMedicineController,
} from './medicine.controller.js';
import {
  createMedicineSchema,
  listMedicinesSchema,
  medicineIdSchema,
  updateMedicineSchema,
} from './medicine.schemas.js';

export const medicinesRouter = Router();

medicinesRouter.get('/', authenticate, validateQuery(listMedicinesSchema), listMedicinesController);
medicinesRouter.get('/:id', authenticate, validateParams(medicineIdSchema), getMedicineController);
medicinesRouter.post(
  '/',
  authenticate,
  requireRole('ADMIN'),
  validateBody(createMedicineSchema),
  createMedicineController,
);
medicinesRouter.patch(
  '/:id',
  authenticate,
  requireRole('ADMIN'),
  validateParams(medicineIdSchema),
  validateBody(updateMedicineSchema),
  updateMedicineController,
);
medicinesRouter.delete(
  '/:id',
  authenticate,
  requireRole('ADMIN'),
  validateParams(medicineIdSchema),
  deactivateMedicineController,
);
