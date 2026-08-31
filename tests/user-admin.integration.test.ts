import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { signAccessToken } from '../src/modules/auth/jwt.js';

describe('Admin User Management Integration Tests', () => {
  let adminToken: string;
  let employeeToken: string;
  let adminUserId: string;
  let employeeUserId: string;

  const testSuffix = Date.now().toString();

  beforeAll(async () => {
    const adminPasswordHash = await argon2.hash('AdminPassword123');
    const employeePasswordHash = await argon2.hash('EmployeePassword123');

    const adminUser = await prisma.user.create({
      data: {
        name: `Admin Manager ${testSuffix}`,
        email: `admin-mgr-${testSuffix}@example.com`,
        phone: `+9190000${testSuffix.slice(-5)}`,
        passwordHash: adminPasswordHash,
        role: 'ADMIN',
        active: true,
      },
    });
    adminUserId = adminUser.id;

    const employeeUser = await prisma.user.create({
      data: {
        name: `Staff Member ${testSuffix}`,
        email: `staff-${testSuffix}@example.com`,
        phone: `+9191111${testSuffix.slice(-5)}`,
        passwordHash: employeePasswordHash,
        role: 'EMPLOYEE',
        active: true,
      },
    });
    employeeUserId = employeeUser.id;

    adminToken = await signAccessToken({ userId: adminUserId, role: 'ADMIN' });
    employeeToken = await signAccessToken({ userId: employeeUserId, role: 'EMPLOYEE' });
  });

  afterAll(async () => {
    // Clean up created users
    await prisma.user.deleteMany({
      where: {
        email: {
          contains: testSuffix,
        },
      },
    });
  });

  describe('GET /api/v1/users (List Users)', () => {
    it('1. allows ADMIN to list users with pagination metadata', async () => {
      const response = await request(app)
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('users');
      expect(Array.isArray(response.body.users)).toBe(true);
      expect(response.body).toHaveProperty('total');
      expect(response.body.users.length).toBeGreaterThan(0);

      // Verify passwords are never exposed
      for (const u of response.body.users) {
        expect(u).not.toHaveProperty('passwordHash');
        expect(u).not.toHaveProperty('password');
      }
    });

    it('2. filters users by role and active status', async () => {
      const response = await request(app)
        .get('/api/v1/users?role=ADMIN&active=true')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.users.every((u: { role: string; active: boolean }) => u.role === 'ADMIN' && u.active === true)).toBe(true);
    });

    it('3. searches users by name or email', async () => {
      const response = await request(app)
        .get(`/api/v1/users?search=Staff Member ${testSuffix}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.users.length).toBe(1);
      expect(response.body.users[0].id).toBe(employeeUserId);
    });

    it('4. denies EMPLOYEE access to list users with 403', async () => {
      const response = await request(app)
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${employeeToken}`);

      expect(response.status).toBe(403);
    });

    it('5. denies unauthenticated requests with 401', async () => {
      const response = await request(app).get('/api/v1/users');
      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/v1/users (Create User)', () => {
    it('6. allows ADMIN to create a new EMPLOYEE user with hashed password', async () => {
      const newEmail = `new-emp-${testSuffix}@example.com`;
      const response = await request(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Newly Created Employee',
          email: newEmail,
          phone: `+9192222${testSuffix.slice(-5)}`,
          password: 'StrongPassword123',
          role: 'EMPLOYEE',
        });

      expect(response.status).toBe(201);
      expect(response.body.user).toHaveProperty('id');
      expect(response.body.user.name).toBe('Newly Created Employee');
      expect(response.body.user.email).toBe(newEmail);
      expect(response.body.user.role).toBe('EMPLOYEE');
      expect(response.body.user.active).toBe(true);
      expect(response.body.user).not.toHaveProperty('passwordHash');

      // Verify in DB that password was hashed
      const dbUser = await prisma.user.findUnique({
        where: { id: response.body.user.id },
      });
      expect(dbUser).toBeTruthy();
      expect(dbUser?.passwordHash).not.toBe('StrongPassword123');
      expect(await argon2.verify(dbUser!.passwordHash, 'StrongPassword123')).toBe(true);
    });

    it('7. allows ADMIN to create a new ADMIN user', async () => {
      const newEmail = `new-adm-${testSuffix}@example.com`;
      const response = await request(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Newly Created Admin',
          email: newEmail,
          password: 'AdminPassword123!',
          role: 'ADMIN',
        });

      expect(response.status).toBe(201);
      expect(response.body.user.role).toBe('ADMIN');
    });

    it('8. rejects duplicate email with 409 DUPLICATE_IDENTIFIER', async () => {
      const response = await request(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Duplicate Email User',
          email: `staff-${testSuffix}@example.com`,
          password: 'SomePassword123',
          role: 'EMPLOYEE',
        });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('DUPLICATE_IDENTIFIER');
    });

    it('9. rejects invalid password length with 400', async () => {
      const response = await request(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Short Password User',
          email: `short-${testSuffix}@example.com`,
          password: 'short',
          role: 'EMPLOYEE',
        });

      expect(response.status).toBe(400);
    });

    it('10. denies EMPLOYEE from creating users with 403', async () => {
      const response = await request(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({
          name: 'Forbidden User',
          email: `forbidden-${testSuffix}@example.com`,
          password: 'ValidPassword123',
          role: 'EMPLOYEE',
        });

      expect(response.status).toBe(403);
    });
  });

  describe('GET /api/v1/users/:id (User Details)', () => {
    it('11. allows ADMIN to view user details by id', async () => {
      const response = await request(app)
        .get(`/api/v1/users/${employeeUserId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.user.id).toBe(employeeUserId);
      expect(response.body.user.name).toBe(`Staff Member ${testSuffix}`);
      expect(response.body.user).not.toHaveProperty('passwordHash');
    });

    it('12. returns 404 for nonexistent user ID', async () => {
      const response = await request(app)
        .get('/api/v1/users/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(404);
    });
  });

  describe('PATCH /api/v1/users/:id (Update User)', () => {
    it('13. allows ADMIN to update user name, email, and phone', async () => {
      const updatedName = `Updated Staff ${testSuffix}`;
      const response = await request(app)
        .patch(`/api/v1/users/${employeeUserId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: updatedName,
          phone: `+9199999${testSuffix.slice(-5)}`,
        });

      expect(response.status).toBe(200);
      expect(response.body.user.name).toBe(updatedName);
      expect(response.body.user.phone).toBe(`+9199999${testSuffix.slice(-5)}`);
    });

    it('14. allows ADMIN to change another user role to ADMIN', async () => {
      const response = await request(app)
        .patch(`/api/v1/users/${employeeUserId}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'ADMIN' });

      expect(response.status).toBe(200);
      expect(response.body.user.role).toBe('ADMIN');

      // Change back to EMPLOYEE
      const revertResponse = await request(app)
        .patch(`/api/v1/users/${employeeUserId}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'EMPLOYEE' });

      expect(revertResponse.status).toBe(200);
      expect(revertResponse.body.user.role).toBe('EMPLOYEE');
    });

    it('15. prevents ADMIN from self-demoting to EMPLOYEE with 400 CANNOT_DEMOTE_SELF', async () => {
      const response = await request(app)
        .patch(`/api/v1/users/${adminUserId}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'EMPLOYEE' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('CANNOT_DEMOTE_SELF');
    });

    it('16. allows ADMIN to deactivate and reactivate a user account', async () => {
      // Deactivate
      const deactivateRes = await request(app)
        .patch(`/api/v1/users/${employeeUserId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ active: false });

      expect(deactivateRes.status).toBe(200);
      expect(deactivateRes.body.user.active).toBe(false);

      // Verify deactivated user cannot log in
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          identifier: `staff-${testSuffix}@example.com`,
          password: 'EmployeePassword123',
        });
      expect(loginRes.status).toBe(401);

      // Reactivate
      const reactivateRes = await request(app)
        .patch(`/api/v1/users/${employeeUserId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ active: true });

      expect(reactivateRes.status).toBe(200);
      expect(reactivateRes.body.user.active).toBe(true);

      // Verify reactivated user can log in again
      const loginAgainRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          identifier: `staff-${testSuffix}@example.com`,
          password: 'EmployeePassword123',
        });
      expect(loginAgainRes.status).toBe(200);
      expect(loginAgainRes.body).toHaveProperty('accessToken');
    });

    it('17. prevents ADMIN from deactivating their own account with 400 CANNOT_DEACTIVATE_SELF', async () => {
      const response = await request(app)
        .patch(`/api/v1/users/${adminUserId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ active: false });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('CANNOT_DEACTIVATE_SELF');
    });
  });

  describe('DELETE /api/v1/users/:id (Delete User)', () => {
    it('18. prevents ADMIN from deleting their own account with 400 CANNOT_DELETE_SELF', async () => {
      const response = await request(app)
        .delete(`/api/v1/users/${adminUserId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('CANNOT_DELETE_SELF');
    });

    it('19. allows ADMIN to safely delete a user with no dependent records', async () => {
      const tempUser = await prisma.user.create({
        data: {
          name: `Temp Delete ${testSuffix}`,
          email: `temp-delete-${testSuffix}@example.com`,
          passwordHash: 'hash',
          role: 'EMPLOYEE',
          active: true,
        },
      });

      const deleteRes = await request(app)
        .delete(`/api/v1/users/${tempUser.id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.message).toContain('successfully');

      // Verify user was deleted
      const checkUser = await prisma.user.findUnique({
        where: { id: tempUser.id },
      });
      expect(checkUser).toBeNull();
    });
  });
});
