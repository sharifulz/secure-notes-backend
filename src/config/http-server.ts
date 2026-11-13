import { readFileSync } from 'node:fs';
import { createServer as createHttpServer, type RequestListener } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';

type TlsSettings = { TLS_PFX_PATH?: string; TLS_PFX_PASSWORD?: string };

export function createApplicationServer(listener: RequestListener, settings: TlsSettings) {
  if (!settings.TLS_PFX_PATH) return createHttpServer(listener);

  // Loading failures must stop startup: never silently downgrade HTTPS to HTTP.
  return createHttpsServer({
    pfx: readFileSync(settings.TLS_PFX_PATH),
    passphrase: settings.TLS_PFX_PASSWORD,
    minVersion: 'TLSv1.2',
  }, listener);
}
