import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { authenticate } from '../../middlewares/auth.js';
import { validateBody } from '../../middlewares/validate.js';
import { loginSchema, registerSchema } from './auth.validation.js';
import * as controller from './auth.controller.js';
export const authRouter = Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { success: false, message: 'Too many authentication attempts; try again later' } });
authRouter.post('/register', limiter, validateBody(registerSchema), controller.register);
authRouter.post('/login', limiter, validateBody(loginSchema), controller.login);
authRouter.get('/me', authenticate, controller.me);
