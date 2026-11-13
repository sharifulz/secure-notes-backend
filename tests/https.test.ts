import { once } from 'node:events';
import { request as requestHttp } from 'node:http';
import { request as requestHttps } from 'node:https';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createApplicationServer } from '../src/config/http-server.js';

const fixture = fileURLToPath(new URL('./fixtures/server.p12', import.meta.url));
const listener: import('node:http').RequestListener = (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ success: true }));
};

describe('HTTP and PKCS#12 HTTPS listeners', () => {
  it('serves a real TLS request using a password-protected PKCS#12 file', async () => {
    const server = createApplicationServer(listener, { TLS_PFX_PATH: fixture, TLS_PFX_PASSWORD: 'fixture-only-password' });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const port = (server.address() as AddressInfo).port;
      const response = await new Promise<{ body: string; encrypted: boolean }>((resolve, reject) => {
        // The fixture is self-signed. This exception is confined to this test client.
        const req = requestHttps({ hostname: '127.0.0.1', port, rejectUnauthorized: false }, res => {
          const encrypted = Boolean((res.socket as import('node:tls').TLSSocket).encrypted);
          let body = '';
          res.on('data', chunk => { body += chunk; });
          res.on('end', () => resolve({ body, encrypted }));
        });
        req.on('error', reject);
        req.end();
      });
      expect(JSON.parse(response.body)).toEqual({ success: true });
      expect(response.encrypted).toBe(true);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });

  it('keeps local HTTP available when TLS is not configured', async () => {
    const server = createApplicationServer(listener, {});
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const port = (server.address() as AddressInfo).port;
      const status = await new Promise<number | undefined>((resolve, reject) => {
        const req = requestHttp({ hostname: '127.0.0.1', port }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
        req.on('error', reject); req.end();
      });
      expect(status).toBe(200);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });

  it('rejects a wrong PFX password rather than falling back to HTTP', () => {
    expect(() => createApplicationServer(listener, { TLS_PFX_PATH: fixture, TLS_PFX_PASSWORD: 'incorrect' })).toThrow();
  });

  it('rejects a missing certificate file rather than falling back to HTTP', () => {
    expect(() => createApplicationServer(listener, { TLS_PFX_PATH: `${fixture}.missing`, TLS_PFX_PASSWORD: 'fixture-only-password' })).toThrow();
  });
});
