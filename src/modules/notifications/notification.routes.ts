import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware.js';
import {
  getUnreadCountController,
  listNotificationsController,
  markAllReadController,
  markReadController,
} from './notification.controller.js';

export const notificationsRouter = Router();

notificationsRouter.use(authenticate);

notificationsRouter.get('/unread-count', getUnreadCountController);
notificationsRouter.post('/mark-all-read', markAllReadController);
notificationsRouter.patch('/:id/read', markReadController);
notificationsRouter.get('/', listNotificationsController);
