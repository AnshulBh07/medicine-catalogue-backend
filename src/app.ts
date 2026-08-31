import cors from 'cors';
import express from 'express';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { errorMiddleware } from './middleware/error.middleware.js';
import { notFoundMiddleware } from './middleware/not-found.middleware.js';
import { router } from './routes/index.js';

export const app = express();

// Configure Express for running behind Nginx reverse proxy
app.set('trust proxy', 1);
app.disable('x-powered-by');

const getRequestUrl = (request: { originalUrl?: string; url?: string }): string =>
  request.originalUrl ?? request.url ?? '';

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || env.CORS_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  }),
);

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

// Lightweight root health endpoint (liveness probe)
app.get('/health', (_request, response) => {
  response.status(200).json({ status: 'ok' });
});

app.use('/api/v1', router);
app.use(notFoundMiddleware);
app.use(errorMiddleware);
