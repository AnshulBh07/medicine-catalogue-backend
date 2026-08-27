import type { RequestHandler } from 'express';
import { login } from './auth.service.js';

export const loginController: RequestHandler = async (request, response) => {
  const result = await login(request.body);
  response.status(200).json(result);
};
