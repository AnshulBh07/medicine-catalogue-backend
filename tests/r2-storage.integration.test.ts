import { S3Client } from '@aws-sdk/client-s3';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import {
  R2StorageService,
  MAX_IMAGE_FILE_SIZE_BYTES,
} from '../src/services/storage/r2.service.js';

let sequence = 0;
const unique = (prefix: string): string => `${prefix}-${Date.now()}-${sequence++}`;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Cloudflare R2 Storage & Medicine Image Integration', () => {
  let adminToken: string;
  let employeeToken: string;
  let s3SendSpy: MockInstance;

  beforeAll(async () => {
    // 1. Seed admin & employee for tests
    const passwordHash = '$argon2id$v=19$m=65536,t=3,p=4$fakehashfortests';

    const adminUser = await prisma.user.create({
      data: {
        name: 'Admin R2 Tester',
        email: `${unique('admin')}@example.com`,
        phone: `+919${String(Date.now()).slice(-8)}1`,
        passwordHash,
        role: 'ADMIN',
        active: true,
      },
    });

    const empUser = await prisma.user.create({
      data: {
        name: 'Employee R2 Tester',
        email: `${unique('emp')}@example.com`,
        phone: `+919${String(Date.now()).slice(-8)}2`,
        passwordHash,
        role: 'EMPLOYEE',
        active: true,
      },
    });

    const { signAccessToken } = await import('../src/modules/auth/jwt.js');
    adminToken = await signAccessToken({ userId: adminUser.id, role: 'ADMIN' });
    employeeToken = await signAccessToken({ userId: empUser.id, role: 'EMPLOYEE' });

    // Mock S3Client send
    s3SendSpy = vi.spyOn(S3Client.prototype, 'send').mockImplementation(async () => {
      return { $metadata: { httpStatusCode: 200 } } as never;
    });
  });

  afterAll(async () => {
    s3SendSpy?.mockRestore();
  });

  describe('R2StorageService Unit & Core Logic', () => {
    it('generates unique object keys with correct structure and extensions', () => {
      const service = new R2StorageService();
      const jpegKey = service.generateObjectKey('image/jpeg');
      const pngKey = service.generateObjectKey('image/png');
      const webpKey = service.generateObjectKey('image/webp');

      expect(jpegKey).toMatch(/^medicines\/[0-9a-f-]{36}\/packaging-[0-9a-f-]{36}\.jpg$/);
      expect(pngKey).toMatch(/^medicines\/[0-9a-f-]{36}\/packaging-[0-9a-f-]{36}\.png$/);
      expect(webpKey).toMatch(/^medicines\/[0-9a-f-]{36}\/packaging-[0-9a-f-]{36}\.webp$/);
      expect(jpegKey).not.toBe(service.generateObjectKey('image/jpeg'));
    });

    it('extracts object key from public URL correctly', () => {
      const service = new R2StorageService({
        publicUrl: 'https://images.example.com',
      });

      const key = 'medicines/uuid-1/packaging-uuid-2.webp';
      const fullUrl = `https://images.example.com/${key}`;

      expect(service.getObjectKeyFromUrl(fullUrl)).toBe(key);
      expect(service.getObjectKeyFromUrl(`https://images.example.com/${key}`)).toBe(key);
      expect(service.getObjectKeyFromUrl(null)).toBeNull();
      expect(service.getObjectKeyFromUrl('')).toBeNull();
      expect(service.getObjectKeyFromUrl('https://otherdomain.com/some/other/path.png')).toBeNull();
      expect(service.getObjectKeyFromUrl('https://otherdomain.com/medicines/foo/packaging-bar.jpg')).toBe('medicines/foo/packaging-bar.jpg');
    });

    it('handles missing R2 configuration with clear server error', async () => {
      const unconfiguredService = new R2StorageService({
        accessKeyId: '',
        secretAccessKey: '',
        bucketName: '',
        publicUrl: '',
      });

      expect(() => unconfiguredService.validateConfig()).toThrowError(/not properly configured/i);

      await expect(
        unconfiguredService.createPresignedUploadUrl({
          contentType: 'image/jpeg',
        }),
      ).rejects.toThrowError(/not properly configured/i);
    });

    it('rejects unsupported MIME types and oversized files', async () => {
      const service = new R2StorageService({
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
        bucketName: 'test-bucket',
        publicUrl: 'https://images.example.com',
        endpoint: 'https://test.r2.cloudflarestorage.com',
      });

      await expect(
        service.createPresignedUploadUrl({
          contentType: 'application/pdf',
        }),
      ).rejects.toThrowError(/unsupported image type/i);

      await expect(
        service.createPresignedUploadUrl({
          contentType: 'image/gif',
        }),
      ).rejects.toThrowError(/unsupported image type/i);

      await expect(
        service.createPresignedUploadUrl({
          contentType: 'image/jpeg',
          fileSize: MAX_IMAGE_FILE_SIZE_BYTES + 1,
        }),
      ).rejects.toThrowError(/exceeds the maximum allowed limit/i);
    });

    it('creates presigned upload URL and correct publicUrl for valid formats', async () => {
      const service = new R2StorageService({
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
        bucketName: 'test-bucket',
        publicUrl: 'https://images.example.com',
        endpoint: 'https://test.r2.cloudflarestorage.com',
      });

      for (const mime of ['image/jpeg', 'image/png', 'image/webp'] as const) {
        const result = await service.createPresignedUploadUrl({
          contentType: mime,
          fileSize: 1024 * 1024,
        });

        expect(result.uploadUrl).toBeDefined();
        expect(typeof result.uploadUrl).toBe('string');
        expect(result.objectKey).toMatch(/^medicines\/[0-9a-f-]{36}\/packaging-[0-9a-f-]{36}\.(jpg|png|webp)$/);
        expect(result.publicUrl).toBe(`https://images.example.com/${result.objectKey}`);
      }
    });

    it('sends DeleteObjectCommand on deleteObject and deleteObjectByPublicUrl', async () => {
      const service = new R2StorageService({
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
        bucketName: 'test-bucket',
        publicUrl: 'https://images.example.com',
        endpoint: 'https://test.r2.cloudflarestorage.com',
      });

      await service.deleteObject('medicines/abc/packaging-def.png');
      expect(s3SendSpy).toHaveBeenCalled();

      await service.deleteObjectByPublicUrl('https://images.example.com/medicines/abc/packaging-def.webp');
      expect(s3SendSpy).toHaveBeenCalled();
    });
  });

  describe('POST /api/v1/uploads/medicine-image Endpoint', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const res = await request(app)
        .post('/api/v1/uploads/medicine-image')
        .send({ contentType: 'image/jpeg' });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('rejects non-admin role with 403', async () => {
      const res = await request(app)
        .post('/api/v1/uploads/medicine-image')
        .set(auth(employeeToken))
        .send({ contentType: 'image/jpeg' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects unsupported MIME types with 400', async () => {
      const res = await request(app)
        .post('/api/v1/uploads/medicine-image')
        .set(auth(adminToken))
        .send({ contentType: 'image/bmp' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects oversized file size with 400', async () => {
      const res = await request(app)
        .post('/api/v1/uploads/medicine-image')
        .set(auth(adminToken))
        .send({
          contentType: 'image/png',
          fileSize: 11 * 1024 * 1024,
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('successfully generates presigned upload URL for admin', async () => {
      const res = await request(app)
        .post('/api/v1/uploads/medicine-image')
        .set(auth(adminToken))
        .send({
          contentType: 'image/webp',
          fileSize: 2 * 1024 * 1024,
          fileName: 'packaging.webp',
        });

      expect(res.status).toBe(201);
      expect(res.body.uploadUrl).toBeDefined();
      expect(res.body.objectKey).toMatch(/^medicines\/[0-9a-f-]{36}\/packaging-[0-9a-f-]{36}\.webp$/);
      expect(res.body.publicUrl).toContain(res.body.objectKey);
    });

    it('supports image cleanup endpoint', async () => {
      const res = await request(app)
        .post('/api/v1/uploads/cleanup')
        .set(auth(adminToken))
        .send({
          objectKey: 'medicines/temp/packaging-temp.jpg',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('Medicine Lifecycle with R2 Images', () => {
    it('creates medicine with R2 imageUrl', async () => {
      const mfgName = unique('Mfg');
      const saltName = unique('Salt');
      const testImageUrl = `https://images.example.com/medicines/${unique('uuid')}/packaging-${unique('img')}.jpg`;

      const createRes = await request(app)
        .post('/api/v1/medicines')
        .set(auth(adminToken))
        .send({
          name: unique('Med With Image'),
          form: 'TABLET',
          packQuantity: 10,
          packUnit: 'TABLET',
          imageUrl: testImageUrl,
          prescriptionRequired: false,
          manufacturerName: mfgName,
          salts: [{ name: saltName, amount: 500, unit: 'MG' }],
          commercialDetails: { mrp: 100 },
        });

      expect(createRes.status).toBe(201);
      expect(createRes.body.medicine.imageUrl).toBe(testImageUrl);
    });

    it('creates medicine without image (imageUrl: null)', async () => {
      const mfgName = unique('Mfg');
      const saltName = unique('Salt');

      const createRes = await request(app)
        .post('/api/v1/medicines')
        .set(auth(adminToken))
        .send({
          name: unique('Med Without Image'),
          form: 'CAPSULE',
          packQuantity: 20,
          packUnit: 'CAPSULE',
          imageUrl: null,
          prescriptionRequired: false,
          manufacturerName: mfgName,
          salts: [{ name: saltName, amount: 250, unit: 'MG' }],
          commercialDetails: { mrp: 50 },
        });

      expect(createRes.status).toBe(201);
      expect(createRes.body.medicine.imageUrl).toBeNull();
    });

    it('cleans up old R2 image when medicine image is replaced', async () => {
      const mfgName = unique('Mfg');
      const saltName = unique('Salt');
      const oldImageUrl = `https://images.example.com/medicines/${unique('uuid')}/packaging-old.jpg`;
      const newImageUrl = `https://images.example.com/medicines/${unique('uuid')}/packaging-new.webp`;

      const createRes = await request(app)
        .post('/api/v1/medicines')
        .set(auth(adminToken))
        .send({
          name: unique('Med To Replace Image'),
          form: 'TABLET',
          packQuantity: 10,
          packUnit: 'TABLET',
          imageUrl: oldImageUrl,
          prescriptionRequired: false,
          manufacturerName: mfgName,
          salts: [{ name: saltName, amount: 500, unit: 'MG' }],
          commercialDetails: { mrp: 100 },
        });

      expect(createRes.status).toBe(201);
      const medicineId = createRes.body.medicine.id;

      s3SendSpy.mockClear();

      const patchRes = await request(app)
        .patch(`/api/v1/medicines/${medicineId}`)
        .set(auth(adminToken))
        .send({
          imageUrl: newImageUrl,
        });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.medicine.imageUrl).toBe(newImageUrl);
      expect(s3SendSpy).toHaveBeenCalled();
    });

    it('cleans up old R2 image when image is removed (set to null)', async () => {
      const mfgName = unique('Mfg');
      const saltName = unique('Salt');
      const oldImageUrl = `https://images.example.com/medicines/${unique('uuid')}/packaging-to-remove.jpg`;

      const createRes = await request(app)
        .post('/api/v1/medicines')
        .set(auth(adminToken))
        .send({
          name: unique('Med To Remove Image'),
          form: 'TABLET',
          packQuantity: 10,
          packUnit: 'TABLET',
          imageUrl: oldImageUrl,
          prescriptionRequired: false,
          manufacturerName: mfgName,
          salts: [{ name: saltName, amount: 500, unit: 'MG' }],
          commercialDetails: { mrp: 100 },
        });

      expect(createRes.status).toBe(201);
      const medicineId = createRes.body.medicine.id;

      s3SendSpy.mockClear();

      const patchRes = await request(app)
        .patch(`/api/v1/medicines/${medicineId}`)
        .set(auth(adminToken))
        .send({
          imageUrl: null,
        });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.medicine.imageUrl).toBeNull();
      expect(s3SendSpy).toHaveBeenCalled();
    });

    it('cleans up R2 image when medicine is deactivated / deleted', async () => {
      const mfgName = unique('Mfg');
      const saltName = unique('Salt');
      const targetImageUrl = `https://images.example.com/medicines/${unique('uuid')}/packaging-del.jpg`;

      const createRes = await request(app)
        .post('/api/v1/medicines')
        .set(auth(adminToken))
        .send({
          name: unique('Med To Delete With Image'),
          form: 'TABLET',
          packQuantity: 10,
          packUnit: 'TABLET',
          imageUrl: targetImageUrl,
          prescriptionRequired: false,
          manufacturerName: mfgName,
          salts: [{ name: saltName, amount: 500, unit: 'MG' }],
          commercialDetails: { mrp: 100 },
        });

      expect(createRes.status).toBe(201);
      const medicineId = createRes.body.medicine.id;

      s3SendSpy.mockClear();

      const deleteRes = await request(app)
        .delete(`/api/v1/medicines/${medicineId}`)
        .set(auth(adminToken));

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.medicine.active).toBe(false);
      expect(s3SendSpy).toHaveBeenCalled();
    });
  });
});
