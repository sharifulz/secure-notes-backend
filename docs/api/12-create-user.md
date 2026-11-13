[Index](README.md) | [Previous](11-list-users.md) | [Next](13-read-user.md)

# 12 — POST /api/v1/users

Admin creates an account

**Access:** ADMIN only; may create USER or ADMIN accounts.

**Reading context:** [Shared request/validation/response behavior](00-shared-flow.md). Protected endpoints also perform the authentication lookup described there.

## Request

```http
POST /api/v1/users
Authorization: Bearer <token>
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
  ],
  "role": "USER"
}
```

## 1. Route-to-controller-to-service sequence

1. Authentication and requireAdmin run before body validation.
2. `validateBody(createUserSchema)` supplies normalized fields and defaults.
3. The service removes password, hashes it, inserts the user, then calls `get(user.id)` to reread a safe response.

## 2. Validation methods and rules

- **name**: required string; trimmed; 1–100 characters after trimming.
- **email**: required email string; the shared schema applies email-format validation, trimming, and lowercase normalization. Send an already-trimmed address; do not assume leading/trailing whitespace is accepted by the current validation order.
- **password**: required string; at least 12 and at most 72 characters, plus a custom check that UTF-8 encoding is at most 72 bytes. It is not trimmed.
- **interests**: optional for creation, default `[]`; at most 30 strings, each trimmed/lowercased and 1–50 characters. Duplicate normalized values are removed.
- **Extra fields**: rejected by `.strict()`, not silently accepted.
- **role**: optional on this endpoint; enum `USER` or `ADMIN`, default `USER`. This differs from public registration, which rejects the field.

Global JSON parsing, rate limits, authentication errors, and schema error formatting are covered in the shared guide. The request body/schema step occurs at the point shown in the route sequence above.

## 3. Database operations and why they work

```typescript
const { password, ...profile } = input;
const user = await User.create({
  ...profile,
  passwordHash: await hashPassword(password)
});
return get(user.id);
// get(id) reads User.findById(id).lean() and applies required(..., 'User not found').
```

- The unique email index prevents duplicate accounts without a separate pre-check.
- The role comes from the admin-validated input. Password hashing uses bcrypt cost 12.
- The reread uses the built-in `_id` index and excludes hidden password/internal fields.
- This creation service does not wrap insertion and reread in a transaction; the deletion/demotion safeguards are part of changeAccount, not this function.

## 4. How the controller sets the response

```typescript
res.status(201).json({ success: true, data: await service.create(req.body) });
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
| 400 | Validation failed | Invalid body or role. |
| 403 | Admin access required | Caller is not ADMIN. |
| 409 | Email is already registered | Email unique index rejected the insert. |
| 404 | User not found | The service reread could not find the newly created account, for example after concurrent deletion. |

See the shared guide for general 400/401/413/429/500 handling. Errors are formatted centrally; a successful response body is not reused for failure.

## Source files

- [src/modules/users/user.routes.ts](../../src/modules/users/user.routes.ts)
- [src/modules/users/user.validation.ts](../../src/modules/users/user.validation.ts)
- [src/modules/users/user.controller.ts](../../src/modules/users/user.controller.ts)
- [src/modules/users/user.service.ts](../../src/modules/users/user.service.ts)
- [src/modules/users/user.model.ts](../../src/modules/users/user.model.ts)
