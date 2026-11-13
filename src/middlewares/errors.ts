import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { ApiError } from '../utils/errors.js';
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(400).json({ success: false, message: 'Validation failed', errors: error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) }); return;
  }
  if (error instanceof ApiError) { res.status(error.status).json({ success: false, message: error.message }); return; }
  if (error?.code === 11000) { res.status(409).json({ success: false, message: 'Email is already registered' }); return; }
  if (error?.type === 'entity.too.large') { res.status(413).json({ success: false, message: 'Request body too large' }); return; }
  if (error instanceof SyntaxError && 'body' in error) { res.status(400).json({ success: false, message: 'Invalid JSON' }); return; }
  if (error?.name === 'ValidationError' || error?.name === 'CastError') { res.status(400).json({ success: false, message: 'Invalid input' }); return; }
  if (error?.code === 20) { res.status(503).json({ success: false, message: 'This operation requires a MongoDB replica set' }); return; }
  console.error('Request failed:', error?.name ?? 'UnknownError', error?.code ?? '');
  res.status(500).json({ success: false, message: 'Internal server error' });
};
