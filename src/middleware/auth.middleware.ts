import type { NextFunction, Request } from 'express';
import { AppError } from '../common/errors/app-error.js';
import { verifyAccessToken } from '../modules/auth/jwt.js';

export type AuthRequest = Pick<Request, 'get'> & {
  auth?: Request['auth'];
};

export const authenticate = async (
  request: AuthRequest,
  _response: unknown,
  next: NextFunction,
): Promise<void> => {
  const authorization = request.get('authorization');

  if (!authorization?.startsWith('Bearer ')) {
    next(new AppError(401, 'UNAUTHENTICATED', 'Authentication is required'));
    return;
  }

  const token = authorization.slice('Bearer '.length).trim();

  if (!token) {
    next(new AppError(401, 'UNAUTHENTICATED', 'Authentication is required'));
    return;
  }

  try {
    request.auth = await verifyAccessToken(token);
    next();
  } catch (error) {
    next(error);
  }
};
