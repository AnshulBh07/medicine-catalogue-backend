import type { RequestHandler } from 'express';
import {
  checkPendingDeal,
  createDeal,
  deleteDeal,
  getDeal,
  listDeals,
  updateDeal,
  updateDealStatus,
} from './deal.service.js';
import type {
  CheckPendingDealQuery,
  CreateDealInput,
  ListDealsInput,
  UpdateDealInput,
  UpdateDealStatusInput,
} from './deal.schemas.js';

export const listDealsController: RequestHandler = async (request, response) => {
  const query = request.query as unknown as ListDealsInput;
  const result = await listDeals(query);
  response.status(200).json(result);
};

export const getDealController: RequestHandler = async (request, response) => {
  const deal = await getDeal(request.params.id as string);
  response.status(200).json({ deal });
};

export const checkPendingDealController: RequestHandler = async (request, response) => {
  const { medicineId, mrId } = request.query as unknown as CheckPendingDealQuery;
  const result = await checkPendingDeal(medicineId, mrId);
  response.status(200).json(result);
};

export const createDealController: RequestHandler = async (request, response) => {
  const userId = request.auth?.userId;
  const input = request.body as CreateDealInput;
  const result = await createDeal(input, userId);
  response.status(201).json(result);
};

export const updateDealController: RequestHandler = async (request, response) => {
  const input = request.body as UpdateDealInput;
  const deal = await updateDeal(request.params.id as string, input);
  response.status(200).json({ deal });
};

export const updateDealStatusController: RequestHandler = async (request, response) => {
  const { status } = request.body as UpdateDealStatusInput;
  const deal = await updateDealStatus(request.params.id as string, status);
  response.status(200).json({ deal });
};

export const deleteDealController: RequestHandler = async (request, response) => {
  const result = await deleteDeal(request.params.id as string);
  response.status(200).json(result);
};
