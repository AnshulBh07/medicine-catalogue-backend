import { z } from 'zod';

export const scanMedicinePhotoItemSchema = z.object({
  uri: z.string().optional(),
  base64: z.string().optional(),
  text: z.string().optional(),
  label: z.string().optional(),
});

export const scanMedicinePhotosSchema = z.object({
  images: z.array(scanMedicinePhotoItemSchema).min(1, 'At least one photo or text is required'),
});

export type ScanMedicinePhotosInput = z.infer<typeof scanMedicinePhotosSchema>;
export type ScanMedicinePhotoItem = z.infer<typeof scanMedicinePhotoItemSchema>;
