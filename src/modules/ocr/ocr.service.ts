import {
  parseMedicinePackagingText,
  type ExtractedMedicineData,
  type ExtractedSalt,
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

function extractTextFromPhotoItem(item: ScanMedicinePhotoItem): string {
  if (item.text && item.text.trim()) {
    return item.text.trim();
  }

  if (item.base64) {
    // If base64 contains embedded raw text header or simulated packaging metadata
    try {
      const decoded = Buffer.from(item.base64, 'base64').toString('utf-8');
      if (decoded && /[a-zA-Z0-9]/.test(decoded)) {
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

  return {
    extracted: merged,
    conflicts,
    photosProcessed: photos.length,
    fieldsExtractedCount: fieldsCount,
  };
}
