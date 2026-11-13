[Index](README.md) | [Previous](02-register.md) | [Next](04-my-profile.md)

# 03 — POST /api/v1/auth/login

Verify a password and issue a JWT

**Access:** Public; credentials must belong to an application user.

**Reading context:** [Shared request/validation/response behavior](00-shared-flow.md). Protected endpoints also perform the authentication lookup described there.

## Request

```http
POST /api/v1/auth/login
Content-Type: application/json
```

```json
{
  "email": "amina@example.com",
  "password": "ExamplePass123!"
}
```

## 1. Route-to-controller-to-service sequence

1. The shared auth rate limiter runs, then `validateBody(loginSchema)`.
2. The controller passes the normalized email and password to `service.login`.
3. The service fetches the account, compares the password with bcrypt, and signs a short-lived JWT on success.

## 2. Validation methods and rules

- `loginSchema` is a strict object containing only `email` and `password`.
- Email uses the shared format/normalization schema. Password requires 1–72 characters and at most 72 UTF-8 bytes.
- Login permits passwords shorter than registration’s 12-character minimum so verification does not depend on creation-policy validation. The actual stored bcrypt hash must still match.

Global JSON parsing, rate limits, authentication errors, and schema error formatting are covered in the shared guide. The request body/schema step occurs at the point shown in the route sequence above.

## 3. Database operations and why they work

```typescript
const user = await User.findOne({ email }).select('+passwordHash');
const valid = await verifyPassword(password, user?.passwordHash || await dummyHash);
if (!valid || !user?.passwordHash) {
  throw new ApiError(401, 'Invalid email or password given, try again');
}
```

- `{ email: 1 }` supports the account lookup. `.select("+passwordHash")` explicitly includes a field hidden by default in the schema.
- `verifyPassword` is `bcrypt.compare(password, hash)`, not plaintext comparison and not decryption.
- Unknown users and sample accounts with a null hash are compared against a dummy bcrypt hash to reduce timing differences; both are rejected.
- The JWT uses HS256, `sub = user.id`, configured issuer/audience, and a 15-minute expiry. Role is not embedded in this token; protected middleware reads the current database role.
- No JWT/session document is inserted into MongoDB.

## 4. How the controller sets the response

```typescript
res.json({ success: true, data: await service.login(req.body.email, req.body.password) });
```

**HTTP status: 200.**

Illustrative response; IDs, timestamps, JWTs, and counts are dynamic:

```json
{
  "success": true,
  "data": {
    "accessToken": "<signed JWT>",
    "tokenType": "Bearer",
    "expiresIn": 900
  }
}
```

The controller/pagination helper supplies `success` and `data`. It does not supply a success-message string.

## 5. Endpoint-specific failures

| Status | Exact message | Cause |
| --- | --- | --- |
| 400 | Validation failed | Invalid email/password shape. |
| 401 | Invalid email or password given, try again | Wrong password, no user, or null passwordHash. |
| 429 | Too many authentication attempts; try again later | Shared authentication rate limiter exceeded. |

See the shared guide for general 400/401/413/429/500 handling. Errors are formatted centrally; a successful response body is not reused for failure.

## Source files

- [src/modules/auth/auth.routes.ts](../../src/modules/auth/auth.routes.ts)
- [src/modules/auth/auth.validation.ts](../../src/modules/auth/auth.validation.ts)
- [src/modules/auth/auth.controller.ts](../../src/modules/auth/auth.controller.ts)
- [src/modules/auth/auth.service.ts](../../src/modules/auth/auth.service.ts)
- [src/utils/password.ts](../../src/utils/password.ts)
