[Index](README.md) | [Previous](07-read-note.md) | [Next](09-delete-note.md)

# 08 — PATCH /api/v1/notes/:id

Update a note you own

**Access:** Owner only, including when the caller is ADMIN.

**Reading context:** [Shared request/validation/response behavior](00-shared-flow.md). Protected endpoints also perform the authentication lookup described there.

## Request

```http
PATCH /api/v1/notes/:id
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "title": "Revised index practice"
}
```

## 1. Route-to-controller-to-service sequence

1. After body validation, the controller parses the ID and passes it with the authenticated owner ID.
2. The service uses one atomic find-and-update with both ID and ownership in its filter.
3. A null result becomes a 404; a match returns the updated document.

## 2. Validation methods and rules

- The route first authenticates, then validates the body with `updateNoteSchema`.
- This schema is `createNoteSchema.partial()`: title/content are individually optional, but supplied values retain their original type/length rules.
- A `.refine(...)` check rejects an empty object with `At least one field is required`. `.strict()` rejects unknown fields and ownerId changes.
- **id**: `objectId.parse(req.params.id)` accepts exactly 24 hexadecimal characters, using `/^[a-fA-F0-9]{24}$/`. Invalid IDs produce a Zod validation error before the business query.
- For ordinary Mongoose queries, Mongoose casts the validated string to `ObjectId`. Aggregation pipelines need explicit casting, as explained for the posts lookup.

Global JSON parsing, rate limits, authentication errors, and schema error formatting are covered in the shared guide. The request body/schema step occurs at the point shown in the route sequence above.

## 3. Database operations and why they work

```typescript
required(await Note.findOneAndUpdate(
  { _id: id, ownerId },
  { $set: input },
  { returnDocument: 'after', runValidators: true }
).lean(), 'Note not found');
```

- `$set` changes only supplied fields rather than replacing the entire note.
- `runValidators: true` adds Mongoose schema validation for the update. Timestamps update `updatedAt`; `createdAt` is retained.
- `returnDocument: "after"` returns the modified note. The built-in `_id` index supports candidate lookup.
- There is no admin bypass for editing others’ notes and no earlier ownership-check query that could become stale.

## 4. How the controller sets the response

```typescript
res.json({ success: true, data: await service.update(objectId.parse(req.params.id), actor(req).id, req.body) });
```

**HTTP status: 200.**

Illustrative response; IDs, timestamps, JWTs, and counts are dynamic:

```json
{
  "success": true,
  "data": {
    "_id": "<note-id>",
    "ownerId": "<user-id>",
    "title": "Revised index practice",
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
| 400 | Validation failed | Invalid/empty update or invalid ID. |
| 404 | Note not found | Missing note or ownership mismatch. |

See the shared guide for general 400/401/413/429/500 handling. Errors are formatted centrally; a successful response body is not reused for failure.

## Source files

- [src/modules/notes/note.routes.ts](../../src/modules/notes/note.routes.ts)
- [src/modules/notes/note.validation.ts](../../src/modules/notes/note.validation.ts)
- [src/modules/notes/note.controller.ts](../../src/modules/notes/note.controller.ts)
- [src/modules/notes/note.service.ts](../../src/modules/notes/note.service.ts)
