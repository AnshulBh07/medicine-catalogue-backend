import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware.js';
import { validateBody } from '../../middleware/validate.middleware.js';
import { scanMedicinePhotosController } from './ocr.controller.js';
import { scanMedicinePhotosSchema } from './ocr.schemas.js';

export const ocrRouter = Router();

ocrRouter.post(
  '/scan-medicine',
  authenticate,
  validateBody(scanMedicinePhotosSchema),
  scanMedicinePhotosController,
);
