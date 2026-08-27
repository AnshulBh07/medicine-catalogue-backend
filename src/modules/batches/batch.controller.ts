import type { RequestHandler } from 'express';
import { AppError } from '../../common/errors/app-error.js';
import { createBatch, getBatch, listBatches, updateBatch } from './batch.service.js';
import type { ListBatchesInput, UpdateBatchInput } from './batch.schemas.js';

const canViewInactive = (request: Parameters<RequestHandler>[0]): boolean =>
  request.auth?.role === 'ADMIN';

export const listBatchesController: RequestHandler = async (request, response) => {
  const input = request.query as unknown as ListBatchesInput;
  if (input.includeInactive && !canViewInactive(request)) {
    throw new AppError(403, 'FORBIDDEN', 'You do not have permission to view inactive medicine batches');
  }
  const batches = await listBatches(input);
  response.status(200).json({ batches });
};

export const getBatchController: RequestHandler = async (request, response) => {
  const batch = await getBatch(request.params.id as string, canViewInactive(request));
  response.status(200).json({ batch });
};

export const createBatchController: RequestHandler = async (request, response) => {
  const batch = await createBatch(request.body);
  response.status(201).json({ batch });
};

export const updateBatchController: RequestHandler = async (request, response) => {
  const batch = await updateBatch(request.params.id as string, request.body as UpdateBatchInput);
  response.status(200).json({ batch });
};
