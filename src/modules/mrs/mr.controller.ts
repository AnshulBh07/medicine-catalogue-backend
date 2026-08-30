import type { RequestHandler } from 'express';
import { AppError } from '../../common/errors/app-error.js';
import {
  assignMrMedicines,
  createMr,
  deactivateMr,
  getMr,
  getMrMedicines,
  listMrs,
  updateMr,
} from './mr.service.js';
import type { ListMrsInput, UpdateMrInput } from './mr.schemas.js';

const canViewInactive = (request: Parameters<RequestHandler>[0]): boolean =>
  request.auth?.role === 'ADMIN';

export const listMrsController: RequestHandler = async (request, response) => {
  const input = request.query as unknown as ListMrsInput;
  if (input.includeInactive && !canViewInactive(request)) {
    throw new AppError(403, 'FORBIDDEN', 'You do not have permission to view inactive MRs');
  }
  const result = await listMrs(input);
  response.status(200).json(result);
};

export const getMrController: RequestHandler = async (request, response) => {
  const mr = await getMr(request.params.id as string, canViewInactive(request));
  response.status(200).json({ mr });
};

export const createMrController: RequestHandler = async (request, response) => {
  const mr = await createMr(request.body);
  response.status(201).json({ mr });
};

export const updateMrController: RequestHandler = async (request, response) => {
  const mr = await updateMr(request.params.id as string, request.body as UpdateMrInput);
  response.status(200).json({ mr });
};

export const deactivateMrController: RequestHandler = async (request, response) => {
  const mr = await deactivateMr(request.params.id as string);
  response.status(200).json({ mr });
};

export const getMrMedicinesController: RequestHandler = async (request, response) => {
  const result = await getMrMedicines(request.params.id as string, canViewInactive(request));
  response.status(200).json(result);
};

export const assignMrMedicinesController: RequestHandler = async (request, response) => {
  const result = await assignMrMedicines(request.params.id as string, request.body);
  response.status(200).json(result);
};
