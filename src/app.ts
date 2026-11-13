import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { env } from './config/env.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { userRouter } from './modules/users/user.routes.js';
import { noteRouter } from './modules/notes/note.routes.js';
import { postRouter } from './modules/posts/post.routes.js';
import { listAll } from './modules/notes/note.controller.js';
import { authenticate, requireAdmin } from './middlewares/auth.js';
import { errorHandler } from './middlewares/errors.js';

export const app = express();
app.disable('x-powered-by');
// Trust only the local reverse proxy when explicitly enabled for deployment.
app.set('trust proxy', env.TRUST_PROXY === 'loopback' ? 'loopback' : false);
app.use(helmet(), cors({ origin: env.CORS_ORIGIN }));
app.use(rateLimit({ windowMs: 60000, limit: 200, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { success: false, message: 'Too many requests' } }));
app.use(express.json({ limit: '128kb' }));
app.get('/health', (_req, res) => { res.json({ success: true, data: { status: 'ok' } }); });
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/users', userRouter);
app.use('/api/v1/notes', noteRouter);
app.use('/api/v1/posts', postRouter);
app.get('/api/v1/admin/notes', authenticate, requireAdmin, listAll);
app.use((_req, res) => { res.status(404).json({ success: false, message: 'Route not found' }); });
app.use(errorHandler);
