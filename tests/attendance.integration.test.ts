import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { signAccessToken } from '../src/modules/auth/jwt.js';

describe('Admin Attendance & Salary Integration Tests', () => {
  let adminToken: string;
  let employeeToken: string;
  let adminUserId: string;
  let employee1Id: string;
  let employee2Id: string;

  const testSuffix = Date.now().toString();

  beforeAll(async () => {
    const passwordHash = await argon2.hash('TestPassword123');

    // Create an Admin
    const adminUser = await prisma.user.create({
      data: {
        name: `Attendance Admin ${testSuffix}`,
        email: `att-admin-${testSuffix}@example.com`,
        phone: `+9197000${testSuffix.slice(-5)}`,
        passwordHash,
        role: 'ADMIN',
        active: true,
      },
    });
    adminUserId = adminUser.id;

    // Create Employee 1 with ₹25,000 salary
    const emp1 = await prisma.user.create({
      data: {
        name: `Amit Patel ${testSuffix}`,
        email: `amit-${testSuffix}@example.com`,
        phone: `+9197111${testSuffix.slice(-5)}`,
        passwordHash,
        role: 'EMPLOYEE',
        monthlySalary: 25000,
        active: true,
      },
    });
    employee1Id = emp1.id;

    // Create Employee 2 with ₹30,000 salary
    const emp2 = await prisma.user.create({
      data: {
        name: `Priya Sharma ${testSuffix}`,
        email: `priya-${testSuffix}@example.com`,
        phone: `+9197222${testSuffix.slice(-5)}`,
        passwordHash,
        role: 'EMPLOYEE',
        monthlySalary: 30000,
        active: true,
      },
    });
    employee2Id = emp2.id;

    adminToken = await signAccessToken({ userId: adminUserId, role: 'ADMIN' });
    employeeToken = await signAccessToken({ userId: employee1Id, role: 'EMPLOYEE' });
  });

  afterAll(async () => {
    // Cascade delete users and their attendance records
    await prisma.user.deleteMany({
      where: {
        id: { in: [adminUserId, employee1Id, employee2Id] },
      },
    });
  });

  describe('Security & Authorization', () => {
    it('1. allows ADMIN to access attendance summary', async () => {
      const response = await request(app)
        .get('/api/v1/attendance/summary?year=2026&month=8')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('year', 2026);
      expect(response.body).toHaveProperty('month', 8);
      expect(response.body).toHaveProperty('employees');
      expect(Array.isArray(response.body.employees)).toBe(true);
    });

    it('2. denies EMPLOYEE from accessing attendance summary with 403', async () => {
      const response = await request(app)
        .get('/api/v1/attendance/summary?year=2026&month=8')
        .set('Authorization', `Bearer ${employeeToken}`);

      expect(response.status).toBe(403);
    });

    it('3. denies unauthenticated requests with 401', async () => {
      const response = await request(app).get('/api/v1/attendance/summary?year=2026&month=8');
      expect(response.status).toBe(401);
    });

    it('4. denies EMPLOYEE from creating or editing attendance with 403', async () => {
      const response = await request(app)
        .post('/api/v1/attendance')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({
          userId: employee1Id,
          date: '2026-08-04',
          status: 'ABSENT',
        });

      expect(response.status).toBe(403);
    });
  });

  describe('Present by Default & Dynamic Calculations', () => {
    it('5. attendance defaults to PRESENT for all working days when no records exist', async () => {
      const response = await request(app)
        .get(`/api/v1/attendance/users/${employee1Id}?year=2026&month=8`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      // August 2026 has 26 working days (31 days - 5 Sundays)
      expect(response.body.workingDays).toBe(26);
      expect(response.body.presentDays).toBe(26);
      expect(response.body.absentDays).toBe(0);
      expect(response.body.halfDays).toBe(0);
      expect(response.body.leaveDays).toBe(0);
      expect(response.body.payableDays).toBe(26);
      expect(response.body.attendancePercentage).toBe(100);
      // Full salary: ₹25,000
      expect(response.body.estimatedSalary).toBe(25000);
      expect(response.body.records).toEqual([]);
    });

    it('6. allows ADMIN to mark ABSENT exception with optional note', async () => {
      const response = await request(app)
        .post('/api/v1/attendance')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          userId: employee1Id,
          date: '2026-08-04',
          status: 'ABSENT',
          notes: 'Sick leave without notice',
        });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ABSENT');
      expect(response.body.record.notes).toBe('Sick leave without notice');
      expect(response.body.record.date).toBe('2026-08-04');
    });

    it('7. allows ADMIN to mark HALF_DAY exception', async () => {
      const response = await request(app)
        .post('/api/v1/attendance')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          userId: employee1Id,
          date: '2026-08-06',
          status: 'HALF_DAY',
          notes: 'Left early for personal emergency',
        });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('HALF_DAY');
      expect(response.body.record.date).toBe('2026-08-06');
    });

    it('8. allows ADMIN to mark LEAVE exception', async () => {
      const response = await request(app)
        .post('/api/v1/attendance')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          userId: employee1Id,
          date: '2026-08-10',
          status: 'LEAVE',
          notes: 'Approved family function',
        });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('LEAVE');
      expect(response.body.record.date).toBe('2026-08-10');
    });

    it('9. adds a second ABSENT day and verifies monthly salary and attendance percentage calculation', async () => {
      // Add another absent day on Aug 18
      await request(app)
        .post('/api/v1/attendance')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          userId: employee1Id,
          date: '2026-08-18',
          status: 'ABSENT',
          notes: 'Doctor visit',
        });

      // Employee 1 now has:
      // Working days = 26
      // Absent = 2 (Aug 4, Aug 18)
      // Half Day = 1 (Aug 6)
      // Leave = 1 (Aug 10)
      // Present = 26 - (2 + 1 + 1) = 22
      // Payable days = 22 + (1 * 0.5) = 22.5
      // Estimated salary = 25,000 / 26 * 22.5 = 21,634.615 -> 21,635
      // Attendance % = 22 / 26 * 100 = 84.6%

      const response = await request(app)
        .get(`/api/v1/attendance/users/${employee1Id}?year=2026&month=8`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.workingDays).toBe(26);
      expect(response.body.absentDays).toBe(2);
      expect(response.body.halfDays).toBe(1);
      expect(response.body.leaveDays).toBe(1);
      expect(response.body.presentDays).toBe(22);
      expect(response.body.payableDays).toBe(22.5);
      expect(response.body.attendancePercentage).toBe(84.6);
      expect(response.body.estimatedSalary).toBe(21635);
      expect(response.body.records.length).toBe(4);
    });

    it('10. verifies the prompt exact example: 23 Present, 2 Absent, 1 Half Day, 0 Leave = 23.5 Payable, 88.5% attendance, ₹22,596 salary', async () => {
      // Reset Aug 10 leave to PRESENT
      await request(app)
        .post('/api/v1/attendance')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          userId: employee1Id,
          date: '2026-08-10',
          status: 'PRESENT',
        });

      // Now:
      // Working days: 26
      // Present: 23
      // Absent: 2 (Aug 4, Aug 18)
      // Half Day: 1 (Aug 6)
      // Leave: 0
      // Payable days: 23.5
      // Estimated salary: ₹25,000 / 26 * 23.5 = ₹22,596
      // Attendance %: (23 / 26) * 100 = 88.5%

      const response = await request(app)
        .get(`/api/v1/attendance/users/${employee1Id}?year=2026&month=8`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.workingDays).toBe(26);
      expect(response.body.presentDays).toBe(23);
      expect(response.body.absentDays).toBe(2);
      expect(response.body.halfDays).toBe(1);
      expect(response.body.leaveDays).toBe(0);
      expect(response.body.payableDays).toBe(23.5);
      expect(response.body.attendancePercentage).toBe(88.5);
      expect(response.body.estimatedSalary).toBe(22596);
    });

    it('11. resetting an exception to PRESENT deletes the record from database', async () => {
      // Verify record for 2026-08-04 exists
      const dbRecordBefore = await prisma.attendanceRecord.findFirst({
        where: {
          userId: employee1Id,
          date: new Date(Date.UTC(2026, 7, 4)),
        },
      });
      expect(dbRecordBefore).toBeTruthy();
      expect(dbRecordBefore?.status).toBe('ABSENT');

      // Admin resets 2026-08-04 to PRESENT
      const resetResponse = await request(app)
        .post('/api/v1/attendance')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          userId: employee1Id,
          date: '2026-08-04',
          status: 'PRESENT',
        });

      expect(resetResponse.status).toBe(200);
      expect(resetResponse.body.status).toBe('PRESENT');
      expect(resetResponse.body.record).toBeNull();

      // Verify record is deleted in DB
      const dbRecordAfter = await prisma.attendanceRecord.findFirst({
        where: {
          userId: employee1Id,
          date: new Date(Date.UTC(2026, 7, 4)),
        },
      });
      expect(dbRecordAfter).toBeNull();
    });

    it('12. allows resetting an exception via DELETE endpoint', async () => {
      // Aug 6 is currently HALF_DAY
      const deleteResponse = await request(app)
        .delete(`/api/v1/attendance?userId=${employee1Id}&date=2026-08-06`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(deleteResponse.status).toBe(200);
      expect(deleteResponse.body.message).toContain('PRESENT');

      // Verify only 1 exception remains (Aug 18 ABSENT)
      const response = await request(app)
        .get(`/api/v1/attendance/users/${employee1Id}?year=2026&month=8`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.body.records.length).toBe(1);
      expect(response.body.presentDays).toBe(25);
      expect(response.body.absentDays).toBe(1);
      expect(response.body.halfDays).toBe(0);
      expect(response.body.payableDays).toBe(25);
    });

    it('13. prevents duplicate records by upserting cleanly on the same user and date', async () => {
      // Upsert ABSENT on Aug 18
      const res1 = await request(app)
        .post('/api/v1/attendance')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          userId: employee1Id,
          date: '2026-08-18',
          status: 'ABSENT',
          notes: 'Initial note',
        });
      expect(res1.status).toBe(200);

      // Change to HALF_DAY on same date
      const res2 = await request(app)
        .post('/api/v1/attendance')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          userId: employee1Id,
          date: '2026-08-18',
          status: 'HALF_DAY',
          notes: 'Updated note',
        });
      expect(res2.status).toBe(200);
      expect(res2.body.record.status).toBe('HALF_DAY');
      expect(res2.body.record.notes).toBe('Updated note');

      // Check DB count for that user/date is strictly 1
      const count = await prisma.attendanceRecord.count({
        where: {
          userId: employee1Id,
          date: new Date(Date.UTC(2026, 7, 18)),
        },
      });
      expect(count).toBe(1);
    });

    it('14. verifies monthly dashboard summary totals across all employees', async () => {
      const response = await request(app)
        .get('/api/v1/attendance/summary?year=2026&month=8')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.totalEmployees).toBeGreaterThanOrEqual(2);
      expect(response.body.overall).toHaveProperty('totalWorkingDays');
      expect(response.body.overall).toHaveProperty('presentDays');
      expect(response.body.overall).toHaveProperty('totalEstimatedPayroll');
      expect(response.body.today).toHaveProperty('present');
    });

    it('15. verifies User Administration supports viewing and updating monthlySalary', async () => {
      // Update Employee 1 monthly salary from ₹25,000 to ₹28,000
      const patchUserRes = await request(app)
        .patch(`/api/v1/users/${employee1Id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          monthlySalary: 28000,
        });

      expect(patchUserRes.status).toBe(200);
      expect(patchUserRes.body.user.monthlySalary).toBe(28000);

      // Verify attendance calculation dynamically reflects the updated monthly salary
      const attRes = await request(app)
        .get(`/api/v1/attendance/users/${employee1Id}?year=2026&month=8`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(attRes.status).toBe(200);
      // Working days = 26, Half Day = 1 (Aug 18), Present = 25 -> Payable days = 25.5
      // Estimated salary = 28,000 / 26 * 25.5 = 27,461.538 -> 27,462
      expect(attRes.body.user.monthlySalary).toBe(28000);
      expect(attRes.body.payableDays).toBe(25.5);
      expect(attRes.body.estimatedSalary).toBe(27462);
    });
  });
});
