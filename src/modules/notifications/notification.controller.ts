import type { RequestHandler } from 'express';
import { AppError } from '../../common/errors/app-error.js';
import {
  listNotificationsQuerySchema,
  notificationIdParamSchema,
} from './notification.schemas.js';
import { NotificationService } from './notification.service.js';

export const listNotificationsController: RequestHandler = async (request, response) => {
  if (!request.auth) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication is required');
  }

  const query = listNotificationsQuerySchema.parse(request.query);
  const result = await NotificationService.getNotifications(
    request.auth.userId,
    request.auth.role,
    query,
  );

  response.status(200).json(result);
};

export const getUnreadCountController: RequestHandler = async (request, response) => {
  if (!request.auth) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication is required');
  }

  const unreadCount = await NotificationService.getUnreadCount(
    request.auth.userId,
    request.auth.role,
  );

  response.status(200).json({ unreadCount });
};

export const markReadController: RequestHandler = async (request, response) => {
  if (!request.auth) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication is required');
  }

  const { id } = notificationIdParamSchema.parse(request.params);
  const notification = await NotificationService.markAsRead(id, request.auth.userId);

  response.status(200).json({ notification });
};

export const markAllReadController: RequestHandler = async (request, response) => {
  if (!request.auth) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication is required');
  }

  const result = await NotificationService.markAllAsRead(
    request.auth.userId,
    request.auth.role,
  );

  response.status(200).json({
    message: 'All notifications marked as read',
    count: result.count,
  });
};
