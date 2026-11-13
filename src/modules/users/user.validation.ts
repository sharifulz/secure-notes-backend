import { z } from 'zod';
import { email, password, interests } from '../../utils/validation.js';
const profileSchema = z.object({
  name: z.string().trim().min(1).max(100), email, password,
  interests,
}).strict();
export const registerSchema = profileSchema.extend({ interests: interests.default([]) });
export const createUserSchema = registerSchema.extend({ role: z.enum(['USER', 'ADMIN']).default('USER') });
export const updateUserSchema = profileSchema.extend({ role: z.enum(['USER', 'ADMIN']) }).partial().refine(value => Object.keys(value).length > 0, 'At least one field is required');
export type NewUser = z.infer<typeof createUserSchema>;
export type UserChanges = z.infer<typeof updateUserSchema>;
