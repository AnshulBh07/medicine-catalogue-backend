import { describe, expect, it, vi } from 'vitest';
import { listMedicinesSchema } from '../src/modules/medicines/medicine.schemas.js';
import { listMedicines, type MedicineStore } from '../src/modules/medicines/medicine.service.js';
import {
  parseDateString,
  parseMedicinePackagingText,
} from '../src/modules/ocr/ocr.parser.js';
import { processMedicinePhotos } from '../src/modules/ocr/ocr.service.js';

describe('Phase 3 Remediation — Backend Unit Tests', () => {
  describe('F-015: Medicine Catalogue Margin Sorting Compatibility', () => {
    const baseDate = new Date('2026-01-15T00:00:00.000Z');

    const makeMedicineRecord = (
      id: string,
      name: string,
      commercial: {
        purchaseRate: number;
        mrp: number;
        discountPercent?: number;
        gstPercent?: number;
        scheme?: unknown;
      } | null,
      form: 'TABLET' | 'CAPSULE' = 'TABLET',
    ) => ({
      id,
      name,
      compositionId: `comp-${id}`,
      form,
      packQuantity: 10,
      packUnit: 'TABLET' as const,
      shortDescription: null,
      imageUrl: null,
      uses: null,
      recommendedAgeGroup: null,
      directions: null,
      warnings: null,
      storageInstructions: null,
      barcode: null,
      prescriptionRequired: false,
      manufacturerId: 'mfg-1',
      mrId: null,
      active: true,
      createdAt: baseDate,
      updatedAt: baseDate,
      composition: { id: `comp-${id}`, displayText: `${name} Comp` },
      manufacturer: { id: 'mfg-1', name: 'Test Pharma' },
      mr: null,
      batches: commercial
        ? [
            {
              id: `batch-${id}`,
              medicineId: id,
              batchNumber: `B-${id}`,
              manufacturingDate: baseDate,
              expiryDate: new Date('2028-01-15T00:00:00.000Z'),
              createdAt: baseDate,
              updatedAt: baseDate,
              commercialDetails: {
                id: `comm-${id}`,
                batchId: `batch-${id}`,
                purchaseRate: commercial.purchaseRate,
                mrp: commercial.mrp,
                discountPercent: commercial.discountPercent ?? 0,
                gstPercent: commercial.gstPercent ?? 0,
                scheme: commercial.scheme ?? null,
                privateNotes: 'confidential-note',
                updatedBy: 'admin-1',
                createdAt: baseDate,
                updatedAt: baseDate,
                updatedByUser: { id: 'admin-1', name: 'Admin' },
              },
            },
          ]
        : [],
    });

    it('accepts sortBy=margin in listMedicinesSchema and rejects invalid sortBy values', () => {
      const validDesc = listMedicinesSchema.safeParse({ sortBy: 'margin', sortOrder: 'desc' });
      expect(validDesc.success).toBe(true);
      if (validDesc.success) {
        expect(validDesc.data.sortBy).toBe('margin');
        expect(validDesc.data.sortOrder).toBe('desc');
      }

      const invalid = listMedicinesSchema.safeParse({ sortBy: 'invalidField', sortOrder: 'asc' });
      expect(invalid.success).toBe(false);
    });

    it('sorts medicines by computed margin descending and ascending, placing medicines without commercial details last', async () => {
      // Low margin: purchaseRate 90, mrp 100 => margin 10%
      // High margin: purchaseRate 50, mrp 100 => margin 50%
      // Mid margin (with scheme 10+2): purchaseRate 80, mrp 100 => effective 80*(10/12)=66.67 => margin ~33.33%
      // No commercial details: margin = null (must appear last in both asc & desc)
      const records = [
        makeMedicineRecord('m-low', 'Alpha Low', { purchaseRate: 90, mrp: 100 }),
        makeMedicineRecord('m-none', 'Beta None', null),
        makeMedicineRecord('m-mid', 'Gamma Mid', { purchaseRate: 80, mrp: 100, scheme: '10+2' }),
        makeMedicineRecord('m-high', 'Delta High', { purchaseRate: 50, mrp: 100 }),
      ];

      const mockDb = {
        medicine: {
          findMany: vi.fn().mockResolvedValue(records),
        },
      } as unknown as MedicineStore;

      const descResult = await listMedicines(
        { sortBy: 'margin', sortOrder: 'desc', includeInactive: false },
        mockDb,
      );
      expect(descResult.map((m) => m.id)).toEqual(['m-high', 'm-mid', 'm-low', 'm-none']);

      const ascResult = await listMedicines(
        { sortBy: 'margin', sortOrder: 'asc', includeInactive: false },
        mockDb,
      );
      expect(ascResult.map((m) => m.id)).toEqual(['m-low', 'm-mid', 'm-high', 'm-none']);

      // Ensure private commercial details are NOT exposed in PublicMedicine response
      for (const med of descResult) {
        expect('commercialDetails' in med).toBe(false);
        expect('purchaseRate' in med).toBe(false);
        expect('privateNotes' in med).toBe(false);
      }
    });

    it('preserves price range filtering together with sortBy=margin', async () => {
      const records = [
        makeMedicineRecord('m-cheap', 'Cheap High Margin', { purchaseRate: 10, mrp: 25 }),
        makeMedicineRecord('m-target-1', 'Target Lower Margin', { purchaseRate: 80, mrp: 100 }),
        makeMedicineRecord('m-target-2', 'Target Higher Margin', { purchaseRate: 60, mrp: 120 }),
        makeMedicineRecord('m-expensive', 'Expensive Med', { purchaseRate: 200, mrp: 500 }),
      ];

      const mockDb = {
        medicine: {
          findMany: vi.fn().mockResolvedValue(records),
        },
      } as unknown as MedicineStore;

      const filtered = await listMedicines(
        {
          sortBy: 'margin',
          sortOrder: 'desc',
          minPrice: 50,
          maxPrice: 200,
          includeInactive: false,
        },
        mockDb,
      );

      expect(filtered.map((m) => m.id)).toEqual(['m-target-2', 'm-target-1']);
    });
  });

  describe('F-029: OCR Packaging Parser & Service Fixes', () => {
    it('parses DD/MM/YYYY, YYYY-MM-DD, DD Mon YYYY, and MM/YYYY dates accurately without corruption', () => {
      // Previously 05/03/2026 was misparsed as 2003-05-01 and 15/03/2026 returned undefined!
      expect(parseDateString('05/03/2026', false)).toBe('2026-03-05');
      expect(parseDateString('15/03/2026', true)).toBe('2026-03-15');
      expect(parseDateString('2027-08-31', true)).toBe('2027-08-31');
      expect(parseDateString('15 Mar 2027', true)).toBe('2027-03-15');
      expect(parseDateString('02/2028', true)).toBe('2028-02-29'); // Leap year!
      expect(parseDateString('03/2024', false)).toBe('2024-03-01');
      expect(parseDateString('MAR 2027', true)).toBe('2027-03-31');

      // Invalid calendar dates must be rejected cleanly
      expect(parseDateString('31/02/2026', true)).toBeUndefined();
      expect(parseDateString('99/99/2026', true)).toBeUndefined();
      expect(parseDateString('not-a-date', true)).toBeUndefined();
    });

    it('normalizes salt units (% -> PERCENT, gm -> G) and extracts multiple salts on a single line', () => {
      const text = [
        'Combiflam Plus',
        'Paracetamol 500mg + Caffeine 65mg',
        'Hydrocortisone 1%',
        'Protein Powder 2.5 gm',
        'Pack of 5 Vials',
        'B.No. CF2409',
        'Mfg. Date: 05/03/2025',
        'Exp. Date: 15/03/2027',
        'M.R.P. Rs. 48.50',
      ].join('\n');

      const parsed = parseMedicinePackagingText(text);

      expect(parsed.manufacturingDate).toBe('2025-03-05');
      expect(parsed.expiryDate).toBe('2027-03-15');
      expect(parsed.packQuantity).toBe('5');
      expect(parsed.packUnit).toBe('VIAL'); // Singular MedicinePackUnit enum!
      expect(parsed.salts).toEqual(
        expect.arrayContaining([
          { name: 'Paracetamol', amount: '500', unit: 'MG' },
          { name: 'Caffeine', amount: '65', unit: 'MG' },
          { name: 'Hydrocortisone', amount: '1', unit: 'PERCENT' },
          { name: 'Protein Powder', amount: '2.5', unit: 'G' },
        ]),
      );
    });

    it('maps plural packaging units to singular MedicinePackUnit enum values', () => {
      expect(parseMedicinePackagingText('2 Bottles').packUnit).toBe('BOTTLE');
      expect(parseMedicinePackagingText('10 Sachets').packUnit).toBe('SACHET');
      expect(parseMedicinePackagingText('5 Ampoules').packUnit).toBe('AMPULE');
      expect(parseMedicinePackagingText('100 gm').packUnit).toBe('G');
      expect(parseMedicinePackagingText('15 Tablets').packUnit).toBe('TABLET');
    });

    it('does not falsely map short substrings like "Acid" to "Clavulanic Acid"', () => {
      const parsed = parseMedicinePackagingText('Folic Acid 5mg');
      expect(parsed.salts?.[0]?.name).toBe('Folic Acid');

      const parsedShort = parseMedicinePackagingText('Citric Acid 10mg');
      expect(parsedShort.salts?.[0]?.name).toBe('Citric Acid');
    });

    it('rejects raw binary JPEG/PNG base64 payloads without feeding binary garbage to parser', async () => {
      // Real JPEG header FF D8 FF E0 + random bytes
      const jpegBase64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]).toString('base64');
      // Real PNG header 89 50 4E 47
      const pngBase64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64');

      const result = await processMedicinePhotos([
        { uri: 'file://front.jpg', base64: jpegBase64, label: 'Front' },
        { uri: 'file://back.png', base64: pngBase64, label: 'Back' },
      ]);

      expect(result.photosProcessed).toBe(2);
      expect(result.fieldsExtractedCount).toBe(0);
      expect(result.extracted).toEqual({});
      expect(result.conflicts).toEqual([]);
    });

    it('counts packQuantity/packUnit in fieldsExtractedCount and detects multi-photo conflicts', async () => {
      const result = await processMedicinePhotos([
        {
          uri: 'file://photo1.jpg',
          text: 'Dolo 650\nStrip of 15 Tablets\nM.R.P. Rs. 34.00\nBatch: B001',
        },
        {
          uri: 'file://photo2.jpg',
          text: 'Dolo 500\nStrip of 10 Tablets\nM.R.P. Rs. 40.00\nBatch: B002',
        },
      ]);

      expect(result.extracted.packQuantity).toBe('15');
      expect(result.extracted.packUnit).toBe('TABLET');
      expect(result.fieldsExtractedCount).toBeGreaterThanOrEqual(5);
      expect(result.conflicts.map((c) => c.field)).toEqual(
        expect.arrayContaining(['name', 'packQuantity', 'mrp', 'batchNumber']),
      );
    });
  });
});
