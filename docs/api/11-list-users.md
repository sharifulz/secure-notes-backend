[Index](README.md) | [Previous](10-list-all-notes.md) | [Next](12-create-user.md)

# 11 — GET /api/v1/users

List accounts as an admin

**Access:** ADMIN only.

**Reading context:** [Shared request/validation/response behavior](00-shared-flow.md). Protected endpoints also perform the authentication lookup described there.

## Request

```http
GET /api/v1/users?page=1&limit=10
Authorization: Bearer <admin-token>
```

## 1. Route-to-controller-to-service sequence

1. The user router’s `use(authenticate, requireAdmin)` runs before this route.
2. The controller parses pagination and calls `service.list`.
3. The service fetches a page and the total user count in parallel.

## 2. Validation methods and rules

- `paginationSchema.parse(req.query)` accepts only `page` and `limit`; unexpected query keys are rejected.
- `page`: default 1, integer 1–100000. `limit`: default 10, integer 1–100. HTTP strings must contain digits only, then are coerced to numbers.
- `offset(page)` calculates `(page.page - 1) * page.limit`. Sorting is fixed by the service rather than accepted from the client.

Global JSON parsing, rate limits, authentication errors, and schema error formatting are covered in the shared guide. The request body/schema step occurs at the point shown in the route sequence above.

## 3. Database operations and why they work

```typescript
const [data, total] = await Promise.all([
  User.find().sort({ createdAt: -1, _id: -1 })
    .skip(skip).limit(limit).lean(),
  User.countDocuments()
]);
```

- The `{ createdAt: -1, _id: -1 }` user index supports the list ordering. The separate unfiltered count may scan; no role filter is applied.
- Default schema selection hides passwordHash and writeVersion for every returned user.
- This lists all roles. It does not accept arbitrary search, role, or sort query parameters because the pagination object is strict.

## 4. How the controller sets the response

```typescript
res.json(await service.list(paginationSchema.parse(req.query)));
```

**HTTP status: 200.**

Illustrative response; IDs, timestamps, JWTs, and counts are dynamic:

```json
{
  "success": true,
  "data": [
    {
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
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 1,
    "totalPages": 1,
    "hasNext": false
  }
}
```

The controller/pagination helper supplies `success` and `data`. It does not supply a success-message string.

## 5. Endpoint-specific failures

| Status | Exact message | Cause |
| --- | --- | --- |
| 400 | Validation failed | Invalid or unexpected pagination query fields. |
| 403 | Admin access required | Ordinary user attempted user management. |

See the shared guide for general 400/401/413/429/500 handling. Errors are formatted centrally; a successful response body is not reused for failure.

## Source files

- [src/modules/users/user.routes.ts](../../src/modules/users/user.routes.ts)
- [src/modules/users/user.controller.ts](../../src/modules/users/user.controller.ts)
- [src/modules/users/user.service.ts](../../src/modules/users/user.service.ts)
- [src/modules/users/user.model.ts](../../src/modules/users/user.model.ts)
