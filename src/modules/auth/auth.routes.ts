import { Router } from 'express';
import { validateBody } from '../../middleware/validate.middleware.js';
import { loginController, refreshController, logoutController } from './auth.controller.js';
import { loginSchema, refreshSchema } from './auth.schemas.js';

export const authRouter = Router();

authRouter.post('/login', validateBody(loginSchema), loginController);
authRouter.post('/refresh', validateBody(refreshSchema), refreshController);
authRouter.post('/logout', logoutController);
