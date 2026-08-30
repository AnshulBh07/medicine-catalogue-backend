import { S3Client } from '@aws-sdk/client-s3';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import {
  R2StorageService,
} from '../src/services/storage/r2.service.js';

let sequence = 0;
const unique = (prefix: string): string => `${prefix}-${Date.now()}-${sequence++}`;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('User Profile & Cloudflare R2 Profile Image Integration', () => {
  let adminUser: { id: string; name: string; email: string | null; role: 'ADMIN' };
  let employeeUser: { id: string; name: string; email: string | null; role: 'EMPLOYEE' };
  let adminToken: string;
  let employeeToken: string;
  let s3SendSpy: MockInstance;

  beforeAll(async () => {
    const passwordHash = '$argon2id$v=19$m=65536,t=3,p=4$fakehashfortests';

    const createdAdmin = await prisma.user.create({
      data: {
        name: 'Admin Profile Tester',
        email: `${unique('admin-profile')}@example.com`,
        phone: `+919${String(Date.now()).slice(-8)}3`,
        passwordHash,
        role: 'ADMIN',
        active: true,
      },
    });
    adminUser = { id: createdAdmin.id, name: createdAdmin.name, email: createdAdmin.email, role: 'ADMIN' };

    const createdEmp = await prisma.user.create({
      data: {
        name: 'Employee Profile Tester',
        email: `${unique('emp-profile')}@example.com`,
        phone: `+919${String(Date.now()).slice(-8)}4`,
        passwordHash,
        role: 'EMPLOYEE',
        active: true,
      },
    });
    employeeUser = { id: createdEmp.id, name: createdEmp.name, email: createdEmp.email, role: 'EMPLOYEE' };

    const { signAccessToken } = await import('../src/modules/auth/jwt.js');
    adminToken = await signAccessToken({ userId: adminUser.id, role: 'ADMIN' });
    employeeToken = await signAccessToken({ userId: employeeUser.id, role: 'EMPLOYEE' });

    s3SendSpy = vi.spyOn(S3Client.prototype, 'send').mockImplementation(async () => {
      return { $metadata: { httpStatusCode: 200 } } as never;
    });
  });

  afterAll(async () => {
    s3SendSpy?.mockRestore();
  });

  describe('R2StorageService Profile Key Generation', () => {
    it('generates unique object key with user namespace and correct extension', () => {
      const service = new R2StorageService();
      const jpegKey = service.generateProfileImageObjectKey('user-123', 'image/jpeg');
      const pngKey = service.generateProfileImageObjectKey('user-123', 'image/png');
      const webpKey = service.generateProfileImageObjectKey('user-123', 'image/webp');

      expect(jpegKey).toMatch(/^profile-images\/user-123\/avatar-[0-9a-f-]{36}\.jpg$/);
      expect(pngKey).toMatch(/^profile-images\/user-123\/avatar-[0-9a-f-]{36}\.png$/);
      expect(webpKey).toMatch(/^profile-images\/user-123\/avatar-[0-9a-f-]{36}\.webp$/);
      expect(jpegKey).not.toBe(service.generateProfileImageObjectKey('user-123', 'image/jpeg'));
    });

    it('extracts profile image object key from URL correctly', () => {
      const service = new R2StorageService({
        publicUrl: 'https://images.example.com',
      });

      const key = 'profile-images/user-123/avatar-uuid-456.jpg';
      const fullUrl = `https://images.example.com/${key}`;

      expect(service.getObjectKeyFromUrl(fullUrl)).toBe(key);
      expect(service.getObjectKeyFromUrl(`https://otherdomain.com/${key}`)).toBe(key);
    });
  });

  describe('POST /api/v1/uploads/profile-image Endpoint', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const res = await request(app)
        .post('/api/v1/uploads/profile-image')
        .send({ contentType: 'image/jpeg' });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('allows EMPLOYEE role to request presigned upload URL for their own profile', async () => {
      const res = await request(app)
        .post('/api/v1/uploads/profile-image')
        .set(auth(employeeToken))
        .send({
          contentType: 'image/webp',
          fileSize: 1024 * 500,
        });

      expect(res.status).toBe(201);
      expect(res.body.uploadUrl).toBeDefined();
      expect(res.body.objectKey).toMatch(new RegExp(`^profile-images/${employeeUser.id}/avatar-[0-9a-f-]{36}\\.webp$`));
      expect(res.body.publicUrl).toContain(res.body.objectKey);
    });

    it('allows ADMIN role to request presigned upload URL for their own profile', async () => {
      const res = await request(app)
        .post('/api/v1/uploads/profile-image')
        .set(auth(adminToken))
        .send({
          contentType: 'image/png',
          fileSize: 1024 * 1024,
        });

      expect(res.status).toBe(201);
      expect(res.body.uploadUrl).toBeDefined();
      expect(res.body.objectKey).toMatch(new RegExp(`^profile-images/${adminUser.id}/avatar-[0-9a-f-]{36}\\.png$`));
      expect(res.body.publicUrl).toContain(res.body.objectKey);
    });

    it('rejects unsupported MIME type with 400', async () => {
      const res = await request(app)
        .post('/api/v1/uploads/profile-image')
        .set(auth(employeeToken))
        .send({ contentType: 'image/gif' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/users/me Endpoint', () => {
    it('rejects unauthenticated request with 401', async () => {
      const res = await request(app).get('/api/v1/users/me');
      expect(res.status).toBe(401);
    });

    it('returns authenticated user profile including profileImageUrl', async () => {
      const res = await request(app)
        .get('/api/v1/users/me')
        .set(auth(adminToken));

      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.id).toBe(adminUser.id);
      expect(res.body.user.name).toBe(adminUser.name);
      expect(res.body.user.role).toBe('ADMIN');
      expect(res.body.user.profileImageUrl).toBeNull();
      expect(res.body.user.passwordHash).toBeUndefined();
    });
  });

  describe('PATCH /api/v1/users/me Endpoint', () => {
    it('rejects unauthenticated request with 401', async () => {
      const res = await request(app)
        .patch('/api/v1/users/me')
        .send({ name: 'Hacker Name' });
      expect(res.status).toBe(401);
    });

    it('updates user name, email, phone, and profileImageUrl', async () => {
      const newImageUrl = `https://images.example.com/profile-images/${employeeUser.id}/avatar-test1.jpg`;
      const updatedName = 'Updated Employee Name';
      const updatedPhone = `+919${String(Date.now()).slice(-8)}8`;

      const res = await request(app)
        .patch('/api/v1/users/me')
        .set(auth(employeeToken))
        .send({
          name: updatedName,
          phone: updatedPhone,
          profileImageUrl: newImageUrl,
        });

      expect(res.status).toBe(200);
      expect(res.body.user.name).toBe(updatedName);
      expect(res.body.user.phone).toBe(updatedPhone);
      expect(res.body.user.profileImageUrl).toBe(newImageUrl);
    });

    it('does not allow updating role through profile edit', async () => {
      const res = await request(app)
        .patch('/api/v1/users/me')
        .set(auth(employeeToken))
        .send({
          role: 'ADMIN',
        });

      // Strict schema rejects unknown fields like role
      expect(res.status).toBe(400);

      // Verify user is still EMPLOYEE
      const verifyRes = await request(app)
        .get('/api/v1/users/me')
        .set(auth(employeeToken));
      expect(verifyRes.body.user.role).toBe('EMPLOYEE');
    });

    it('deletes old R2 image when profile image is replaced', async () => {
      const oldImageUrl = `https://images.example.com/profile-images/${adminUser.id}/avatar-old.jpg`;
      const newImageUrl = `https://images.example.com/profile-images/${adminUser.id}/avatar-new.webp`;

      // Set initial image
      await request(app)
        .patch('/api/v1/users/me')
        .set(auth(adminToken))
        .send({ profileImageUrl: oldImageUrl });

      s3SendSpy.mockClear();

      // Replace image
      const res = await request(app)
        .patch('/api/v1/users/me')
        .set(auth(adminToken))
        .send({ profileImageUrl: newImageUrl });

      expect(res.status).toBe(200);
      expect(res.body.user.profileImageUrl).toBe(newImageUrl);
      expect(s3SendSpy).toHaveBeenCalled();
    });
  });

  describe('DELETE /api/v1/users/me/profile-image Endpoint', () => {
    it('removes profile image, sets profileImageUrl to null, and deletes from R2', async () => {
      const testImageUrl = `https://images.example.com/profile-images/${adminUser.id}/avatar-to-delete.jpg`;

      // Set image first
      await request(app)
        .patch('/api/v1/users/me')
        .set(auth(adminToken))
        .send({ profileImageUrl: testImageUrl });

      s3SendSpy.mockClear();

      // Delete image
      const res = await request(app)
        .delete('/api/v1/users/me/profile-image')
        .set(auth(adminToken));

      expect(res.status).toBe(200);
      expect(res.body.user.profileImageUrl).toBeNull();
      expect(s3SendSpy).toHaveBeenCalled();

      // Verify in DB
      const verifyRes = await request(app)
        .get('/api/v1/users/me')
        .set(auth(adminToken));
      expect(verifyRes.body.user.profileImageUrl).toBeNull();
    });
  });
});
