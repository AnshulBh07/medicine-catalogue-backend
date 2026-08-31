import type { RequestHandler } from 'express';
import { AppError } from '../../common/errors/app-error.js';
import { shortageService } from './shortage.service.js';
import type {
  CreateShortageItemInput,
  PatchShortageItemInput,
  ShortageDateQuery,
} from './shortage.schemas.js';

const getAuthUserId = (request: Parameters<RequestHandler>[0]): string => {
  if (!request.auth?.userId) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication is required');
  }
  return request.auth.userId;
};

export const getDailyShortagesController: RequestHandler = async (req, res) => {
  const query = req.query as unknown as ShortageDateQuery;
  const result = await shortageService.getDailyShortages(query);
  res.status(200).json(result);
};

export const getShortageItemByIdController: RequestHandler = async (req, res) => {
  const result = await shortageService.getShortageItemById(req.params.id as string);
  res.status(200).json({ shortageItem: result });
};

export const createShortageItemController: RequestHandler = async (req, res) => {
  const userId = getAuthUserId(req);
  const body = req.body as CreateShortageItemInput;
  const result = await shortageService.createShortageItem(userId, body);
  res.status(201).json({
    message: 'Medicine added to shortage list successfully',
    shortageItem: result,
  });
};

export const patchShortageItemController: RequestHandler = async (req, res) => {
  const body = req.body as PatchShortageItemInput;
  const result = await shortageService.patchShortageItem(req.params.id as string, body);
  res.status(200).json({
    message: 'Shortage item updated successfully',
    shortageItem: result,
  });
};

export const deleteShortageItemController: RequestHandler = async (req, res) => {
  const result = await shortageService.deleteShortageItem(req.params.id as string);
  res.status(200).json(result);
};
