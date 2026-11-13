import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { openApiDocument } from '../src/docs/openapi.js';

let app: Express;
beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.MONGODB_URI = 'mongodb://127.0.0.1:1/swagger_docs_do_not_connect';
  process.env.JWT_SECRET = 'swagger-tests-secret-at-least-32-characters';
  ({ app } = await import('../src/app.js'));
});

describe('public Swagger documentation', () => {
  it('serves the UI and its assets without a JWT or database connection', async () => {
    const page = await request(app).get('/api-docs/').expect(200);
    expect(page.text).toContain('Secure Notes · API Documentation');
    expect(page.text).toContain('./swagger-ui-bundle.js');
    expect(page.text).not.toMatch(/<script[^>]+src="https?:/);
    expect(page.headers['content-security-policy']).not.toContain('upgrade-insecure-requests');
    expect(page.headers['content-security-policy']).toContain("script-src 'self'");
    await request(app).get('/api-docs/swagger-ui.css').expect(200);
    // The versioned alias must work through the already-deployed /api/ proxy.
    await request(app).get('/api/v1/docs/').expect(200);
    await request(app).get('/api/v1/docs/swagger-ui.css').expect(200);
    await request(app).get('/api/v1/docs/openapi.json').expect(200);
    const init = await request(app).get('/api-docs/swagger-ui-init.js').expect(200);
    expect(init.text).toContain('persistAuthorization');
    expect(init.text).toContain('validatorUrl');
    // Making docs public must not make business endpoints public.
    await request(app).get('/api/v1/notes').expect(401);
  });

  it('redirects the slashless docs URL so relative asset paths resolve', async () => {
    const result = await request(app).get('/api-docs');
    expect([301, 302]).toContain(result.status);
    expect(result.headers.location).toBe('/api-docs/');
    const alias = await request(app).get('/api/v1/docs');
    expect([301, 302]).toContain(alias.status);
    expect(alias.headers.location).toBe('/api/v1/docs/');
  });

  it('publishes a same-origin OpenAPI document covering all 18 application operations', async () => {
    const result = await request(app).get('/api-docs/openapi.json').expect(200);
    const spec = result.body;
    expect(spec.openapi).toBe('3.0.3');
    expect(spec.servers[0].url).toBe('/api/v1');
    expect(spec.security).toEqual([{ bearerAuth: [] }]);
    const operations = Object.entries(spec.paths).flatMap(([path, methods]) =>
      Object.entries(methods as Record<string, { operationId: string }>).map(([method, value]) => ({ path, method, ...value })),
    );
    expect(operations).toHaveLength(18);
    expect(new Set(operations.map(operation => operation.operationId)).size).toBe(18);
    expect(spec.paths['/health'].get.servers).toEqual([{ url: '/' }]);
    expect(spec.paths['/auth/register'].post.security).toEqual([]);
    expect(spec.paths['/auth/login'].post.security).toEqual([]);
    expect(spec.paths['/users/{id}/posts'].get.security).toEqual([]);
    expect(spec.paths['/users'].get.responses['403']).toBeDefined();
    expect(spec.paths['/notes/{id}'].delete.responses['204'].content).toBeUndefined();
  });

  it('keeps documented request rules and local schema references consistent', () => {
    const spec = JSON.parse(JSON.stringify(openApiDocument));
    expect(spec.components.schemas.RegisterInput.additionalProperties).toBe(false);
    expect(spec.components.schemas.RegisterInput.properties.role).toBeUndefined();
    expect(spec.components.schemas.UserCreateInput.properties.role.default).toBe('USER');
    expect(spec.components.schemas.UserUpdateInput.properties.role.default).toBeUndefined();
    expect(spec.components.schemas.NoteUpdateInput.minProperties).toBe(1);
    expect(spec.components.parameters.Limit.schema.maximum).toBe(100);
    function check(value: unknown) {
      if (!value || typeof value !== 'object') return;
      if ('$ref' in value && typeof value.$ref === 'string') {
        expect(value.$ref.startsWith('#/')).toBe(true);
        const target = value.$ref.slice(2).split('/').reduce((current: Record<string, unknown> | undefined, key) => current?.[key] as Record<string, unknown> | undefined, spec);
        expect(target, value.$ref).toBeDefined();
      }
      Object.values(value).forEach(check);
    }
    check(spec);
  });
});
