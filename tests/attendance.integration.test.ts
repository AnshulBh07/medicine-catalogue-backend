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
      // August 2026 has 31 working days (Sundays are regular working days)
      expect(response.body.workingDays).toBe(31);
      expect(response.body.presentDays).toBe(31);
      expect(response.body.absentDays).toBe(0);
      expect(response.body.halfDays).toBe(0);
      expect(response.body.leaveDays).toBe(0);
      expect(response.body.payableDays).toBe(31);
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
      // Working days = 31
      // Absent = 2 (Aug 4, Aug 18)
      // Half Day = 1 (Aug 6)
      // Leave = 1 (Aug 10)
      // Present = 31 - (2 + 1 + 1) = 27
      // Payable days = 27 + (1 * 0.5) = 27.5
      // Estimated salary = 25,000 / 31 * 27.5 = 22,177.419 -> 22,177
      // Attendance % = 27 / 31 * 100 = 87.1%

      const response = await request(app)
        .get(`/api/v1/attendance/users/${employee1Id}?year=2026&month=8`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.workingDays).toBe(31);
      expect(response.body.absentDays).toBe(2);
      expect(response.body.halfDays).toBe(1);
      expect(response.body.leaveDays).toBe(1);
      expect(response.body.presentDays).toBe(27);
      expect(response.body.payableDays).toBe(27.5);
      expect(response.body.attendancePercentage).toBe(87.1);
      expect(response.body.estimatedSalary).toBe(22177);
      expect(response.body.records.length).toBe(4);
    });

    it('10. verifies attendance calculation with 28 Present, 2 Absent, 1 Half Day, 0 Leave = 28.5 Payable', async () => {
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
      // Working days: 31
      // Present: 28
      // Absent: 2 (Aug 4, Aug 18)
      // Half Day: 1 (Aug 6)
      // Leave: 0
      // Payable days: 28.5
      // Estimated salary: ₹25,000 / 31 * 28.5 = ₹22,984
      // Attendance %: (28 / 31) * 100 = 90.3%

      const response = await request(app)
        .get(`/api/v1/attendance/users/${employee1Id}?year=2026&month=8`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.workingDays).toBe(31);
      expect(response.body.presentDays).toBe(28);
      expect(response.body.absentDays).toBe(2);
      expect(response.body.halfDays).toBe(1);
      expect(response.body.leaveDays).toBe(0);
      expect(response.body.payableDays).toBe(28.5);
      expect(response.body.attendancePercentage).toBe(90.3);
      expect(response.body.estimatedSalary).toBe(22984);
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
      expect(response.body.presentDays).toBe(30);
      expect(response.body.absentDays).toBe(1);
      expect(response.body.halfDays).toBe(0);
      expect(response.body.payableDays).toBe(30);
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
      // Working days = 31, Half Day = 1 (Aug 18), Present = 30 -> Payable days = 30.5
      // Estimated salary = 28,000 / 31 * 30.5 = 27,548.387 -> 27,548
      expect(attRes.body.user.monthlySalary).toBe(28000);
      expect(attRes.body.payableDays).toBe(30.5);
      expect(attRes.body.estimatedSalary).toBe(27548);
    });
  });

  describe('Feature 2: Sunday Work, Half-Days, and Extra Time', () => {
    let halfDayEmpId: string;

    beforeAll(async () => {
      const passwordHash = await argon2.hash('TestPassword123');
      // Create half-day employee with monthlySalary ₹12,400 (31 days -> ₹400 per half-day shift unit)
      const hdEmp = await prisma.user.create({
        data: {
          name: `Half Day Worker ${testSuffix}`,
          email: `hd-worker-${testSuffix}@example.com`,
          phone: `+9197333${testSuffix.slice(-5)}`,
          passwordHash,
          role: 'EMPLOYEE',
          shiftType: 'HALF_DAY',
          monthlySalary: 12400,
          active: true,
        },
      });
      halfDayEmpId = hdEmp.id;
    });

    afterAll(async () => {
      await prisma.user.deleteMany({
        where: { id: halfDayEmpId },
      });
    });

    it('16. allows recording attendance on Sunday and persists correctly', async () => {
      // 2026-08-02 is a Sunday
      const sundayRes = await request(app)
        .post('/api/v1/attendance')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          userId: employee1Id,
          date: '2026-08-02',
          status: 'HALF_DAY',
          notes: 'Worked half Sunday shift',
        });

      expect(sundayRes.status).toBe(200);
      expect(sundayRes.body.record.status).toBe('HALF_DAY');
      expect(sundayRes.body.record.notes).toBe('Worked half Sunday shift');

      // Verify Sunday attendance appears in employee monthly attendance report
      const repRes = await request(app)
        .get(`/api/v1/attendance/users/${employee1Id}?year=2026&month=8`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(repRes.status).toBe(200);
      const sundayRec = repRes.body.records.find((r: { date: string }) => r.date.startsWith('2026-08-02'));
      expect(sundayRec).toBeTruthy();
      expect(sundayRec.status).toBe('HALF_DAY');
    });

    it('17. calculates pay for a half-day employee working a full day (2 units = ₹800, no overtime multiplier)', async () => {
      // Half-day employee has monthlySalary ₹12,400. In August (31 days), normal half-day rate is ₹400 (1 unit).
      // On 2026-08-03, employee works a full day shift (workUnits: 2).
      const workRes = await request(app)
        .post('/api/v1/attendance')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          userId: halfDayEmpId,
          date: '2026-08-03',
          status: 'PRESENT',
          workUnits: 2,
          notes: 'Covered full day shift',
        });

      expect(workRes.status).toBe(200);
      expect(Number(workRes.body.record.workUnits)).toBe(2);

      // Verify calculation:
      // Half-day employee standard month is 31 days * 1 unit = 31 units.
      // With Aug 3 as 2 units, total units = 30 + 2 = 32 units.
      // Normal unit rate = ₹12,400 / 31 = ₹400 per half-day unit.
      // Aug 3 full day alone is 2 units * ₹400 = ₹800!
      // Total salary = 32 units * ₹400 = ₹12,800.
      const empRes = await request(app)
        .get(`/api/v1/attendance/users/${halfDayEmpId}?year=2026&month=8`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(empRes.status).toBe(200);
      expect(empRes.body.shiftType).toBe('HALF_DAY');
      expect(empRes.body.estimatedSalary).toBe(12800);
    });

    it('18. supports extra-time / extended-shift paid at normal rate without overtime premium', async () => {
      // Set employee2 monthly salary to ₹31,000. In August (31 days), unit rate = (31000/31)/2 = ₹500/unit.
      await prisma.user.update({
        where: { id: employee2Id },
        data: { monthlySalary: 31000 },
      });

      // On 2026-08-05, employee works a double shift (4 half-day units = 2 full days).
      const extraRes = await request(app)
        .post('/api/v1/attendance')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          userId: employee2Id,
          date: '2026-08-05',
          status: 'PRESENT',
          workUnits: 4,
          notes: 'Double shift coverage',
        });

      expect(extraRes.status).toBe(200);
      expect(Number(extraRes.body.record.workUnits)).toBe(4);

      // Total units: 30 days * 2 units + 4 units = 64 units.
      // Pay = 64 * ₹500 = ₹32,000 (an exact ₹1,000 extra for 2 extra half-day units, no overtime multiplier).
      const empRes = await request(app)
        .get(`/api/v1/attendance/users/${employee2Id}?year=2026&month=8`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(empRes.status).toBe(200);
      expect(empRes.body.estimatedSalary).toBe(32000);
    });

    it('19. prevents double counting between attendance pay and additional-time pay', async () => {
      // If employee works 3 units on 2026-08-07, it should count 3 units total, not standard (2) + 3 = 5.
      const res = await request(app)
        .post('/api/v1/attendance')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          userId: employee2Id,
          date: '2026-08-07',
          status: 'PRESENT',
          workUnits: 3,
          notes: 'Full day + half day extended',
        });

      expect(res.status).toBe(200);
      expect(Number(res.body.record.workUnits)).toBe(3);

      const empRes = await request(app)
        .get(`/api/v1/attendance/users/${employee2Id}?year=2026&month=8`)
        .set('Authorization', `Bearer ${adminToken}`);

      // Aug 5 was 4 units (+2 extra units = +₹1,000)
      // Aug 7 was 3 units (+1 extra unit = +₹500)
      // Remaining 29 days are standard 2 units each = 58 units.
      // Total units = 58 + 4 + 3 = 65 units.
      // 65 units * ₹500 = ₹32,500.
      expect(empRes.body.estimatedSalary).toBe(32500);
    });
});
});
