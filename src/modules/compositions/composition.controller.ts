import type { RequestHandler } from 'express';
import { AppError } from '../../common/errors/app-error.js';
import {
  createComposition,
  deactivateComposition,
  getComposition,
  listCompositions,
  updateComposition,
} from './composition.service.js';
import type { ListCompositionsInput, UpdateCompositionInput } from './composition.schemas.js';

const canViewInactive = (request: Parameters<RequestHandler>[0]): boolean =>
  request.auth?.role === 'ADMIN';

export const listCompositionsController: RequestHandler = async (request, response) => {
  const input = request.query as unknown as ListCompositionsInput;
  if (input.includeInactive && !canViewInactive(request)) {
    throw new AppError(403, 'FORBIDDEN', 'You do not have permission to view inactive compositions');
  }
  const compositions = await listCompositions(input);
  response.status(200).json({ compositions });
};

export const getCompositionController: RequestHandler = async (request, response) => {
  const composition = await getComposition(request.params.id as string, canViewInactive(request));
  response.status(200).json({ composition });
};

export const createCompositionController: RequestHandler = async (request, response) => {
  const composition = await createComposition(request.body);
  response.status(201).json({ composition });
};

export const updateCompositionController: RequestHandler = async (request, response) => {
  const composition = await updateComposition(
    request.params.id as string,
    request.body as UpdateCompositionInput,
  );
  response.status(200).json({ composition });
};

export const deactivateCompositionController: RequestHandler = async (request, response) => {
  const composition = await deactivateComposition(request.params.id as string);
  response.status(200).json({ composition });
};
