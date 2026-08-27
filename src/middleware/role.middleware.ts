import type { NextFunction, Request } from 'express';
import type { $Enums } from '@prisma/client/index';
import { AppError } from '../common/errors/app-error.js';

export type RoleRequest = {
  auth?: Request['auth'];
};

export const requireRole = (...roles: $Enums.UserRole[]) => (
  request: RoleRequest,
  _response: unknown,
  next: NextFunction,
): void => {
  if (!request.auth) {
    next(new AppError(401, 'UNAUTHENTICATED', 'Authentication is required'));
    return;
  }

  if (!roles.includes(request.auth.role)) {
    next(new AppError(403, 'FORBIDDEN', 'You do not have permission to perform this action'));
    return;
  }

  next();
};
