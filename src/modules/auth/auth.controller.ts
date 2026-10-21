import type { RequestHandler } from 'express';
import { login, refresh } from './auth.service.js';

export const loginController: RequestHandler = async (request, response) => {
  const result = await login(request.body);
  response.status(200).json(result);
};

export const refreshController: RequestHandler = async (request, response) => {
  const result = await refresh(request.body.refreshToken);
  response.status(200).json(result);
};

export const logoutController: RequestHandler = async (_request, response) => {
  response.status(200).json({ success: true, message: 'Logged out successfully' });
};
