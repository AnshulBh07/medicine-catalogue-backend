import { app } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';

const startServer = async (): Promise<void> => {
  await prisma.$connect();

  const host = env.HOST;
  const server = app.listen(env.PORT, host, () => {
    logger.info(`Medicine Catalogue API started on ${host}:${env.PORT} (${env.NODE_ENV})`);
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    logger.info(`Received ${signal}; shutting down gracefully`);

    // Force terminate if cleanup hangs longer than 10 seconds
    const forceExitTimeout = setTimeout(() => {
      logger.error('Graceful shutdown timed out after 10s; forcing exit');
      process.exit(1);
    }, 10000);
    forceExitTimeout.unref();

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    await prisma.$disconnect();
  };

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
