[Index](README.md) | [Previous](04-my-profile.md) | [Next](06-create-note.md)

# 05 — GET /api/v1/notes

List only your own notes

**Access:** USER or ADMIN; this route always lists the caller’s own notes.

**Reading context:** [Shared request/validation/response behavior](00-shared-flow.md). Protected endpoints also perform the authentication lookup described there.

## Request

```http
GET /api/v1/notes?page=1&limit=10
Authorization: Bearer <token>
```

## 1. Route-to-controller-to-service sequence

1. `noteRouter.use(authenticate)` protects the route.
2. The controller parses pagination and calls `service.list(page, actor(req).id)`.
3. The service builds an owner filter, fetches the requested page, and counts matching notes in parallel.

## 2. Validation methods and rules

- `paginationSchema.parse(req.query)` accepts only `page` and `limit`; unexpected query keys are rejected.
- `page`: default 1, integer 1–100000. `limit`: default 10, integer 1–100. HTTP strings must contain digits only, then are coerced to numbers.
- `offset(page)` calculates `(page.page - 1) * page.limit`. Sorting is fixed by the service rather than accepted from the client.

Global JSON parsing, rate limits, authentication errors, and schema error formatting are covered in the shared guide. The request body/schema step occurs at the point shown in the route sequence above.

## 3. Database operations and why they work

```typescript
const filter = { ownerId: authenticatedUserId };
const [data, total] = await Promise.all([
  Note.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .skip((page - 1) * limit).limit(limit).lean(),
  Note.countDocuments(filter)
]);
```

- The owner ID is supplied by authentication, not by a request query parameter.
- The compound `{ ownerId: 1, createdAt: -1, _id: -1 }` index supports owner matching and fixed sorting.
- The count uses the same owner filter. Page and count are separate reads, not one snapshot, so they can differ briefly during concurrent writes.
- An empty list is 200 with `data: []`, `total: 0`, `totalPages: 0`, and `hasNext: false`; it is not a 404.

## 4. How the controller sets the response

```typescript
res.json(await service.list(paginationSchema.parse(req.query), actor(req).id));
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
| 400 | Validation failed | Invalid page/limit or an unexpected query parameter. |

See the shared guide for general 400/401/413/429/500 handling. Errors are formatted centrally; a successful response body is not reused for failure.

## Source files

- [src/modules/notes/note.routes.ts](../../src/modules/notes/note.routes.ts)
- [src/modules/notes/note.controller.ts](../../src/modules/notes/note.controller.ts)
- [src/modules/notes/note.service.ts](../../src/modules/notes/note.service.ts)
- [src/modules/notes/note.model.ts](../../src/modules/notes/note.model.ts)
- [src/utils/pagination.ts](../../src/utils/pagination.ts)
