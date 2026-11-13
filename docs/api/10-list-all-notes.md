[Index](README.md) | [Previous](09-delete-note.md) | [Next](11-list-users.md)

# 10 — GET /api/v1/admin/notes

Admin view of everyone’s notes

**Access:** ADMIN only.

**Reading context:** [Shared request/validation/response behavior](00-shared-flow.md). Protected endpoints also perform the authentication lookup described there.

## Request

```http
GET /api/v1/admin/notes?page=1&limit=10
Authorization: Bearer <admin-token>
```

## 1. Route-to-controller-to-service sequence

1. The route is declared directly in `app.ts`: `authenticate`, then `requireAdmin`, then `listAll`.
2. The controller calls `service.list(page)` without an owner ID.
3. The shared list service uses an empty filter for both page data and count.

## 2. Validation methods and rules

- `paginationSchema.parse(req.query)` accepts only `page` and `limit`; unexpected query keys are rejected.
- `page`: default 1, integer 1–100000. `limit`: default 10, integer 1–100. HTTP strings must contain digits only, then are coerced to numbers.
- `offset(page)` calculates `(page.page - 1) * page.limit`. Sorting is fixed by the service rather than accepted from the client.

Global JSON parsing, rate limits, authentication errors, and schema error formatting are covered in the shared guide. The request body/schema step occurs at the point shown in the route sequence above.

## 3. Database operations and why they work

```typescript
const filter = {};
const [data, total] = await Promise.all([
  Note.find(filter).sort({ createdAt: -1, _id: -1 })
    .skip(skip).limit(limit).lean(),
  Note.countDocuments(filter)
]);
```

- Omitting ownerId is intentional only after admin authorization. This is what allows the all-notes view.
- `{ createdAt: -1, _id: -1 }` supports the fixed global ordering; the owner-first index alone would not support the same unrestricted sort.
- The unfiltered count is a separate operation and can require scanning documents; an index supporting the page sort does not make every count free.
- This endpoint grants read access, not editing/deletion of other users’ notes.

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
      "_id": "<note-id>",
      "ownerId": "<user-id>",
      "title": "Index practice",
      "content": "Study compound indexes.",
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
| 400 | Validation failed | Invalid pagination. |
| 403 | Admin access required | Authenticated caller is not ADMIN. |

See the shared guide for general 400/401/413/429/500 handling. Errors are formatted centrally; a successful response body is not reused for failure.

## Source files

- [src/app.ts](../../src/app.ts)
- [src/middlewares/auth.ts](../../src/middlewares/auth.ts)
- [src/modules/notes/note.controller.ts](../../src/modules/notes/note.controller.ts)
- [src/modules/notes/note.service.ts](../../src/modules/notes/note.service.ts)
- [src/modules/notes/note.model.ts](../../src/modules/notes/note.model.ts)
