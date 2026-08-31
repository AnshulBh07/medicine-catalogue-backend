import type { RequestHandler } from 'express';
import { AppError } from '../../common/errors/app-error.js';
import { createBatch, deleteBatch, getBatch, listBatches, updateBatch } from './batch.service.js';
import type { ListBatchesInput, UpdateBatchInput } from './batch.schemas.js';

const isAdminUser = (request: Parameters<RequestHandler>[0]): boolean =>
  request.auth?.role === 'ADMIN';

export const listBatchesController: RequestHandler = async (request, response) => {
  const input = request.query as unknown as ListBatchesInput;
  const isAdmin = isAdminUser(request);
  if (input.includeInactive && !isAdmin) {
    throw new AppError(403, 'FORBIDDEN', 'You do not have permission to view inactive medicine batches');
  }
  const batches = await listBatches(input, isAdmin);
  response.status(200).json({ batches });
};

export const getBatchController: RequestHandler = async (request, response) => {
  const isAdmin = isAdminUser(request);
  const batch = await getBatch(request.params.id as string, isAdmin, isAdmin);
  response.status(200).json({ batch });
};

export const createBatchController: RequestHandler = async (request, response) => {
  const isAdmin = isAdminUser(request);
  const batch = await createBatch(
    request.body,
    request.auth?.userId,
    isAdmin,
  );
  response.status(201).json({ batch });
};

export const updateBatchController: RequestHandler = async (request, response) => {
  const isAdmin = isAdminUser(request);
  const batch = await updateBatch(
    request.params.id as string,
    request.body as UpdateBatchInput,
    request.auth?.userId,
    isAdmin,
  );
  response.status(200).json({ batch });
};

export const deleteBatchController: RequestHandler = async (request, response) => {
  const isAdmin = isAdminUser(request);
  const batch = await deleteBatch(request.params.id as string, isAdmin);
  response.status(200).json({ batch });
};
