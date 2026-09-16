import {
  type Notification,
  type NotificationPriority,
  type NotificationType,
  Prisma,
  type UserRole,
} from '@prisma/client';
import { AppError } from '../../common/errors/app-error.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import type { ListNotificationsQueryInput } from './notification.schemas.js';

export const DEAL_NOTIFICATION_TYPES: NotificationType[] = [
  'DEAL_CREATED',
  'DEAL_STATUS_CHANGED',
  'DEAL_RECEIVED',
  'DEAL_INACTIVE_30_DAYS',
];

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  message: string;
  entityType: string;
  entityId?: string | null;
  dedupeKey?: string | null;
  metadata?: Prisma.InputJsonValue | null;
}

export interface PublicNotification {
  id: string;
  userId: string;
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  message: string;
  entityType: string;
  entityId: string | null;
  isRead: boolean;
  readAt: string | null;
  isResolved: boolean;
  resolvedAt: string | null;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
}

const toPublicNotification = (notif: Notification): PublicNotification => ({
  id: notif.id,
  userId: notif.userId,
  type: notif.type,
  priority: notif.priority,
  title: notif.title,
  message: notif.message,
  entityType: notif.entityType,
  entityId: notif.entityId,
  isRead: notif.isRead,
  readAt: notif.readAt ? notif.readAt.toISOString() : null,
  isResolved: notif.isResolved,
  resolvedAt: notif.resolvedAt ? notif.resolvedAt.toISOString() : null,
  metadata: notif.metadata,
  createdAt: notif.createdAt.toISOString(),
  updatedAt: notif.updatedAt.toISOString(),
});

export const formatNotificationDate = (date: Date): string => {
  const day = date.getDate().toString().padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
};

export class NotificationService {
  /**
   * Create a single notification for a specific user.
   * If dedupeKey is provided, guarantees idempotency at the database level.
   */
  static async createNotification(
    input: CreateNotificationInput,
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<PublicNotification | null> {
    try {
      if (input.dedupeKey) {
        const existing = await db.notification.findUnique({
          where: {
            userId_dedupeKey: {
              userId: input.userId,
              dedupeKey: input.dedupeKey,
            },
          },
        });
        if (existing) {
          return toPublicNotification(existing);
        }
      }

      const notif = await db.notification.create({
        data: {
          userId: input.userId,
          type: input.type,
          priority: input.priority,
          title: input.title,
          message: input.message,
          entityType: input.entityType,
          entityId: input.entityId ?? null,
          dedupeKey: input.dedupeKey ?? null,
          metadata:
            input.metadata === undefined || input.metadata === null
              ? Prisma.DbNull
              : input.metadata,
          isRead: false,
          readAt: null,
          isResolved: false,
          resolvedAt: null,
        },
      });

      return toPublicNotification(notif);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Unique constraint violation on [userId, dedupeKey] - return existing safely
        if (input.dedupeKey) {
          const existing = await db.notification.findUnique({
            where: {
              userId_dedupeKey: {
                userId: input.userId,
                dedupeKey: input.dedupeKey,
              },
            },
          });
          if (existing) {
            return toPublicNotification(existing);
          }
        }
      }
      logger.error({ err: error, input }, 'Failed to create notification');
      throw error;
    }
  }

