[Index](README.md) | [Previous](16-users-by-interest.md) | [Next](18-list-user-posts.md)

# 17 — POST /api/v1/posts

Create a public post

**Access:** USER or ADMIN with a valid token. Reading posts is public.

**Reading context:** [Shared request/validation/response behavior](00-shared-flow.md). Protected endpoints also perform the authentication lookup described there.

## Request

```http
POST /api/v1/posts
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "title": "Learning MongoDB",
  "content": "Today I practiced aggregation."
}
```

## 1. Route-to-controller-to-service sequence

1. The route authenticates, then applies `validateBody(createPostSchema)`.
2. `post.validation.ts` re-exports the note creation schema under the name createPostSchema, so title/content validation is identical.
3. The controller supplies the authenticated ID as authorId.
4. The service inserts the post inside `withAccountWrite`, locking its author account first.

## 2. Validation methods and rules

- **title**: required string, trimmed, 1–200 characters.
- **content**: required string, 1–50,000 characters; not trimmed. A nonempty whitespace-only content string therefore passes this schema.
- **Extra fields**: rejected by `.strict()`. Ownership fields supplied by the client are not allowed.

Global JSON parsing, rate limits, authentication errors, and schema error formatting are covered in the shared guide. The request body/schema step occurs at the point shown in the route sequence above.

## 3. Database operations and why they work

```typescript
return withAccountWrite(authorId, async session => {
  const [post] = await Post.create([{ ...input, authorId }], { session });
  return post;
});
```

- The shared helper increments the author’s internal writeVersion inside the transaction to coordinate with account deletion.
- The caller cannot choose authorId in the JSON body because the strict schema rejects it.
- Mongoose applies post model validation, casts the author ID, assigns _id/timestamps, and maintains `{ authorId: 1, createdAt: -1, _id: -1 }`.
- The returned post can then be retrieved through GET /users/:id/posts without authentication. There are no implemented post-edit, post-delete, or global post-list endpoints.

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
    "_id": "<post-id>",
    "authorId": "<user-id>",
    "title": "Learning MongoDB",
    "content": "Today I practiced aggregation.",
    "createdAt": "<ISO timestamp>",
    "updatedAt": "<ISO timestamp>"
  }
}
```

The controller/pagination helper supplies `success` and `data`. It does not supply a success-message string.

## 5. Endpoint-specific failures

| Status | Exact message | Cause |
| --- | --- | --- |
| 400 | Validation failed | Invalid title/content or unexpected authorId field. |
| 401 | Account no longer exists | Author disappeared before the transaction lock. |
| 503 | This operation requires a MongoDB replica set | Transaction operation raised code 20. |

See the shared guide for general 400/401/413/429/500 handling. Errors are formatted centrally; a successful response body is not reused for failure.

## Source files

- [src/modules/posts/post.routes.ts](../../src/modules/posts/post.routes.ts)
- [src/modules/posts/post.validation.ts](../../src/modules/posts/post.validation.ts)
- [src/modules/posts/post.controller.ts](../../src/modules/posts/post.controller.ts)
- [src/modules/posts/post.service.ts](../../src/modules/posts/post.service.ts)
- [src/modules/posts/post.model.ts](../../src/modules/posts/post.model.ts)
- [src/utils/account-write.ts](../../src/utils/account-write.ts)
