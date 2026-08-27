import type { RequestHandler } from 'express';
import { z } from 'zod';

export const validateBody = (schema: z.ZodType): RequestHandler => (request, _response, next) => {
  const result = schema.safeParse(request.body);

  if (!result.success) {
    next(result.error);
    return;
  }

  request.body = result.data;
  next();
};

export const validateParams = (schema: z.ZodType): RequestHandler => (request, _response, next) => {
  const result = schema.safeParse(request.params);

  if (!result.success) {
    next(result.error);
    return;
  }

  Object.assign(request.params, result.data);
  next();
};

export const validateQuery = (schema: z.ZodType): RequestHandler => (request, _response, next) => {
  const result = schema.safeParse(request.query);

  if (!result.success) {
    next(result.error);
    return;
  }

  Object.assign(request.query, result.data);
  next();
};
