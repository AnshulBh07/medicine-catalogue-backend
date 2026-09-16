import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { signAccessToken } from '../src/modules/auth/jwt.js';
import { NotificationService } from '../src/modules/notifications/notification.service.js';
import {
  runDealInactivityCheck,
  runExpiryCheck,
} from '../src/modules/notifications/notification.scheduler.js';

describe('Notification System Integration Tests', () => {
  let adminToken: string;
  let adminUserId: string;
  let employeeToken: string;
  let employeeUserId: string;

  let testManufacturerId: string;
  let testCompositionId: string;
  let testMrId: string;

  const testSuffix = Date.now().toString().slice(-6);

  beforeAll(async () => {
    const passwordHash = await argon2.hash('TestPassword123');

    // Create Admin user
    const admin = await prisma.user.create({
      data: {
        name: `Notif Admin ${testSuffix}`,
        email: `notif-admin-${testSuffix}@example.com`,
        phone: `+9198${testSuffix.padStart(8, '0')}`,
        passwordHash,
        role: 'ADMIN',
        active: true,
      },
    });
    adminUserId = admin.id;

    adminToken = await signAccessToken({
      userId: adminUserId,
      email: admin.email!,
      role: 'ADMIN',
    });

    // Create Employee user
    const employee = await prisma.user.create({
      data: {
        name: `Notif Employee ${testSuffix}`,
        email: `notif-emp-${testSuffix}@example.com`,
        phone: `+9197${testSuffix.padStart(8, '0')}`,
        passwordHash,
        role: 'EMPLOYEE',
        active: true,
      },
    });
    employeeUserId = employee.id;

    employeeToken = await signAccessToken({
      userId: employeeUserId,
      email: employee.email!,
      role: 'EMPLOYEE',
    });

    // Create supporting entities
    const mfg = await prisma.manufacturer.create({
      data: { name: `Notif Pharma ${testSuffix}` },
    });
    testManufacturerId = mfg.id;

    const comp = await prisma.composition.create({
      data: { displayText: `Paracetamol ${testSuffix}mg` },
    });
    testCompositionId = comp.id;

    const mr = await prisma.mR.create({
      data: {
        name: `Rajesh Kumar ${testSuffix}`,
        company: `Sun Pharma ${testSuffix}`,
        phone: '+919811122233',
        email: `rajesh-${testSuffix}@sunpharma.com`,
      },
    });
    testMrId = mr.id;
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({
      where: { userId: { in: [adminUserId, employeeUserId] } },
    });
    await prisma.deal.deleteMany({
      where: { mrId: testMrId },
    });
    await prisma.batch.deleteMany({
      where: { batchNumber: { contains: testSuffix } },
    });
    await prisma.medicine.deleteMany({
      where: { name: { contains: testSuffix } },
    });
    await prisma.mR.deleteMany({ where: { id: testMrId } });
    await prisma.composition.deleteMany({ where: { id: testCompositionId } });
    await prisma.manufacturer.deleteMany({ where: { id: testManufacturerId } });
    await prisma.user.deleteMany({
      where: { id: { in: [adminUserId, employeeUserId] } },
    });
  });

  describe('Authentication & Security', () => {
    it('rejects unauthenticated requests to notifications', async () => {
      const res = await request(app).get('/api/v1/notifications');
      expect(res.status).toBe(401);
    });

    it('rejects unauthenticated requests to unread count', async () => {
      const res = await request(app).get('/api/v1/notifications/unread-count');
      expect(res.status).toBe(401);
    });

    it('prevents user from reading another user notification', async () => {
      // Create notification specifically for admin
      const notif = await NotificationService.createNotification({
        userId: adminUserId,
        type: 'MEDICINE_CREATED',
        priority: 'UPDATE',
        title: 'Admin only view test',
        message: 'Test message',
        entityType: 'MEDICINE',
      });
      expect(notif).toBeDefined();

      // Employee attempts to mark admin's notification as read
      const res = await request(app)
        .patch(`/api/v1/notifications/${notif!.id}/read`)
        .set('Authorization', `Bearer ${employeeToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe('Role-Based Visibility (ADMIN vs EMPLOYEE)', () => {
    it('restricts Deal notifications strictly to ADMIN users', async () => {
      // Create a Deal
      const med = await prisma.medicine.create({
        data: {
          name: `Azithromycin ${testSuffix}`,
          compositionId: testCompositionId,
          manufacturerId: testManufacturerId,
          form: 'TABLET',
          packQuantity: 10,
          packUnit: 'TABLET',
          prescriptionRequired: false,
          active: true,
        },
      });

      const dealRes = await request(app)
        .post('/api/v1/deals')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          medicineId: med.id,
          mrId: testMrId,
          agreedMrp: 120,
          agreedScheme: '10+2',
          agreedBillDiscount: 5,
        });

      expect(dealRes.status).toBe(201);
      const dealId = dealRes.body.deal.id;

      // Admin should see DEAL_CREATED notification
      const adminNotifsRes = await request(app)
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(adminNotifsRes.status).toBe(200);
      const adminDealNotif = adminNotifsRes.body.notifications.find(
        (n: { type: string; entityId: string }) =>
          n.type === 'DEAL_CREATED' && n.entityId === dealId,
      );
      expect(adminDealNotif).toBeDefined();
      expect(adminDealNotif.priority).toBe('UPDATE');

      // Employee must NOT see DEAL_CREATED notification in list
      const empNotifsRes = await request(app)
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${employeeToken}`);

      expect(empNotifsRes.status).toBe(200);
      const empDealNotif = empNotifsRes.body.notifications.find(
        (n: { type: string }) => n.type === 'DEAL_CREATED',
      );
      expect(empDealNotif).toBeUndefined();

      // Employee unread count must not include deal notifications
      const empUnreadRes = await request(app)
        .get('/api/v1/notifications/unread-count')
        .set('Authorization', `Bearer ${employeeToken}`);
      expect(empUnreadRes.status).toBe(200);
    });
  });

  describe('Read / Unread State & Mark All Read', () => {
    it('marks an individual notification as read and updates count', async () => {
      // Create a test notification for employee
      const notif = await NotificationService.createNotification({
        userId: employeeUserId,
        type: 'MEDICINE_CREATED',
        priority: 'UPDATE',
        title: 'Individual read test',
        message: 'Sample unread message',
        entityType: 'MEDICINE',
      });
      expect(notif).toBeDefined();

      const initialUnreadRes = await request(app)
        .get('/api/v1/notifications/unread-count')
        .set('Authorization', `Bearer ${employeeToken}`);
      const initialCount = initialUnreadRes.body.unreadCount;

      // Mark it as read
      const markRes = await request(app)
        .patch(`/api/v1/notifications/${notif!.id}/read`)
        .set('Authorization', `Bearer ${employeeToken}`);

      expect(markRes.status).toBe(200);
      expect(markRes.body.notification.isRead).toBe(true);
      expect(markRes.body.notification.readAt).toBeDefined();

      // Verify unread count decreased
      const updatedUnreadRes = await request(app)
        .get('/api/v1/notifications/unread-count')
        .set('Authorization', `Bearer ${employeeToken}`);
      expect(updatedUnreadRes.body.unreadCount).toBe(initialCount - 1);
    });

    it('marks all notifications as read', async () => {
      // Create multiple notifications for employee
      await NotificationService.createNotification({
        userId: employeeUserId,
        type: 'MEDICINE_UPDATED',
        priority: 'UPDATE',
        title: 'Batch read 1',
        message: 'Message 1',
        entityType: 'MEDICINE',
      });
      await NotificationService.createNotification({
        userId: employeeUserId,
        type: 'MR_UPDATED',
        priority: 'UPDATE',
        title: 'Batch read 2',
        message: 'Message 2',
        entityType: 'MR',
      });

      const markAllRes = await request(app)
        .post('/api/v1/notifications/mark-all-read')
        .set('Authorization', `Bearer ${employeeToken}`);

      expect(markAllRes.status).toBe(200);
      expect(markAllRes.body.count).toBeGreaterThanOrEqual(2);

      // Verify unread count is now 0
      const finalUnreadRes = await request(app)
        .get('/api/v1/notifications/unread-count')
        .set('Authorization', `Bearer ${employeeToken}`);
      expect(finalUnreadRes.body.unreadCount).toBe(0);
    });
  });

  describe('Medicine Batch Expiry Scheduler (Condition-Based)', () => {
    it('handles batch expiry conditions and prevents duplicates', async () => {
      const now = new Date('2026-09-16T12:00:00Z');

      const med = await prisma.medicine.create({
        data: {
          name: `Paracetamol Expiry Test ${testSuffix}`,
          compositionId: testCompositionId,
          manufacturerId: testManufacturerId,
          form: 'TABLET',
          packQuantity: 10,
          packUnit: 'TABLET',
          prescriptionRequired: false,
          active: true,
        },
      });

      // 1. Batch outside 2-month window (e.g. 4 months ahead)
      const fourMonthsAhead = new Date(now.getTime() + 120 * 24 * 60 * 60 * 1000);
      const batchFar = await prisma.batch.create({
        data: {
          medicineId: med.id,
          batchNumber: `P-FAR-${testSuffix}`,
          expiryDate: fourMonthsAhead,
        },
      });

      // 2. Batch within 2-month window (45 days ahead)
      const fortyFiveDaysAhead = new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000);
      const batchSoon = await prisma.batch.create({
        data: {
          medicineId: med.id,
          batchNumber: `P-SOON-${testSuffix}`,
          expiryDate: fortyFiveDaysAhead,
        },
      });

      // 3. Batch already expired (4 days ago)
      const fourDaysAgo = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000);
      const batchExpired = await prisma.batch.create({
        data: {
          medicineId: med.id,
          batchNumber: `P-EXP-${testSuffix}`,
          expiryDate: fourDaysAgo,
        },
      });

      // Run expiry check
      await runExpiryCheck(now);

      // Verify notifications generated for admin
      const notifsRes = await request(app)
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${adminToken}`);

      const notifs = notifsRes.body.notifications;

      // Far batch should have NO notification
      const farNotif = notifs.find(
        (n: { entityId: string }) => n.entityId === batchFar.id,
      );
      expect(farNotif).toBeUndefined();

      // Soon batch should have CRITICAL MEDICINE_EXPIRING_SOON notification
      const soonNotif = notifs.find(
        (n: { entityId: string }) => n.entityId === batchSoon.id,
      );
      expect(soonNotif).toBeDefined();
      expect(soonNotif.type).toBe('MEDICINE_EXPIRING_SOON');
      expect(soonNotif.priority).toBe('CRITICAL');
      expect(soonNotif.title).toBe('Medicine expiring soon');

      // Expired batch should have CRITICAL MEDICINE_EXPIRED notification
      const expiredNotif = notifs.find(
        (n: { entityId: string }) => n.entityId === batchExpired.id,
      );
      expect(expiredNotif).toBeDefined();
      expect(expiredNotif.type).toBe('MEDICINE_EXPIRED');
      expect(expiredNotif.priority).toBe('CRITICAL');
      expect(expiredNotif.title).toBe('Medicine expired');

      // Re-run scheduler with same date -> MUST NOT DUPLICATE
      await runExpiryCheck(now);

      const notifsRes2 = await request(app)
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${adminToken}`);

      const soonCount = notifsRes2.body.notifications.filter(
        (n: { entityId: string; type: string }) =>
          n.entityId === batchSoon.id && n.type === 'MEDICINE_EXPIRING_SOON',
      ).length;
      expect(soonCount).toBe(1);

      const expiredCount = notifsRes2.body.notifications.filter(
        (n: { entityId: string; type: string }) =>
          n.entityId === batchExpired.id && n.type === 'MEDICINE_EXPIRED',
      ).length;
      expect(expiredCount).toBe(1);

      // Advance time past soon batch expiry -> transitions to MEDICINE_EXPIRED and supersedes soon warning
      const futureDate = new Date(fortyFiveDaysAhead.getTime() + 2 * 24 * 60 * 60 * 1000);
      await runExpiryCheck(futureDate);

      const notifsRes3 = await request(app)
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${adminToken}`);

      const transitionedExpired = notifsRes3.body.notifications.find(
        (n: { entityId: string; type: string }) =>
          n.entityId === batchSoon.id && n.type === 'MEDICINE_EXPIRED',
      );
      expect(transitionedExpired).toBeDefined();
      expect(transitionedExpired.priority).toBe('CRITICAL');
    });
  });

  describe('Deal Inactivity Scheduler (Condition-Based, ADMIN ONLY)', () => {
    it('evaluates deal inactivity, respects last status change, and prevents duplicates', async () => {
      const baseDate = new Date('2026-08-01T10:00:00Z');

      const med = await prisma.medicine.create({
        data: {
          name: `Deal Inactivity Med ${testSuffix}`,
          compositionId: testCompositionId,
          manufacturerId: testManufacturerId,
          form: 'TABLET',
          packQuantity: 10,
          packUnit: 'TABLET',
          prescriptionRequired: false,
          active: true,
        },
      });

      // Create a deal with statusUpdatedAt 10 days ago (not inactive yet)
      const deal = await prisma.deal.create({
        data: {
          medicineId: med.id,
          mrId: testMrId,
          dealDate: baseDate,
          agreedMrp: 150,
          agreedScheme: '10+1',
          agreedBillDiscount: 4,
          status: 'PENDING',
          statusUpdatedAt: baseDate,
        },
      });

      // Day 15 (only 15 days since status change) -> No notification
      const day15 = new Date(baseDate.getTime() + 15 * 24 * 60 * 60 * 1000);
      await runDealInactivityCheck(day15);

      let notifsRes = await request(app)
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${adminToken}`);

      let inactiveNotif = notifsRes.body.notifications.find(
        (n: { entityId: string; type: string }) =>
          n.entityId === deal.id && n.type === 'DEAL_INACTIVE_30_DAYS',
      );
      expect(inactiveNotif).toBeUndefined();

      // Day 31 (31 days since status change) -> Generates DEAL_INACTIVE_30_DAYS for Admin only
      const day31 = new Date(baseDate.getTime() + 31 * 24 * 60 * 60 * 1000);
      await runDealInactivityCheck(day31);

      notifsRes = await request(app)
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${adminToken}`);

      inactiveNotif = notifsRes.body.notifications.find(
        (n: { entityId: string; type: string }) =>
          n.entityId === deal.id && n.type === 'DEAL_INACTIVE_30_DAYS',
      );
      expect(inactiveNotif).toBeDefined();
      expect(inactiveNotif.priority).toBe('ATTENTION');
      expect(inactiveNotif.title).toBe('Deal needs attention');

      // Employee must NOT have received it
      const empRes = await request(app)
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${employeeToken}`);
      const empInactive = empRes.body.notifications.find(
        (n: { entityId: string }) => n.entityId === deal.id,
      );
      expect(empInactive).toBeUndefined();

      // Re-running scheduler on day 32 must NOT duplicate it
      const day32 = new Date(baseDate.getTime() + 32 * 24 * 60 * 60 * 1000);
      await runDealInactivityCheck(day32);

      const notifsResDay32 = await request(app)
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${adminToken}`);
      const count = notifsResDay32.body.notifications.filter(
        (n: { entityId: string; type: string }) =>
          n.entityId === deal.id && n.type === 'DEAL_INACTIVE_30_DAYS',
      ).length;
      expect(count).toBe(1);

      // Now deal status changes -> timer resets & supersedes old inactivity notification
      const updateRes = await request(app)
        .patch(`/api/v1/deals/${deal.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'RECEIVED' });

      expect(updateRes.status).toBe(200);

      // Check that DEAL_RECEIVED notification was generated
      const afterStatusRes = await request(app)
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${adminToken}`);

      const receivedNotif = afterStatusRes.body.notifications.find(
        (n: { entityId: string; type: string }) =>
          n.entityId === deal.id && n.type === 'DEAL_RECEIVED',
      );
      expect(receivedNotif).toBeDefined();
      expect(receivedNotif.title).toBe('Deal received');
    });
  });

  describe('Activity Notifications (Medicine & MR Lifecycle)', () => {
    it('creates activity notifications for medicine lifecycle', async () => {
      // 1. Create medicine
      const createRes = await request(app)
        .post('/api/v1/medicines')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: `Lifecycle Med ${testSuffix}`,
          manufacturerId: testManufacturerId,
          compositionId: testCompositionId,
          form: 'TABLET',
          packQuantity: 10,
          packUnit: 'TABLET',
          prescriptionRequired: false,
        });

      expect(createRes.status).toBe(201);
      const medId = createRes.body.medicine.id;

      // 2. Update medicine
      const updateRes = await request(app)
        .patch(`/api/v1/medicines/${medId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          shortDescription: 'Updated description for test',
        });

      expect(updateRes.status).toBe(200);

      // 3. Deactivate medicine
      const deleteRes = await request(app)
        .delete(`/api/v1/medicines/${medId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(deleteRes.status).toBe(200);

      // Verify notifications generated
      const notifsRes = await request(app)
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${adminToken}`);

      const medNotifs = notifsRes.body.notifications.filter(
        (n: { entityId: string }) => n.entityId === medId,
      );

      const createdNotif = medNotifs.find((n: { type: string }) => n.type === 'MEDICINE_CREATED');
      const updatedNotif = medNotifs.find((n: { type: string }) => n.type === 'MEDICINE_UPDATED');
      const deletedNotif = medNotifs.find((n: { type: string }) => n.type === 'MEDICINE_DELETED');

      expect(createdNotif).toBeDefined();
      expect(createdNotif.title).toBe('Medicine added');

      expect(updatedNotif).toBeDefined();
      expect(updatedNotif.title).toBe('Medicine updated');

      expect(deletedNotif).toBeDefined();
      expect(deletedNotif.title).toBe('Medicine removed');
    });

    it('creates activity notifications for MR lifecycle', async () => {
      // 1. Create MR
      const createRes = await request(app)
        .post('/api/v1/mrs')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: `Vikram Singh ${testSuffix}`,
          company: `Lupin ${testSuffix}`,
          phone: '+919877766655',
        });

      expect(createRes.status).toBe(201);
      const mrId = createRes.body.mr.id;

      // 2. Update MR
      const updateRes = await request(app)
        .patch(`/api/v1/mrs/${mrId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          notes: 'Top performing representative',
        });

      expect(updateRes.status).toBe(200);

      // 3. Deactivate MR
      const deleteRes = await request(app)
        .delete(`/api/v1/mrs/${mrId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(deleteRes.status).toBe(200);

      // Verify notifications generated
      const notifsRes = await request(app)
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${adminToken}`);

      const mrNotifs = notifsRes.body.notifications.filter(
        (n: { entityId: string }) => n.entityId === mrId,
      );

      const createdNotif = mrNotifs.find((n: { type: string }) => n.type === 'MR_CREATED');
      const updatedNotif = mrNotifs.find((n: { type: string }) => n.type === 'MR_UPDATED');
      const deletedNotif = mrNotifs.find((n: { type: string }) => n.type === 'MR_DELETED');

      expect(createdNotif).toBeDefined();
      expect(createdNotif.title).toBe('Representative added');

      expect(updatedNotif).toBeDefined();
      expect(updatedNotif.title).toBe('Representative updated');

      expect(deletedNotif).toBeDefined();
      expect(deletedNotif.title).toBe('Representative removed');
    });
  });

  describe('Filtering & Pagination', () => {
    it('supports filter by unread, critical, updates and handles pagination', async () => {
      // Test filter=unread
      const unreadRes = await request(app)
        .get('/api/v1/notifications?filter=unread')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(unreadRes.status).toBe(200);
      for (const notif of unreadRes.body.notifications) {
        expect(notif.isRead).toBe(false);
      }

      // Test filter=critical
      const criticalRes = await request(app)
        .get('/api/v1/notifications?filter=critical')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(criticalRes.status).toBe(200);
      for (const notif of criticalRes.body.notifications) {
        expect(notif.priority).toBe('CRITICAL');
      }

      // Test pagination
      const page1Res = await request(app)
        .get('/api/v1/notifications?page=1&limit=2')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(page1Res.status).toBe(200);
      expect(page1Res.body.pagination).toBeDefined();
      expect(page1Res.body.pagination.page).toBe(1);
      expect(page1Res.body.pagination.limit).toBe(2);
      expect(page1Res.body.notifications.length).toBeLessThanOrEqual(2);

      if (page1Res.body.pagination.total > 2) {
        const page2Res = await request(app)
          .get('/api/v1/notifications?page=2&limit=2')
          .set('Authorization', `Bearer ${adminToken}`);

        expect(page2Res.status).toBe(200);
        expect(page2Res.body.pagination.page).toBe(2);

        // Disjoint sets across pages
        const idsPage1 = new Set(page1Res.body.notifications.map((n: { id: string }) => n.id));
        for (const notif of page2Res.body.notifications) {
          expect(idsPage1.has(notif.id)).toBe(false);
        }
      }
    });
  });
});
