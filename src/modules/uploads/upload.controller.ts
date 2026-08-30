import type { RequestHandler } from 'express';
import {
  cleanupMedicineImageUpload,
  createMedicineImageUploadUrl,
} from './upload.service.js';
import type {
  CleanupUploadInput,
  CreateMedicineImageUploadUrlInput,
} from './upload.schemas.js';

export const createMedicineImageUploadUrlController: RequestHandler = async (
  request,
  response,
) => {
  const result = await createMedicineImageUploadUrl(
    request.body as CreateMedicineImageUploadUrlInput,
  );
  response.status(201).json(result);
};

export const cleanupMedicineImageUploadController: RequestHandler = async (
  request,
  response,
) => {
  const result = await cleanupMedicineImageUpload(
    request.body as CleanupUploadInput,
  );
  response.status(200).json(result);
};
