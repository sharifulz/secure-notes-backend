import mongoose from 'mongoose';
import { app } from './app.js';
import { env } from './config/env.js';
import { connectDatabase } from './config/database.js';
import { createApplicationServer } from './config/http-server.js';

try {
  const server = createApplicationServer(app, env);
  await connectDatabase();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(env.PORT, env.API_HOST, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  console.log(`Secure Notes API listening on ${env.TLS_PFX_PATH ? 'HTTPS' : 'HTTP'} port ${env.PORT}`);
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    const timeout = setTimeout(() => process.exit(1), 10000).unref();
    server.close(() => { void mongoose.disconnect().then(() => { clearTimeout(timeout); process.exit(0); }); });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch (error) {
  console.error('Startup failed. Check environment variables, MongoDB connectivity, TLS certificate settings, and port availability.');
  // Report diagnostic codes without logging the URI or credentials.
  if (error instanceof Error) {
    console.error('Error type:', error.name);
    const details = error as Error & { code?: string | number; reason?: { type?: string; servers?: Map<string, { error?: { code?: string | number; cause?: { code?: string } } }> } };
    if (details.code) console.error('Error code:', details.code);
    if (details.reason?.type) console.error('MongoDB topology:', details.reason.type);
    const codes = new Set<string | number>();
    for (const server of details.reason?.servers?.values() ?? []) {
      if (server.error?.code) codes.add(server.error.code);
      if (server.error?.cause?.code) codes.add(server.error.cause.code);
    }
    if (codes.size) console.error('Connection error codes:', [...codes].join(', '));
  }
  await mongoose.disconnect();
  process.exitCode = 1;
}
