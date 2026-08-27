import express from 'express';
import { pinoHttp } from 'pino-http';
import { logger } from './lib/logger.js';
import { errorMiddleware } from './middleware/error.middleware.js';
import { notFoundMiddleware } from './middleware/not-found.middleware.js';
import { router } from './routes/index.js';

export const app = express();

const getRequestUrl = (request: { originalUrl?: string; url?: string }): string =>
  request.originalUrl ?? request.url ?? '';

app.use(express.json());
app.use(
  pinoHttp({
    logger,
    quietResLogger: true,
    customSuccessObject: (request, response, data) => ({
      method: request.method,
      url: getRequestUrl(request),
      statusCode: response.statusCode,
      responseTime: data.responseTime,
    }),
    customSuccessMessage: (request, response, responseTime) =>
      `${request.method} ${getRequestUrl(request)} ${response.statusCode} ${responseTime}ms`,
    customErrorObject: (request, response, error, data) => ({
      method: request.method,
      url: getRequestUrl(request),
      statusCode: response.statusCode,
      responseTime: data.responseTime,
      error: error.message,
    }),
    customErrorMessage: (request, response, error) =>
      `${request.method} ${getRequestUrl(request)} ${response.statusCode} ${error.message}`,
  }),
);
app.use('/api/v1', router);
app.use(notFoundMiddleware);
app.use(errorMiddleware);
