import { Router } from 'express';
import { authenticate, requireAdmin } from '../../middlewares/auth.js';
import { validateBody } from '../../middlewares/validate.js';
import { createUserSchema, updateUserSchema } from './user.validation.js';
import { byUser } from '../posts/post.controller.js';
import * as controller from './user.controller.js';
export const userRouter = Router();
// Public posts remain readable without exposing private user management endpoints.
userRouter.get('/:id/posts', byUser);
userRouter.use(authenticate, requireAdmin);
userRouter.get('/group-by-interests', controller.groups);
userRouter.get('/', controller.list);
userRouter.post('/', validateBody(createUserSchema), controller.create);
userRouter.get('/:id', controller.get);
userRouter.patch('/:id', validateBody(updateUserSchema), controller.update);
userRouter.delete('/:id', controller.remove);
