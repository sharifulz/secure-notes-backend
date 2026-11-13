[Index](README.md) | [Previous](03-login.md) | [Next](05-list-own-notes.md)

# 04 — GET /api/v1/auth/me

Read the authenticated profile

**Access:** USER or ADMIN with a valid Bearer JWT.

**Reading context:** [Shared request/validation/response behavior](00-shared-flow.md). Protected endpoints also perform the authentication lookup described there.

## Request

```http
GET /api/v1/auth/me
Authorization: Bearer <token>
```

## 1. Route-to-controller-to-service sequence

1. Authentication first loads the account’s role by token subject.
2. The `me` controller directly reads the profile. There is no separate me service function.
3. The controller returns the resulting plain object.

## 2. Validation methods and rules

- The route uses `authenticate`. This validates the Bearer header, JWT signature/claims, and existence of the subject account.
- No request body, client-supplied user ID, or pagination is required. The ID comes from `actor(req).id`.

Global JSON parsing, rate limits, authentication errors, and schema error formatting are covered in the shared guide. The request body/schema step occurs at the point shown in the route sequence above.

## 3. Database operations and why they work

```typescript
await User.findById(actor(req).id).lean();
```

- The built-in `_id` index supports both the authentication lookup and this profile read.
- `lean()` avoids constructing a full Mongoose document for a read-only result. Default schema projections exclude the hash and internal writeVersion.
- Normally there are two user reads: authentication and profile retrieval. If the account is deleted between them, this controller does not use `required()`, so its second read can return `data: null`.

## 4. How the controller sets the response

```typescript
res.json({ success: true, data: await User.findById(actor(req).id).lean() });
```

**HTTP status: 200.**

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

This handler has no additional business-error message beyond the shared middleware behavior.

See the shared guide for general 400/401/413/429/500 handling. Errors are formatted centrally; a successful response body is not reused for failure.

## Source files

- [src/modules/auth/auth.routes.ts](../../src/modules/auth/auth.routes.ts)
- [src/modules/auth/auth.controller.ts](../../src/modules/auth/auth.controller.ts)
- [src/middlewares/auth.ts](../../src/middlewares/auth.ts)
- [src/modules/users/user.model.ts](../../src/modules/users/user.model.ts)
