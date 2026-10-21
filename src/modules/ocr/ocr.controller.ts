import type { Request, Response } from 'express';
import type { ScanMedicinePhotosInput } from './ocr.schemas.js';
import { processMedicinePhotos } from './ocr.service.js';

export const scanMedicinePhotosController = async (
  request: Request<unknown, unknown, ScanMedicinePhotosInput>,
  response: Response,
): Promise<void> => {
  const result = await processMedicinePhotos(request.body.images);
  response.status(200).json(result);
};
