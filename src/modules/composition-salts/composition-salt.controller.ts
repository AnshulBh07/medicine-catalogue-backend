import type { RequestHandler } from 'express';
import { AppError } from '../../common/errors/app-error.js';
import { createCompositionSalt, getCompositionSalt, listCompositionSalts, rejectCompositionSaltDeletion, updateCompositionSalt } from './composition-salt.service.js';
import type { ListCompositionSaltsInput, UpdateCompositionSaltInput } from './composition-salt.schemas.js';

const canViewInactive = (request: Parameters<RequestHandler>[0]): boolean =>
  request.auth?.role === 'ADMIN';

export const listCompositionSaltsController: RequestHandler = async (request, response) => {
  const input = request.query as unknown as ListCompositionSaltsInput;
  if (input.includeInactive && !canViewInactive(request)) {
    throw new AppError(403, 'FORBIDDEN', 'You do not have permission to view inactive salts');
  }

  const compositionSalts = await listCompositionSalts(input);
  response.status(200).json({ compositionSalts });
};

export const getCompositionSaltController: RequestHandler = async (request, response) => {
  const compositionSalt = await getCompositionSalt(
    request.params.id as string,
    canViewInactive(request),
  );
  response.status(200).json({ compositionSalt });
};

export const createCompositionSaltController: RequestHandler = async (request, response) => {
  const compositionSalt = await createCompositionSalt(request.body);
  response.status(201).json({ compositionSalt });
};

export const updateCompositionSaltController: RequestHandler = async (request, response) => {
  const compositionSalt = await updateCompositionSalt(
    request.params.id as string,
    request.body as UpdateCompositionSaltInput,
  );
  response.status(200).json({ compositionSalt });
};

export const deleteCompositionSaltController: RequestHandler = () => {
  rejectCompositionSaltDeletion();
};
