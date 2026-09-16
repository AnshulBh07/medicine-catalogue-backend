import { logger } from '../../lib/logger.js';
import { NotificationService } from './notification.service.js';

let schedulerTimer: NodeJS.Timeout | null = null;

export const runExpiryCheck = async (
  now: Date = new Date(),
): Promise<{ expiredCount: number; expiringSoonCount: number }> => {
  try {
    const result = await NotificationService.checkExpiryConditions(now);
    logger.info(
      { expired: result.expiredCount, expiringSoon: result.expiringSoonCount },
      'Batch expiry notification check completed',
    );
    return result;
  } catch (error) {
    logger.error({ err: error }, 'Batch expiry check failed');
    return { expiredCount: 0, expiringSoonCount: 0 };
  }
};

export const runDealInactivityCheck = async (
  now: Date = new Date(),
): Promise<{ inactiveDealsCount: number }> => {
  try {
    const result = await NotificationService.checkDealInactivity(now);
    logger.info(
      { inactiveDeals: result.inactiveDealsCount },
      'Deal inactivity check completed',
    );
    return result;
  } catch (error) {
    logger.error({ err: error }, 'Deal inactivity check failed');
    return { inactiveDealsCount: 0 };
  }
};

export const runAllNotificationChecks = async (now: Date = new Date()): Promise<void> => {
  await Promise.allSettled([runExpiryCheck(now), runDealInactivityCheck(now)]);
};

export const startNotificationScheduler = (
  intervalMs: number = 60 * 60 * 1000, // default 1 hour
): void => {
  if (schedulerTimer) return;

  // Run immediately on boot
  void runAllNotificationChecks();

  schedulerTimer = setInterval(() => {
    void runAllNotificationChecks();
  }, intervalMs);

  // Unref timer so it does not keep node process alive on shutdown
  if (schedulerTimer.unref) {
    schedulerTimer.unref();
  }

  logger.info('Notification scheduler started');
};

export const stopNotificationScheduler = (): void => {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
    logger.info('Notification scheduler stopped');
  }
};
