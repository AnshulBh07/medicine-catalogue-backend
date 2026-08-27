import { Router } from 'express';
import { validateBody } from '../../middleware/validate.middleware.js';
import { loginController } from './auth.controller.js';
import { loginSchema } from './auth.schemas.js';

export const authRouter = Router();

authRouter.post('/login', validateBody(loginSchema), loginController);
