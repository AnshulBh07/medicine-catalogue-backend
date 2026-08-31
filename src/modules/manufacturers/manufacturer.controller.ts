import type { RequestHandler } from 'express';
import { AppError } from '../../common/errors/app-error.js';
import {
  createManufacturer,
  deactivateManufacturer,
  deleteManufacturer,
  getManufacturer,
  listManufacturers,
  updateManufacturer,
} from './manufacturer.service.js';
import type { ListManufacturersInput, UpdateManufacturerInput } from './manufacturer.schemas.js';

const canViewInactive = (request: Parameters<RequestHandler>[0]): boolean =>
  request.auth?.role === 'ADMIN';

export const listManufacturersController: RequestHandler = async (request, response) => {
  const input = request.query as unknown as ListManufacturersInput;
  if (input.includeInactive && !canViewInactive(request)) {
    throw new AppError(403, 'FORBIDDEN', 'You do not have permission to view inactive manufacturers');
  }
  const manufacturers = await listManufacturers(input);
  response.status(200).json({ manufacturers });
};

export const getManufacturerController: RequestHandler = async (request, response) => {
  const manufacturer = await getManufacturer(request.params.id as string, canViewInactive(request));
  response.status(200).json({ manufacturer });
};

export const createManufacturerController: RequestHandler = async (request, response) => {
  const manufacturer = await createManufacturer(request.body);
  response.status(201).json({ manufacturer });
};

export const updateManufacturerController: RequestHandler = async (request, response) => {
  const manufacturer = await updateManufacturer(
    request.params.id as string,
    request.body as UpdateManufacturerInput,
  );
  response.status(200).json({ manufacturer });
};

export const deleteManufacturerController: RequestHandler = async (request, response) => {
  const permanent = request.query.permanent === 'true';
  if (permanent) {
    const result = await deleteManufacturer(request.params.id as string);
    response.status(200).json(result);
    return;
  }
  const manufacturer = await deactivateManufacturer(request.params.id as string);
  response.status(200).json({ manufacturer });
};

export const deactivateManufacturerController: RequestHandler = async (request, response, next) => {
  return deleteManufacturerController(request, response, next);
};
