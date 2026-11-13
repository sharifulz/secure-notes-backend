import { z } from 'zod';
export const createNoteSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().min(1).max(50000),
}).strict();
export const updateNoteSchema = createNoteSchema.partial().refine(value => Object.keys(value).length > 0, 'At least one field is required');
