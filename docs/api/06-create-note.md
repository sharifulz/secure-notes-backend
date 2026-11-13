[Index](README.md) | [Previous](05-list-own-notes.md) | [Next](07-read-note.md)

# 06 — POST /api/v1/notes

Create a private note

**Access:** USER or ADMIN; the caller becomes the owner.

**Reading context:** [Shared request/validation/response behavior](00-shared-flow.md). Protected endpoints also perform the authentication lookup described there.

## Request

```http
POST /api/v1/notes
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "title": "Index practice",
  "content": "Study compound indexes."
}
```

## 1. Route-to-controller-to-service sequence

1. Authentication runs first, then `validateBody(createNoteSchema)`.
2. The controller passes the parsed content and `actor(req).id` to the service.
3. `withAccountWrite` starts a MongoDB transaction and updates the owner document as a write lock.
4. The note is inserted in that same transaction.

## 2. Validation methods and rules

- **title**: required string, trimmed, 1–200 characters.
- **content**: required string, 1–50,000 characters; not trimmed. A nonempty whitespace-only content string therefore passes this schema.
- **Extra fields**: rejected by `.strict()`. Ownership fields supplied by the client are not allowed.

Global JSON parsing, rate limits, authentication errors, and schema error formatting are covered in the shared guide. The request body/schema step occurs at the point shown in the route sequence above.

## 3. Database operations and why they work

```typescript
return withAccountWrite(ownerId, async session => {
  const [note] = await Note.create([{ ...input, ownerId }], { session });
  return note;
});
// Inside withAccountWrite, before the insertion:
await User.updateOne(
  { _id: ownerId }, { $inc: { writeVersion: 1 } }, { session }
);
```

- The `_id` index supports the owner lock query. The lock serializes content creation with the account-deletion transaction.
- If the account disappeared after authentication, the helper raises 401 and does not create an orphan note.
- Mongoose validates the inserted note, casts ownerId to ObjectId, creates `_id`, and supplies timestamps. `versionKey: false` means no `__v` field.
- Insertion maintains the two existing note indexes; there is no separate read query to find the new note.
- A replica set is required because this creation operation uses a transaction.

## 4. How the controller sets the response

```typescript
res.status(201).json({ success: true, data: await service.create(actor(req).id, req.body) });
```

**HTTP status: 201.**

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
| 400 | Validation failed | Invalid note body, including an attempted ownerId override. |
| 401 | Account no longer exists | Owner disappeared before the transaction lock. |
| 503 | This operation requires a MongoDB replica set | MongoDB code 20 is mapped to this message, commonly for standalone transaction failures. |

See the shared guide for general 400/401/413/429/500 handling. Errors are formatted centrally; a successful response body is not reused for failure.

## Source files

- [src/modules/notes/note.routes.ts](../../src/modules/notes/note.routes.ts)
- [src/modules/notes/note.validation.ts](../../src/modules/notes/note.validation.ts)
- [src/modules/notes/note.controller.ts](../../src/modules/notes/note.controller.ts)
- [src/modules/notes/note.service.ts](../../src/modules/notes/note.service.ts)
- [src/utils/account-write.ts](../../src/utils/account-write.ts)
- [src/modules/notes/note.model.ts](../../src/modules/notes/note.model.ts)
