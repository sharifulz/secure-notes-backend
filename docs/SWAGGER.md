# Swagger API documentation

Public URL after deploying this version:

**http://160.25.5.68/api/v1/docs/**

OpenAPI JSON: **http://160.25.5.68/api/v1/docs/openapi.json**.

Desktop: **http://localhost:4000/api/v1/docs/** while `npm run dev` is running. These public routes need no JWT and use the already-configured Nginx `/api/` forwarding rule. The actual protected APIs still enforce their normal role and ownership rules. `/api-docs/` is an additional alias, with the optional proxy configuration below.

## Use the documentation

1. Expand **Authentication → Sign in**, click **Try it out**, and enter an existing application account's email/password.
2. Execute the login and copy `data.accessToken` from the response.
3. Click **Authorize** and paste only the token, without the word `Bearer`.
4. Expand another endpoint, choose **Try it out**, and execute it. The documented server is relative to the current origin, so requests use the same local/VPS server that hosts Swagger.
5. Sign in again after 15 minutes. Authorization is not persisted across reloads.

Endpoints are grouped by Authentication, Notes, Admin notes, Admin users, Interest groups, Posts, and Health. Each operation has a short purpose, request schema, validation limits, response shape, and expected status codes. Filtering and deep links help locate an endpoint. Swagger UI assets are served by this backend, not a CDN; external spec validation is disabled.

The docs do not automatically log in, create data, or execute APIs. Explicit **Execute** actions run against the current server, including real create/update/delete operations. Demo passwords shown elsewhere are not guaranteed to match existing accounts.

## Deploy the backend

From Windows:

```powershell
cd E:\PROJECTS\MongoDb\SecureNotes
npm run deploy
```

This uploads the Swagger-enabled backend and runtime dependencies using the existing update process. It deliberately does not change your Nginx configuration. The primary `/api/v1/docs/` URL needs no new Nginx rule.

## Optional shorter /api-docs/ alias on 160.25.5.68

Skip this section if using the primary `/api/v1/docs/` URL. To also expose `http://160.25.5.68/api-docs/`, add this one-time proxy rule:

SSH to the VPS and edit the existing site's server block:

```bash
ssh root@160.25.5.68
nano /etc/nginx/conf.d/secure-notes.conf
```

Inside the existing `server { ... }`, alongside `location /api/`, add this block once:

```nginx
location /api-docs {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Do not add a trailing slash to proxy_pass: the backend must receive `/api-docs/...` for the UI, CSS, JavaScript, and JSON routes. The full updated configuration is also in `deploy/combined/nginx.conf`; inspect it before replacing any custom server configuration.

To support Swagger's Health operation, keep the following block if it is already configured, or add it once if missing:

```nginx
location = /health {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
}
```

Validate first, then reload only if validation succeeds:

```bash
nginx -t
systemctl reload nginx
curl --fail http://127.0.0.1:8787/api-docs/openapi.json
curl --fail http://160.25.5.68/api-docs/openapi.json
```

Opening the page does not prove a new version is deployed. If `/api/v1/docs/` is 404, verify that the new backend was deployed and `/api/` still forwards to it. If only the optional `/api-docs/` alias is 404 while its localhost URL works, its Nginx proxy is missing or was not reloaded. A 502 usually means the backend is unavailable. Existing `.env`, database, and SSH tunnel settings are unchanged.

## Files to maintain

- `src/docs/openapi.ts`: API descriptions, request/response schemas, security, and examples.
- `src/docs/swagger.routes.ts`: UI options, visual styling, and documentation routes.
- `tests/swagger.test.ts`: public access, asset serving, API coverage, validation contracts, and schema-reference checks.

Update the OpenAPI definition when changing an endpoint. The longer [implementation walkthrough](API-WALKTHROUGH.md) explains validators, services, database queries, and response formatting; Swagger is the shorter interactive reference.
