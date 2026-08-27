import type { RequestHandler } from 'express';
import { AppError } from '../../common/errors/app-error.js';
import {
  createCommercialDetails,
  getCommercialDetails,
  updateCommercialDetails,
} from './commercial-details.service.js';
import type { UpdateCommercialDetailsInput } from './commercial-details.schemas.js';

const authenticatedAdminId = (request: Parameters<RequestHandler>[0]): string => {
  if (!request.auth?.userId) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication is required');
  }
  return request.auth.userId;
};

export const getCommercialDetailsController: RequestHandler = async (request, response) => {
  const details = await getCommercialDetails(request.params.medicineId as string);
  response.status(200).json({ commercialDetails: details });
};

export const createCommercialDetailsController: RequestHandler = async (request, response) => {
  const details = await createCommercialDetails(
    request.params.medicineId as string,
    request.body,
    authenticatedAdminId(request),
  );
  response.status(201).json({ commercialDetails: details });
};

export const updateCommercialDetailsController: RequestHandler = async (request, response) => {
  const details = await updateCommercialDetails(
    request.params.medicineId as string,
    request.body as UpdateCommercialDetailsInput,
    authenticatedAdminId(request),
  );
  response.status(200).json({ commercialDetails: details });
};
