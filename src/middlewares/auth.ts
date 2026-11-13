import type { RequestHandler, Request } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User } from '../modules/users/user.model.js';
import { ApiError } from '../utils/errors.js';

export const authenticate: RequestHandler = async (req, _res, next) => {
  const match = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization ?? '');
  if (!match?.[1]) throw new ApiError(401, 'Authentication required');
  let subject: string;
  try {
    const payload = jwt.verify(match[1], env.JWT_SECRET, {
      algorithms: ['HS256'], issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE,
    });
    if (typeof payload === 'string' || !payload.sub || !/^[a-f\d]{24}$/i.test(payload.sub) || !payload.exp) throw new Error();
    subject = payload.sub;
  } catch { throw new ApiError(401, 'Invalid or expired token'); }
  const user = await User.findById(subject).select('role').lean();
  if (!user) throw new ApiError(401, 'Account no longer exists');
  req.user = { id: user._id.toString(), role: user.role };
  next();
};
export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (req.user?.role !== 'ADMIN') throw new ApiError(403, 'Admin access required');
  next();
};
export function actor(req: Request) {
  if (!req.user) throw new ApiError(401, 'Authentication required');
  return req.user;
}
