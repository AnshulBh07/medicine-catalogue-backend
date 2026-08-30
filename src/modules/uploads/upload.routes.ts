import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware.js';
import { requireRole } from '../../middleware/role.middleware.js';
import { validateBody } from '../../middleware/validate.middleware.js';
import {
  cleanupMedicineImageUploadController,
  createMedicineImageUploadUrlController,
} from './upload.controller.js';
import {
  cleanupUploadSchema,
  createMedicineImageUploadUrlSchema,
} from './upload.schemas.js';

export const uploadsRouter = Router();

uploadsRouter.post(
  '/medicine-image',
  authenticate,
  requireRole('ADMIN'),
  validateBody(createMedicineImageUploadUrlSchema),
  createMedicineImageUploadUrlController,
);

uploadsRouter.delete(
  '/medicine-image',
  authenticate,
  requireRole('ADMIN'),
  validateBody(cleanupUploadSchema),
  cleanupMedicineImageUploadController,
);

uploadsRouter.post(
  '/cleanup',
  authenticate,
  requireRole('ADMIN'),
  validateBody(cleanupUploadSchema),
  cleanupMedicineImageUploadController,
);
