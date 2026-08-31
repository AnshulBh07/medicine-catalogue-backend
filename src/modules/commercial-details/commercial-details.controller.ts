import type { RequestHandler } from 'express';
import { AppError } from '../../common/errors/app-error.js';
import {
  createCommercialDetails,
  createCommercialDetailsForMedicine,
  getCommercialDetails,
  getCommercialDetailsForMedicine,
  updateCommercialDetails,
  updateCommercialDetailsForMedicine,
} from './commercial-details.service.js';
import type { UpdateCommercialDetailsInput } from './commercial-details.schemas.js';

const authenticatedAdminId = (request: Parameters<RequestHandler>[0]): string => {
  if (!request.auth?.userId) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication is required');
  }
  return request.auth.userId;
};

// Medicine-Level (Latest Batch) Controllers
export const getMedicineCommercialDetailsController: RequestHandler = async (request, response) => {
  const details = await getCommercialDetailsForMedicine(request.params.medicineId as string);
  response.status(200).json({ commercialDetails: details });
};

export const createMedicineCommercialDetailsController: RequestHandler = async (request, response) => {
  const details = await createCommercialDetailsForMedicine(
    request.params.medicineId as string,
    request.body,
    authenticatedAdminId(request),
  );
  response.status(201).json({ commercialDetails: details });
};

export const updateMedicineCommercialDetailsController: RequestHandler = async (request, response) => {
  const details = await updateCommercialDetailsForMedicine(
    request.params.medicineId as string,
    request.body as UpdateCommercialDetailsInput,
    authenticatedAdminId(request),
  );
  response.status(200).json({ commercialDetails: details });
};

// Batch-Level Controllers
export const getBatchCommercialDetailsController: RequestHandler = async (request, response) => {
  const details = await getCommercialDetails(request.params.batchId as string);
  response.status(200).json({ commercialDetails: details });
};

export const createBatchCommercialDetailsController: RequestHandler = async (request, response) => {
  const details = await createCommercialDetails(
    request.params.batchId as string,
    request.body,
    authenticatedAdminId(request),
  );
  response.status(201).json({ commercialDetails: details });
};

export const updateBatchCommercialDetailsController: RequestHandler = async (request, response) => {
  const details = await updateCommercialDetails(
    request.params.batchId as string,
    request.body as UpdateCommercialDetailsInput,
    authenticatedAdminId(request),
  );
  response.status(200).json({ commercialDetails: details });
};
