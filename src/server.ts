import { app } from './app.js';
import { createGracefulShutdown } from './common/shutdown.utils.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import {
  startNotificationScheduler,
  stopNotificationScheduler,
} from './modules/notifications/notification.scheduler.js';

const startServer = async (): Promise<void> => {
  await prisma.$connect();

  startNotificationScheduler();

  const host = env.HOST;
  const server = app.listen(env.PORT, host, () => {
    logger.info(`Medicine Catalogue API started on ${host}:${env.PORT} (${env.NODE_ENV})`);
  });

  const shutdown = createGracefulShutdown({
    server,
    disconnectDb: () => prisma.$disconnect(),
    stopScheduler: stopNotificationScheduler,
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void shutdown(signal)
        .then(() => {
          process.exitCode = 0;
        })
        .catch((error: unknown) => {
          logger.error({ err: error }, 'Failed to shut down cleanly');
          process.exitCode = 1;
        });
    });
  }
};

process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Uncaught exception occurred; terminating process');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Unhandled promise rejection occurred; terminating process');
  process.exit(1);
});

startServer().catch(async (error: unknown) => {
  logger.error({ err: error }, 'Failed to start Medicine Catalogue API');
  await prisma.$disconnect().catch(() => {});
  process.exitCode = 1;
});
