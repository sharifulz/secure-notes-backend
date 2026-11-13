[Index](README.md) | [Previous](14-update-user.md) | [Next](16-users-by-interest.md)

# 15 — DELETE /api/v1/users/:id

Remove an account without orphaning its content

**Access:** ADMIN only.

**Reading context:** [Shared request/validation/response behavior](00-shared-flow.md). Protected endpoints also perform the authentication lookup described there.

## Request

```http
DELETE /api/v1/users/<user-id>
Authorization: Bearer <admin-token>
```

## 1. Route-to-controller-to-service sequence

1. The controller validates the target ID and calls `service.remove(id)`.
2. `remove` delegates to `changeAccount(id, null)`; null selects its deletion branch.
3. Within the transaction it locks admin documents and the target, protects the final admin, checks for owned notes/posts, and deletes only a content-free account.
4. The controller returns no response body.

## 2. Validation methods and rules

- **id**: `objectId.parse(req.params.id)` accepts exactly 24 hexadecimal characters, using `/^[a-fA-F0-9]{24}$/`. Invalid IDs produce a Zod validation error before the business query.
- For ordinary Mongoose queries, Mongoose casts the validated string to `ObjectId`. Aggregation pipelines need explicit casting, as explained for the posts lookup.
- No endpoint-specific body schema; no request body is needed.

Global JSON parsing, rate limits, authentication errors, and schema error formatting are covered in the shared guide. The request body/schema step occurs at the point shown in the route sequence above.

## 3. Database operations and why they work

```typescript
// Relevant deletion branch inside changeAccount's transaction:
if (user.role === 'ADMIN' && await User.countDocuments({ role: 'ADMIN' }).session(session) <= 1) {
  throw new ApiError(409, 'Cannot remove or demote the final admin');
}
const notes = await Note.exists({ ownerId: id }).session(session);
const posts = await Post.exists({ authorId: id }).session(session);
if (notes || posts) {
  throw new ApiError(409, 'Cannot delete a user who owns notes or posts');
}
await User.deleteOne({ _id: id }, { session });
```

- `exists` only needs to establish whether at least one matching content document exists. The code runs both existence queries sequentially.
- Owner-first and author-first compound indexes support these existence filters. The built-in user `_id` index supports the target lock and deletion.
- There is no cascade delete. Any matching note or post rejects the request with 409 and the transaction rolls back its lock changes.
- Note/post creation also locks the owner document in its own transaction, preventing a content-creation race with user deletion.
- The actual API has no post-deletion endpoint, so accounts with posts cannot be cleared through a nonexistent post-delete API.
- Only this transactional API guard protects these rules; direct mongosh deleteOne calls bypass it.

## 4. How the controller sets the response

```typescript
await service.remove(objectId.parse(req.params.id));
res.status(204).end();
```

**HTTP status: 204.**

The successful response is empty. There is no JSON success flag, data object, or message for this 204 response.

## 5. Endpoint-specific failures

| Status | Exact message | Cause |
| --- | --- | --- |
| 400 | Validation failed | Malformed user ID. |
| 403 | Admin access required | Caller is not ADMIN. |
| 404 | User not found | Target is absent. |
| 409 | Cannot remove or demote the final admin | Target is the sole admin. |
| 409 | Cannot delete a user who owns notes or posts | Target still owns content. |
| 503 | This operation requires a MongoDB replica set | Transaction operation raised code 20. |

See the shared guide for general 400/401/413/429/500 handling. Errors are formatted centrally; a successful response body is not reused for failure.

## Source files

- [src/modules/users/user.routes.ts](../../src/modules/users/user.routes.ts)
- [src/modules/users/user.controller.ts](../../src/modules/users/user.controller.ts)
- [src/modules/users/user.service.ts](../../src/modules/users/user.service.ts)
- [src/utils/account-write.ts](../../src/utils/account-write.ts)
