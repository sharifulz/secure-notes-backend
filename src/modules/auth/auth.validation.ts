import { z } from 'zod';
import { email } from '../../utils/validation.js';
export { registerSchema } from '../users/user.validation.js';
export const loginSchema = z.object({ email, password: z.string().min(1).max(72).refine(value => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be at most 72 UTF-8 bytes') }).strict();
