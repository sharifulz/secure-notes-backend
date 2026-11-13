[Index](README.md) | [Previous](06-create-note.md) | [Next](08-update-note.md)

# 07 — GET /api/v1/notes/:id

Read one note with ownership rules

**Access:** USER: own note only. ADMIN: any note.

**Reading context:** [Shared request/validation/response behavior](00-shared-flow.md). Protected endpoints also perform the authentication lookup described there.

## Request

```http
GET /api/v1/notes/<note-id>
Authorization: Bearer <token>
```

## 1. Route-to-controller-to-service sequence

1. Authentication attaches the current role and user ID.
2. The controller parses the note ID and passes `actor(req)` to `service.get`.
3. The service conditionally includes an ownership filter and requires a matching result.

## 2. Validation methods and rules

- **id**: `objectId.parse(req.params.id)` accepts exactly 24 hexadecimal characters, using `/^[a-fA-F0-9]{24}$/`. Invalid IDs produce a Zod validation error before the business query.
- For ordinary Mongoose queries, Mongoose casts the validated string to `ObjectId`. Aggregation pipelines need explicit casting, as explained for the posts lookup.

Global JSON parsing, rate limits, authentication errors, and schema error formatting are covered in the shared guide. The request body/schema step occurs at the point shown in the route sequence above.

## 3. Database operations and why they work

```typescript
required(await Note.findOne({
  _id: id,
  ...(user.role === 'ADMIN' ? {} : { ownerId: user.id })
}).lean(), 'Note not found');
```

- The built-in `_id` index narrows the query to at most one document; ownership is checked on that candidate. A separate `_id + ownerId` index is not necessary.
- Admins omit the owner condition for this read only. Regular users cannot use the URL to read someone else’s note.
- `required()` raises 404 for null. Missing and inaccessible notes deliberately produce the same message.

## 4. How the controller sets the response

```typescript
res.json({ success: true, data: await service.get(objectId.parse(req.params.id), actor(req)) });
```

**HTTP status: 200.**

Illustrative response; IDs, timestamps, JWTs, and counts are dynamic:

```json
{
  "success": true,
  "data": {
    "_id": "<note-id>",
    "ownerId": "<user-id>",
    "title": "Index practice",
    "content": "Study compound indexes.",
    "createdAt": "<ISO timestamp>",
    "updatedAt": "<ISO timestamp>"
  }
}
```

The controller/pagination helper supplies `success` and `data`. It does not supply a success-message string.

## 5. Endpoint-specific failures

| Status | Exact message | Cause |
| --- | --- | --- |
| 400 | Validation failed | Malformed note ID. |
| 404 | Note not found | No matching note or caller does not own it. |

See the shared guide for general 400/401/413/429/500 handling. Errors are formatted centrally; a successful response body is not reused for failure.

## Source files

- [src/modules/notes/note.routes.ts](../../src/modules/notes/note.routes.ts)
- [src/modules/notes/note.controller.ts](../../src/modules/notes/note.controller.ts)
- [src/modules/notes/note.service.ts](../../src/modules/notes/note.service.ts)
- [src/utils/validation.ts](../../src/utils/validation.ts)
- [src/utils/errors.ts](../../src/utils/errors.ts)