  /**
   * Create notifications for an explicit list of user IDs.
   */
  static async createForUsers(
    userIds: string[],
    data: Omit<CreateNotificationInput, 'userId'>,
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<PublicNotification[]> {
    if (userIds.length === 0) return [];

    const results: PublicNotification[] = [];
    for (const userId of userIds) {
      const created = await this.createNotification({ ...data, userId }, db);
      if (created) {
        results.push(created);
      }
    }
    return results;
  }

  /**
   * Create notifications for active users of a given role (or all roles).
   * Deal notifications are strictly ADMIN-only.
   */
  static async createForRole(
    targetRole: UserRole | 'ALL',
    data: Omit<CreateNotificationInput, 'userId'>,
    options?: {
      excludeUserId?: string;
      db?: Prisma.TransactionClient | typeof prisma;
    },
  ): Promise<PublicNotification[]> {
    const db = options?.db ?? prisma;

    // Strict security rule: If this is a deal notification, never target non-admins
    const isDealNotif = DEAL_NOTIFICATION_TYPES.includes(data.type);
    const effectiveRole = isDealNotif ? 'ADMIN' : targetRole;

    const users = await db.user.findMany({
      where: {
        active: true,
        ...(effectiveRole !== 'ALL' ? { role: effectiveRole } : {}),
        ...(options?.excludeUserId ? { id: { not: options.excludeUserId } } : {}),
      },
      select: { id: true },
    });

    return this.createForUsers(
      users.map((u) => u.id),
      data,
      db,
    );
  }

  /**
   * List paginated notifications for the authenticated user with role-based visibility.
   */
  static async getNotifications(
    userId: string,
    userRole: UserRole,
    query: ListNotificationsQueryInput,
    db: typeof prisma = prisma,
  ): Promise<{
    notifications: PublicNotification[];
    pagination: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
      hasMore: boolean;
    };
    unreadCount: number;
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const baseWhere: Prisma.NotificationWhereInput = {
      userId,
      ...(userRole !== 'ADMIN' ? { type: { notIn: DEAL_NOTIFICATION_TYPES } } : {}),
    };

    const filterWhere: Prisma.NotificationWhereInput = { ...baseWhere };

    if (query.filter === 'unread') {
      filterWhere.isRead = false;
    } else if (query.filter === 'critical') {
      filterWhere.priority = 'CRITICAL';
    } else if (query.filter === 'updates') {
      filterWhere.priority = { in: ['UPDATE', 'ATTENTION'] };
    }

    const [notifications, totalMatching, unreadCount] = await Promise.all([
      db.notification.findMany({
        where: filterWhere,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      db.notification.count({ where: filterWhere }),
      db.notification.count({
        where: {
          ...baseWhere,
          isRead: false,
        },
      }),
    ]);

    const totalPages = Math.ceil(totalMatching / limit) || 1;

    return {
      notifications: notifications.map(toPublicNotification),
      pagination: {
        total: totalMatching,
        page,
        limit,
        totalPages,
        hasMore: page < totalPages,
      },
      unreadCount,
    };
  }

  /**
   * Get unread notification count for the authenticated user, respecting role restrictions.
   */
  static async getUnreadCount(
    userId: string,
    userRole: UserRole,
    db: typeof prisma = prisma,
  ): Promise<number> {
    return db.notification.count({
      where: {
        userId,
        isRead: false,
        ...(userRole !== 'ADMIN' ? { type: { notIn: DEAL_NOTIFICATION_TYPES } } : {}),
      },
    });
  }

  /**
   * Mark a single notification as read.
   * Enforces that the notification belongs to the authenticated user.
   */
  static async markAsRead(
    notificationId: string,
    userId: string,
    db: typeof prisma = prisma,
  ): Promise<PublicNotification> {
    const existing = await db.notification.findUnique({
      where: { id: notificationId },
    });

    if (!existing || existing.userId !== userId) {
      throw new AppError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found');
    }

    if (existing.isRead) {
      return toPublicNotification(existing);
    }

    const updated = await db.notification.update({
      where: { id: notificationId },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    return toPublicNotification(updated);
  }

  /**
   * Mark all unread notifications for the authenticated user as read.
   */
  static async markAllAsRead(
    userId: string,
    userRole: UserRole,
    db: typeof prisma = prisma,
  ): Promise<{ count: number }> {
    const now = new Date();
    const result = await db.notification.updateMany({
      where: {
        userId,
        isRead: false,
        ...(userRole !== 'ADMIN' ? { type: { notIn: DEAL_NOTIFICATION_TYPES } } : {}),
      },
      data: {
        isRead: true,
        readAt: now,
      },
    });

    return { count: result.count };
  }

  /**
   * Resolve / supersede prior notifications for an entity.
   */
  static async resolveOrSupersede(
    entityType: string,
    entityId: string,
    types?: NotificationType[],
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<number> {
    const now = new Date();
    const result = await db.notification.updateMany({
      where: {
        entityType,
        entityId,
        ...(types && types.length > 0 ? { type: { in: types } } : {}),
        isResolved: false,
      },
      data: {
        isResolved: true,
        resolvedAt: now,
        isRead: true,
        readAt: now,
      },
    });

    return result.count;
  }

  /**
   * Scheduled/Condition Check: Medicine Batch Expiry (CRITICAL).
   * - Batch expired: batch.expiryDate <= currentDate
   * - Batch expiring soon: currentDate < batch.expiryDate <= 2 calendar months ahead
   * Deduplicated deterministically.
   */
  static async checkExpiryConditions(
    currentDate: Date = new Date(),
    db: typeof prisma = prisma,
  ): Promise<{ expiredCount: number; expiringSoonCount: number }> {
    // 2 calendar months comparison
    const twoMonthsAhead = new Date(currentDate.getTime());
    twoMonthsAhead.setMonth(twoMonthsAhead.getMonth() + 2);

    // Fetch batches with active medicines
    const batches = await db.batch.findMany({
      where: {
        medicine: { active: true },
      },
      include: {
        medicine: { select: { id: true, name: true } },
      },
    });

    let expiredCount = 0;
    let expiringSoonCount = 0;

    for (const batch of batches) {
      const expiryDate = new Date(batch.expiryDate);

      if (expiryDate <= currentDate) {
        // MEDICINE_EXPIRED
        const formattedDate = formatNotificationDate(expiryDate);
        const title = 'Medicine expired';
        const message = `${batch.medicine.name} (Batch #${batch.batchNumber})\nexpired on ${formattedDate}.`;
        const dedupeKey = `MEDICINE_EXPIRED:${batch.id}`;

        // Supersede earlier expiring soon notifications for this batch
        await db.notification.updateMany({
          where: {
            entityType: 'MEDICINE_BATCH',
            entityId: batch.id,
            type: 'MEDICINE_EXPIRING_SOON',
            isResolved: false,
          },
          data: {
            isResolved: true,
            resolvedAt: currentDate,
            isRead: true,
            readAt: currentDate,
          },
        });

        const created = await this.createForRole(
          'ALL',
          {
            type: 'MEDICINE_EXPIRED',
            priority: 'CRITICAL',
            title,
            message,
            entityType: 'MEDICINE_BATCH',
            entityId: batch.id,
            dedupeKey,
            metadata: {
              medicineId: batch.medicine.id,
              medicineName: batch.medicine.name,
              batchId: batch.id,
              batchNumber: batch.batchNumber,
              expiryDate: expiryDate.toISOString(),
            },
          },
          { db },
        );

        if (created.length > 0) expiredCount++;
      } else if (expiryDate <= twoMonthsAhead) {
        // MEDICINE_EXPIRING_SOON (within 2 calendar months)
        const diffMs = expiryDate.getTime() - currentDate.getTime();
        const daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
        const formattedDate = formatNotificationDate(expiryDate);
        const title = 'Medicine expiring soon';
        const message = `${batch.medicine.name} (Batch #${batch.batchNumber}) expires\non ${formattedDate} (in ${daysRemaining} days).`;
        const dedupeKey = `MEDICINE_EXPIRING_SOON:${batch.id}`;

        const created = await this.createForRole(
          'ALL',
          {
            type: 'MEDICINE_EXPIRING_SOON',
            priority: 'CRITICAL',
            title,
            message,
            entityType: 'MEDICINE_BATCH',
            entityId: batch.id,
            dedupeKey,
            metadata: {
              medicineId: batch.medicine.id,
              medicineName: batch.medicine.name,
              batchId: batch.id,
              batchNumber: batch.batchNumber,
              expiryDate: expiryDate.toISOString(),
              daysRemaining,
            },
          },
          { db },
        );

        if (created.length > 0) expiringSoonCount++;
      }
    }

    return { expiredCount, expiringSoonCount };
  }

  /**
   * Scheduled/Condition Check: Deal Inactivity (ATTENTION, ADMIN ONLY).
   * Finds deals where current date >= statusUpdatedAt + 30 days.
   * Deterministically deduplicated by dealId + statusUpdatedAt.
   */
  static async checkDealInactivity(
    currentDate: Date = new Date(),
    db: typeof prisma = prisma,
  ): Promise<{ inactiveDealsCount: number }> {
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const thresholdDate = new Date(currentDate.getTime() - thirtyDaysMs);

    const inactiveDeals = await db.deal.findMany({
      where: {
        statusUpdatedAt: { lte: thresholdDate },
      },
      include: {
        medicine: { select: { id: true, name: true } },
        mr: { select: { id: true, name: true, company: true } },
      },
    });

    let inactiveDealsCount = 0;

    for (const deal of inactiveDeals) {
      const title = 'Deal needs attention';
      const message = `${deal.medicine.name} deal has had no\nstatus change for 30 days.`;
      const dedupeKey = `DEAL_INACTIVE_30_DAYS:${deal.id}:${deal.statusUpdatedAt.getTime()}`;

      const created = await this.createForRole(
        'ADMIN',
        {
          type: 'DEAL_INACTIVE_30_DAYS',
          priority: 'ATTENTION',
          title,
          message,
          entityType: 'MEDICINE_DEAL',
          entityId: deal.id,
          dedupeKey,
          metadata: {
            dealId: deal.id,
            medicineId: deal.medicineId,
            medicineName: deal.medicine.name,
            mrId: deal.mrId,
            mrName: deal.mr.name,
            status: deal.status,
            statusUpdatedAt: deal.statusUpdatedAt.toISOString(),
          },
        },
        { db },
      );

      if (created.length > 0) inactiveDealsCount++;
    }

    return { inactiveDealsCount };
  }
}
