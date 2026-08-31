import pino from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'headers.authorization',
      'headers.cookie',
      'authorization',
      'password',
      'passwordHash',
      'token',
      'jwt',
      'secret',
      'DATABASE_URL',
      'R2_SECRET_ACCESS_KEY',
      'R2_ACCESS_KEY_ID',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.jwt',
      '*.secret',
      '*.authorization',
    ],
    censor: '[REDACTED]',
  },
});
