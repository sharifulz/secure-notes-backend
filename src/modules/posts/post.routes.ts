import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.js';
import { validateBody } from '../../middlewares/validate.js';
import { createPostSchema } from './post.validation.js';
import { create } from './post.controller.js';
export const postRouter = Router();
postRouter.post('/', authenticate, validateBody(createPostSchema), create);
