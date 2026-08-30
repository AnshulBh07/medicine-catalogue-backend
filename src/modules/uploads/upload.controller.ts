import type { RequestHandler } from 'express';
import { AppError } from '../../common/errors/app-error.js';
import {
  cleanupMedicineImageUpload,
  createMedicineImageUploadUrl,
  createProfileImageUploadUrl,
} from './upload.service.js';
import type {
  CleanupUploadInput,
  CreateMedicineImageUploadUrlInput,
  CreateProfileImageUploadUrlInput,
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

export const createProfileImageUploadUrlController: RequestHandler = async (
  request,
  response,
) => {
  const userId = request.auth?.userId;
  if (!userId) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication is required');
  }
  const result = await createProfileImageUploadUrl(
    userId,
    request.body as CreateProfileImageUploadUrlInput,
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
