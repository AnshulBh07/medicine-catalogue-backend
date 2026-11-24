import {
  parseMedicinePackagingText,
  type ExtractedMedicineData,
} from './ocr.parser.js';
import type { ScanMedicinePhotoItem } from './ocr.schemas.js';

export interface ConflictRecord {
  field: string;
  values: string[];
  message: string;
}

export interface ScanMedicineResult {
  extracted: ExtractedMedicineData;
  conflicts: ConflictRecord[];
  photosProcessed: number;
  fieldsExtractedCount: number;
}

function isBinaryImagePayload(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  // JPEG (FF D8 FF), PNG (89 50 4E 47), GIF (47 49 46 38), BMP (42 4D), WebP (RIFF....WEBP)
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return true;
  if (buf[0] === 0x42 && buf[1] === 0x4d) return true;
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return true;
  }
  if (buf.includes(0)) return true;
  return false;
}

function extractTextFromPhotoItem(item: ScanMedicinePhotoItem): string {
  if (item.text && item.text.trim()) {
    return item.text.trim();
  }

  if (item.base64) {
    // Reject raw binary image payloads (F-003 OCR engine is tracked separately) instead of
    // feeding decoded binary garbage into regex text parsing.
    try {
      const cleanedBase64 = item.base64.trim().replace(/^data:[^;]+;base64,/, '');
      const buf = Buffer.from(cleanedBase64, 'base64');
      if (buf.length === 0 || isBinaryImagePayload(buf)) {
        return '';
      }
      const decoded = buf.toString('utf-8');
      if (decoded.includes('\uFFFD')) {
        return '';
      }
      if (decoded && /[a-zA-Z0-9]/.test(decoded) && /^[\t\n\r -~₹°\u00A0-\u024F]+$/.test(decoded)) {
        return decoded;
      }
    } catch {
      // Not raw text encoded in base64
    }
  }

  // Fallback: If uri has query params with text or simulated mock
  if (item.uri && item.uri.includes('text=')) {
    try {
      const url = new URL(item.uri);
      const textParam = url.searchParams.get('text');
      if (textParam) return decodeURIComponent(textParam);
    } catch {
      // Ignored
    }
  }

  return '';
}

export function mergeExtractedData(
  photoExtractions: ExtractedMedicineData[],
): { merged: ExtractedMedicineData; conflicts: ConflictRecord[] } {
  const merged: ExtractedMedicineData = {};
  const conflicts: ConflictRecord[] = [];

  const scalarFields: Array<keyof Omit<ExtractedMedicineData, 'salts'>> = [
    'name',
    'manufacturer',
    'mrp',
    'expiryDate',
    'manufacturingDate',
    'batchNumber',
    'form',
    'packQuantity',
    'packUnit',
  ];

  // Track all distinct values seen per field across photos
  const fieldValuesMap: Record<string, Set<string>> = {};

  for (const extraction of photoExtractions) {
    for (const field of scalarFields) {
      const val = extraction[field];
      if (val && typeof val === 'string' && val.trim().length > 0) {
        if (!fieldValuesMap[field]) {
          fieldValuesMap[field] = new Set();
        }
        fieldValuesMap[field].add(val.trim());

        // Keep the first extracted non-empty value in merged
        if (!merged[field]) {
          merged[field] = val.trim();
        }
      }
    }

    // Merge salts
    if (extraction.salts && extraction.salts.length > 0) {
      if (!merged.salts) {
        merged.salts = [];
      }
      for (const newSalt of extraction.salts) {
        const existingSalt = merged.salts.find(
          (s) => s.name.toLowerCase() === newSalt.name.toLowerCase(),
        );
        if (!existingSalt) {
          merged.salts.push(newSalt);
        } else if (!existingSalt.amount && newSalt.amount) {
          existingSalt.amount = newSalt.amount;
          existingSalt.unit = newSalt.unit;
        }
      }
    }
  }

  // Detect and report conflicts
  for (const [field, valuesSet] of Object.entries(fieldValuesMap)) {
    if (valuesSet.size > 1) {
      const distinctVals = Array.from(valuesSet);
      // For dates, compare normalized YYYY-MM
      if (field === 'expiryDate' || field === 'manufacturingDate') {
        const months = new Set(distinctVals.map((v) => v.slice(0, 7)));
        if (months.size > 1) {
          conflicts.push({
            field,
            values: distinctVals,
            message: `Conflicting ${field} values found across photos: ${distinctVals.join(' vs ')}`,
          });
        }
      } else if (field === 'mrp') {
        const numericPrices = new Set(distinctVals.map((v) => parseFloat(v)));
        if (numericPrices.size > 1) {
          conflicts.push({
            field: 'mrp',
            values: distinctVals,
            message: `Conflicting MRP detected across photos: ₹${distinctVals.join(' vs ₹')}`,
          });
        }
      } else if (field === 'batchNumber') {
        conflicts.push({
          field: 'batchNumber',
          values: distinctVals,
          message: `Conflicting Batch Numbers detected across photos: ${distinctVals.join(' vs ')}`,
        });
      } else if (field === 'name' || field === 'manufacturer' || field === 'form' || field === 'packQuantity') {
        const labelMap: Record<string, string> = {
          name: 'Medicine Name',
          manufacturer: 'Manufacturer',
          form: 'Dosage Form',
          packQuantity: 'Pack Quantity',
        };
        conflicts.push({
          field,
          values: distinctVals,
          message: `Conflicting ${labelMap[field]} values detected across photos: ${distinctVals.join(' vs ')}`,
        });
      }
    }
  }

  return { merged, conflicts };
}

export async function processMedicinePhotos(
  photos: ScanMedicinePhotoItem[],
): Promise<ScanMedicineResult> {
  const extractions: ExtractedMedicineData[] = [];

  for (const photo of photos) {
    const text = extractTextFromPhotoItem(photo);
    const parsed = parseMedicinePackagingText(text);
    extractions.push(parsed);
  }

  const { merged, conflicts } = mergeExtractedData(extractions);

  let fieldsCount = 0;
  if (merged.name) fieldsCount++;
  if (merged.manufacturer) fieldsCount++;
  if (merged.mrp) fieldsCount++;
  if (merged.expiryDate) fieldsCount++;
  if (merged.manufacturingDate) fieldsCount++;
  if (merged.batchNumber) fieldsCount++;
  if (merged.salts && merged.salts.length > 0) fieldsCount++;
  if (merged.form) fieldsCount++;
  if (merged.packQuantity) fieldsCount++;
  if (merged.packUnit) fieldsCount++;

  return {
    extracted: merged,
    conflicts,
    photosProcessed: photos.length,
    fieldsExtractedCount: fieldsCount,
  };
}
