import type { ErrorRequestHandler } from 'express';
import { Prisma } from '@prisma/client/index';
import { ZodError } from 'zod';
import { AppError } from '../common/errors/app-error.js';
import { logger } from '../lib/logger.js';

export const errorMiddleware: ErrorRequestHandler = (error, _request, response, _next) => {
  void _next;

  if (error instanceof ZodError) {
    response.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: error.issues,
      },
    });
    return;
  }

  if (error instanceof AppError) {
    response.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
    });
    return;
  }

  // Handle oversized request payload from express.json() / body-parser (HTTP 413)
  if (
    typeof error === 'object' &&
    error !== null &&
    ((error as { type?: string }).type === 'entity.too.large' ||
      (error as { status?: number; statusCode?: number }).status === 413 ||
      (error as { status?: number; statusCode?: number }).statusCode === 413)
  ) {
    response.status(413).json({
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request payload is too large',
      },
    });
    return;
  }

  // Handle malformed JSON body from express.json()
  if (
    error instanceof SyntaxError &&
    'status' in error &&
    (error as { status?: number }).status === 400 &&
    'body' in error
  ) {
    response.status(400).json({
      error: {
        code: 'INVALID_JSON',
        message: 'Malformed JSON payload in request body',
      },
    });
    return;
  }

  // Handle expected client-caused Prisma known request errors without leaking DB internals
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      response.status(409).json({
        error: {
          code: 'CONFLICT',
          message: 'A record with the same unique value already exists',
        },
      });
      return;
    }

    if (error.code === 'P2003') {
      response.status(409).json({
        error: {
          code: 'FOREIGN_KEY_CONSTRAINT',
          message: 'Operation violates a related record constraint',
        },
      });
      return;
    }

    if (error.code === 'P2025') {
      response.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Requested record was not found',
        },
      });
      return;
    }

    if (error.code === 'P2023') {
      response.status(400).json({
        error: {
          code: 'INVALID_IDENTIFIER',
          message: 'Invalid identifier format',
        },
      });
      return;
    }
  }

  // Centralized server-side error logging with error details
  logger.error({ err: error }, 'Unhandled request error');

  // Client response contains only safe, generic information
  response.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
    },
  });
};
