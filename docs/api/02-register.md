[Index](README.md) | [Previous](01-health.md) | [Next](03-login.md)

# 02 — POST /api/v1/auth/register

Register an ordinary user

**Access:** Public; never grants admin access.

**Reading context:** [Shared request/validation/response behavior](00-shared-flow.md). Protected endpoints also perform the authentication lookup described there.

## Request

```http
POST /api/v1/auth/register
Content-Type: application/json
```

```json
{
  "name": "Amina",
  "email": "amina@example.com",
  "password": "ExamplePass123!",
  "interests": [
    "chess",
    "reading"
  ]
}
```

## 1. Route-to-controller-to-service sequence

1. `authRouter.post("/register", limiter, validateBody(registerSchema), controller.register)` runs the authentication rate limiter before body validation.
2. `validateBody` replaces `req.body` with Zod’s parsed/normalized result.
3. The controller calls `auth.service.register(req.body)`.
4. The service hashes the password, creates the account with an explicit USER role, and rereads the profile for the response.

## 2. Validation methods and rules

- **name**: required string; trimmed; 1–100 characters after trimming.
- **email**: required email string; the shared schema applies email-format validation, trimming, and lowercase normalization. Send an already-trimmed address; do not assume leading/trailing whitespace is accepted by the current validation order.
- **password**: required string; at least 12 and at most 72 characters, plus a custom check that UTF-8 encoding is at most 72 bytes. It is not trimmed.
- **interests**: optional for creation, default `[]`; at most 30 strings, each trimmed/lowercased and 1–50 characters. Duplicate normalized values are removed.
- **Extra fields**: rejected by `.strict()`, not silently accepted.
- **role**: not part of the registration schema. Sending it is a 400 validation failure, even if its value is `USER`.

Global JSON parsing, rate limits, authentication errors, and schema error formatting are covered in the shared guide. The request body/schema step occurs at the point shown in the route sequence above.

## 3. Database operations and why they work

```typescript
const { password, ...profile } = input;
const user = await User.create({
  ...profile,
  role: 'USER',
  passwordHash: await hashPassword(password)
});
return User.findById(user._id).lean();
```

- `hashPassword` uses bcrypt cost 12. Plaintext `password` is removed before insertion; `passwordHash` is stored instead.
- There is no preliminary email-existence query. The unique `{ email: 1 }` index enforces uniqueness atomically; duplicate insertions raise MongoDB code 11000.
- The reread uses the built-in `_id` index. User schema `select: false` excludes `passwordHash` and `writeVersion` from that read.
- Registration returns a profile, not a JWT. Call the login endpoint next.

## 4. How the controller sets the response

```typescript
res.status(201).json({ success: true, data: await service.register(req.body) });
```

**HTTP status: 201.**

Illustrative response; IDs, timestamps, JWTs, and counts are dynamic:

```json
{
  "success": true,
  "data": {
    "_id": "<user-id>",
    "name": "Amina",
    "email": "amina@example.com",
    "role": "USER",
    "interests": [
      "chess",
      "reading"
    ],
    "createdAt": "<ISO timestamp>",
    "updatedAt": "<ISO timestamp>"
  }
}
```

The controller/pagination helper supplies `success` and `data`. It does not supply a success-message string.

## 5. Endpoint-specific failures

| Status | Exact message | Cause |
| --- | --- | --- |
| 400 | Validation failed | Invalid fields or an unexpected field such as role. |
| 409 | Email is already registered | The unique email index rejected the insert. |
| 429 | Too many authentication attempts; try again later | Shared registration/login limiter exceeded. |

See the shared guide for general 400/401/413/429/500 handling. Errors are formatted centrally; a successful response body is not reused for failure.

## Source files

- [src/modules/auth/auth.routes.ts](../../src/modules/auth/auth.routes.ts)
- [src/modules/auth/auth.controller.ts](../../src/modules/auth/auth.controller.ts)
- [src/modules/auth/auth.service.ts](../../src/modules/auth/auth.service.ts)
- [src/modules/users/user.validation.ts](../../src/modules/users/user.validation.ts)
- [src/modules/users/user.model.ts](../../src/modules/users/user.model.ts)
- [src/utils/password.ts](../../src/utils/password.ts)
