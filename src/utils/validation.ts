import { z } from 'zod';
export const objectId = z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid ObjectId');
export const password = z.string().min(12).max(72).refine(
  value => Buffer.byteLength(value, 'utf8') <= 72, 'Password length must be less than or equal to 72 bytes. Please try with a different password.',
);
export const email = z.email().trim().toLowerCase();
export const interests = z.array(z.string().trim().min(1).max(50).toLowerCase())
  .max(30).transform(values => [...new Set(values)]);
