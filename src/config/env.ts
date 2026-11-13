import 'dotenv/config';
import { z } from 'zod';

export const env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_HOST: z.string().min(1).default('0.0.0.0'),
  TRUST_PROXY: z.enum(['off', 'loopback']).default('off'),
  MONGODB_URI: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('secure-notes-api'),
  JWT_AUDIENCE: z.string().default('secure-notes-client'),
  CORS_ORIGIN: z.url().default('http://localhost:5173'),
  TLS_PFX_PATH: z.string().min(1).optional(),
  TLS_PFX_PASSWORD: z.string().min(1).optional(),
}).superRefine((value, context) => {
  if (Boolean(value.TLS_PFX_PATH) !== Boolean(value.TLS_PFX_PASSWORD)) {
    context.addIssue({ code: 'custom', path: ['TLS_PFX_PATH'], message: 'Set both TLS_PFX_PATH and TLS_PFX_PASSWORD to enable HTTPS, or omit both for HTTP' });
  }
}).parse(process.env);
