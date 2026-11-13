[Index](README.md) | [Previous](00-shared-flow.md) | [Next](02-register.md)

# 01 — GET /health

Check process liveness

**Access:** Public; no token required.

**Reading context:** [Shared request/validation/response behavior](00-shared-flow.md). Protected endpoints also perform the authentication lookup described there.

## Request

```http
GET /health
```

## 1. Route-to-controller-to-service sequence

1. Express matches this handler directly in `app.ts`; no feature controller or service is involved.
2. It immediately returns a fixed JSON response.

## 2. Validation methods and rules

- No endpoint-specific body, path, or query schema. Global middleware still applies.

Global JSON parsing, rate limits, authentication errors, and schema error formatting are covered in the shared guide. The request body/schema step occurs at the point shown in the route sequence above.

## 3. Database operations and why they work

```typescript
// No database query is executed.
```

- This is a liveness check, not a database readiness query. Startup initially awaits the database connection, but a later connection loss is not detected by this endpoint.

## 4. How the controller sets the response

```typescript
res.json({ success: true, data: { status: 'ok' } });
```

**HTTP status: 200.**

Illustrative response; IDs, timestamps, JWTs, and counts are dynamic:

```json
{
  "success": true,
  "data": {
    "status": "ok"
  }
}
```

The controller/pagination helper supplies `success` and `data`. It does not supply a success-message string.

## 5. Endpoint-specific failures

This handler has no additional business-error message beyond the shared middleware behavior.

See the shared guide for general 400/401/413/429/500 handling. Errors are formatted centrally; a successful response body is not reused for failure.

## Source files

- [src/app.ts](../../src/app.ts)
