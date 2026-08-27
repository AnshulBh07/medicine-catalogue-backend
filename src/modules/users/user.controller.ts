import type { RequestHandler } from 'express';
import { createUser } from './user.service.js';

export const createUserController: RequestHandler = async (request, response) => {
  const user = await createUser(request.body);
  response.status(201).json({ user });
};
