import { z } from 'zod';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGE_FILE_SIZE_BYTES,
} from '../../services/storage/r2.service.js';

export const createMedicineImageUploadUrlSchema = z
  .object({
    contentType: z
      .string()
      .trim()
      .toLowerCase()
      .refine(
        (val) => (ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(val),
        {
          message: `contentType must be one of: ${ALLOWED_IMAGE_MIME_TYPES.join(', ')}`,
        },
      ),
    fileSize: z
      .coerce
      .number()
      .finite()
      .positive()
      .max(MAX_IMAGE_FILE_SIZE_BYTES, {
        message: `fileSize must not exceed ${MAX_IMAGE_FILE_SIZE_BYTES / (1024 * 1024)}MB`,
      })
      .optional(),
    fileName: z.string().trim().max(255).optional(),
  })
  .strict();

export const cleanupUploadSchema = z
  .object({
    objectKey: z.string().trim().max(1024).optional(),
    publicUrl: z.string().trim().max(2048).optional(),
  })
  .strict()
  .refine((data) => Boolean(data.objectKey || data.publicUrl), {
    message: 'Either objectKey or publicUrl must be provided for cleanup',
  });

export type CreateMedicineImageUploadUrlInput = z.infer<
  typeof createMedicineImageUploadUrlSchema
>;
export type CleanupUploadInput = z.infer<typeof cleanupUploadSchema>;
