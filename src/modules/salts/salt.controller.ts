import type { RequestHandler } from 'express';
import { AppError } from '../../common/errors/app-error.js';
import {
  createSalt,
  deactivateSalt,
  deleteSalt,
  getSalt,
  getSaltImpact,
  listSalts,
  updateSalt,
} from './salt.service.js';
import type { ListSaltsInput, UpdateSaltInput } from './salt.schemas.js';

const canViewInactive = (request: Parameters<RequestHandler>[0]): boolean =>
  request.auth?.role === 'ADMIN';

export const listSaltsController: RequestHandler = async (request, response) => {
  const query = request.query as unknown as ListSaltsInput;
  const activeParam = query.active || 'active';
  if (activeParam !== 'active' && !canViewInactive(request)) {
    throw new AppError(403, 'FORBIDDEN', 'You do not have permission to view inactive salts');
  }

  const salts = await listSalts({ ...query, active: activeParam });
  response.status(200).json({ salts });
};

export const getSaltController: RequestHandler = async (request, response) => {
  const salt = await getSalt(request.params.id as string, canViewInactive(request));
  response.status(200).json({ salt });
};

export const getSaltImpactController: RequestHandler = async (request, response) => {
  const impact = await getSaltImpact(request.params.id as string);
  response.status(200).json({ impact });
};

export const createSaltController: RequestHandler = async (request, response) => {
  const salt = await createSalt(request.body);
  response.status(201).json({ salt });
};

export const updateSaltController: RequestHandler = async (request, response) => {
  const salt = await updateSalt(request.params.id as string, request.body as UpdateSaltInput);
  response.status(200).json({ salt });
};

export const deactivateSaltController: RequestHandler = async (request, response) => {
  const salt = await deactivateSalt(request.params.id as string);
  response.status(200).json({ salt });
};

export const deleteSaltController: RequestHandler = async (request, response) => {
  const result = await deleteSalt(request.params.id as string);
  response.status(200).json(result);
};
