import type { Server } from 'node:http';
import { logger } from '../lib/logger.js';

export interface GracefulShutdownDeps {
  server: Pick<Server, 'close'> & {
    closeIdleConnections?: () => void;
    closeAllConnections?: () => void;
  };
  disconnectDb: () => Promise<void>;
  stopScheduler: () => void;
  gracePeriodMs?: number;
  forceExitMs?: number;
  onForceExit?: () => void;
}

export const createGracefulShutdown = ({
  server,
  disconnectDb,
  stopScheduler,
  gracePeriodMs = 5000,
  forceExitMs = 10000,
  onForceExit = () => process.exit(1),
}: GracefulShutdownDeps): ((signal: string) => Promise<void>) => {
  let shuttingDown = false;

  return async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    logger.info(`Received ${signal}; shutting down gracefully`);
    stopScheduler();

    const forceExitTimeout = setTimeout(() => {
      logger.error(`Graceful shutdown timed out after ${forceExitMs}ms; forcing exit`);
      onForceExit();
    }, forceExitMs);
    forceExitTimeout.unref();

    // Allow active requests a bounded grace period before closing lingering keep-alive sockets
    const closeAllTimer = setTimeout(() => {
      logger.warn(`Closing lingering keep-alive connections after ${gracePeriodMs}ms grace period`);
      server.closeAllConnections?.();
    }, gracePeriodMs);
    closeAllTimer.unref();

    let closeError: unknown = null;
    try {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
        server.closeIdleConnections?.();
      });
    } catch (error) {
      closeError = error;
    } finally {
      clearTimeout(closeAllTimer);
      try {
        await disconnectDb();
      } finally {
        clearTimeout(forceExitTimeout);
      }
    }

    if (closeError) {
      throw closeError;
    }
  };
};
