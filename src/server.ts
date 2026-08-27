import { app } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';

const startServer = async (): Promise<void> => {
  await prisma.$connect();

  const server = app.listen(env.PORT, () => {
    logger.info(`Medicine Catalogue API started on port ${env.PORT}`);
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    logger.info(`Received ${signal}; shutting down`);

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

startServer().catch(async (error: unknown) => {
  logger.error({ err: error }, 'Failed to start Medicine Catalogue API');
  await prisma.$disconnect();
  process.exitCode = 1;
});
