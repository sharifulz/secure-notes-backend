[Index](README.md) | [Previous](08-update-note.md) | [Next](10-list-all-notes.md)

# 09 — DELETE /api/v1/notes/:id

Delete a note you own

**Access:** Owner only, including when the caller is ADMIN.

**Reading context:** [Shared request/validation/response behavior](00-shared-flow.md). Protected endpoints also perform the authentication lookup described there.

## Request

```http
DELETE /api/v1/notes/<note-id>
Authorization: Bearer <token>
```

## 1. Route-to-controller-to-service sequence

1. The controller parses the ID and obtains the authenticated owner ID.
2. The service atomically matches and deletes the note.
3. The controller waits for completion and ends the response without JSON.

## 2. Validation methods and rules

- **id**: `objectId.parse(req.params.id)` accepts exactly 24 hexadecimal characters, using `/^[a-fA-F0-9]{24}$/`. Invalid IDs produce a Zod validation error before the business query.
- For ordinary Mongoose queries, Mongoose casts the validated string to `ObjectId`. Aggregation pipelines need explicit casting, as explained for the posts lookup.
- No endpoint-specific body schema is attached; no body is needed.

Global JSON parsing, rate limits, authentication errors, and schema error formatting are covered in the shared guide. The request body/schema step occurs at the point shown in the route sequence above.

## 3. Database operations and why they work

```typescript
required(await Note.findOneAndDelete({ _id: id, ownerId }), 'Note not found');
```

- The built-in `_id` index supports the lookup; the owner condition prevents deleting another user’s note.
- The returned deleted document is used to detect whether anything matched, not sent back to the client.
- The result is 204 only if a matching note was deleted.

## 4. How the controller sets the response

```typescript
await service.remove(objectId.parse(req.params.id), actor(req).id);
res.status(204).end();
```

**HTTP status: 204.**

The successful response is empty. There is no JSON success flag, data object, or message for this 204 response.

## 5. Endpoint-specific failures

| Status | Exact message | Cause |
| --- | --- | --- |
| 400 | Validation failed | Malformed note ID. |
| 404 | Note not found | Missing note or ownership mismatch. |

See the shared guide for general 400/401/413/429/500 handling. Errors are formatted centrally; a successful response body is not reused for failure.

## Source files

- [src/modules/notes/note.routes.ts](../../src/modules/notes/note.routes.ts)
- [src/modules/notes/note.controller.ts](../../src/modules/notes/note.controller.ts)
- [src/modules/notes/note.service.ts](../../src/modules/notes/note.service.ts)
