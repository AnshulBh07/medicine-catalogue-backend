import {
  r2StorageService,
  type PresignedUploadResponse,
} from '../../services/storage/r2.service.js';
import type {
  CleanupUploadInput,
  CreateMedicineImageUploadUrlInput,
  CreateProfileImageUploadUrlInput,
} from './upload.schemas.js';

export const createMedicineImageUploadUrl = async (
  input: CreateMedicineImageUploadUrlInput,
): Promise<PresignedUploadResponse> => {
  return r2StorageService.createPresignedUploadUrl(input);
};

export const createProfileImageUploadUrl = async (
  userId: string,
  input: CreateProfileImageUploadUrlInput,
): Promise<PresignedUploadResponse> => {
  return r2StorageService.createPresignedProfileImageUploadUrl(userId, input);
};

export const cleanupMedicineImageUpload = async (
  input: CleanupUploadInput,
): Promise<{ success: boolean }> => {
  if (input.objectKey) {
    await r2StorageService.deleteObject(input.objectKey);
  } else if (input.publicUrl) {
    await r2StorageService.deleteObjectByPublicUrl(input.publicUrl);
  }
  return { success: true };
};
