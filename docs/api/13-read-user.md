[Index](README.md) | [Previous](12-create-user.md) | [Next](14-update-user.md)

# 13 — GET /api/v1/users/:id

Read one user as an admin

**Access:** ADMIN only. Ordinary users read themselves through /auth/me.

**Reading context:** [Shared request/validation/response behavior](00-shared-flow.md). Protected endpoints also perform the authentication lookup described there.

## Request

```http
GET /api/v1/users/<user-id>
Authorization: Bearer <admin-token>
```

## 1. Route-to-controller-to-service sequence

1. The router authenticates and enforces ADMIN.
2. The controller validates the ID and calls `service.get`.
3. The service requires a matching user profile.

## 2. Validation methods and rules

- **id**: `objectId.parse(req.params.id)` accepts exactly 24 hexadecimal characters, using `/^[a-fA-F0-9]{24}$/`. Invalid IDs produce a Zod validation error before the business query.
- For ordinary Mongoose queries, Mongoose casts the validated string to `ObjectId`. Aggregation pipelines need explicit casting, as explained for the posts lookup.

Global JSON parsing, rate limits, authentication errors, and schema error formatting are covered in the shared guide. The request body/schema step occurs at the point shown in the route sequence above.

## 3. Database operations and why they work

```typescript
required(await User.findById(id).lean(), 'User not found');
```

- The built-in `_id` index supports this lookup.
- The result excludes passwordHash and writeVersion by default. It includes profile fields, role, interests, and timestamps.
- The literal `/group-by-interests` route is declared before `/:id`; otherwise the report name could be treated as an invalid user ID.

## 4. How the controller sets the response

```typescript
res.json({ success: true, data: await service.get(objectId.parse(req.params.id)) });
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

| Status | Exact message | Cause |
| --- | --- | --- |
| 400 | Validation failed | Malformed user ID. |
| 403 | Admin access required | Caller is not ADMIN. |
| 404 | User not found | No account with that ID. |

See the shared guide for general 400/401/413/429/500 handling. Errors are formatted centrally; a successful response body is not reused for failure.

## Source files

- [src/modules/users/user.routes.ts](../../src/modules/users/user.routes.ts)
- [src/modules/users/user.controller.ts](../../src/modules/users/user.controller.ts)
- [src/modules/users/user.service.ts](../../src/modules/users/user.service.ts)
