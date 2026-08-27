import type { RequestHandler } from 'express';
import { AppError } from '../../common/errors/app-error.js';
import {
  createMedicine,
  deactivateMedicine,
  getMedicine,
  listMedicines,
  updateMedicine,
} from './medicine.service.js';
import type { ListMedicinesInput, UpdateMedicineInput } from './medicine.schemas.js';

const canViewInactive = (request: Parameters<RequestHandler>[0]): boolean =>
  request.auth?.role === 'ADMIN';

export const listMedicinesController: RequestHandler = async (request, response) => {
  const input = request.query as unknown as ListMedicinesInput;
  if (input.includeInactive && !canViewInactive(request)) {
    throw new AppError(403, 'FORBIDDEN', 'You do not have permission to view inactive medicines');
  }
  const medicines = await listMedicines(input);
  response.status(200).json({ medicines });
};

export const getMedicineController: RequestHandler = async (request, response) => {
  const medicine = await getMedicine(request.params.id as string, canViewInactive(request));
  response.status(200).json({ medicine });
};

export const createMedicineController: RequestHandler = async (request, response) => {
  const medicine = await createMedicine(request.body);
  response.status(201).json({ medicine });
};

export const updateMedicineController: RequestHandler = async (request, response) => {
  const medicine = await updateMedicine(
    request.params.id as string,
    request.body as UpdateMedicineInput,
  );
  response.status(200).json({ medicine });
};

export const deactivateMedicineController: RequestHandler = async (request, response) => {
  const medicine = await deactivateMedicine(request.params.id as string);
  response.status(200).json({ medicine });
};
