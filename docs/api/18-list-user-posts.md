[Index](README.md) | [Previous](17-create-post.md)

# 18 — GET /api/v1/users/:id/posts

Retrieve public posts using a single lookup aggregation

**Access:** Public; no JWT required, even though the URL starts with /users.

**Reading context:** [Shared request/validation/response behavior](00-shared-flow.md). Protected endpoints also perform the authentication lookup described there.

## Request

```http
GET /api/v1/users/<user-id>/posts?page=1&limit=10
```

## 1. Route-to-controller-to-service sequence

1. The user router declares `get("/:id/posts", byUser)` before `use(authenticate, requireAdmin)`, so this route finishes without the admin middleware.
2. The post controller validates the user ID, then pagination, and calls `service.byUser`.
3. The service performs one User.aggregate pipeline containing $lookup, then builds a paginated response with author information.

## 2. Validation methods and rules

- **id**: `objectId.parse(req.params.id)` accepts exactly 24 hexadecimal characters, using `/^[a-fA-F0-9]{24}$/`. Invalid IDs produce a Zod validation error before the business query.
- For ordinary Mongoose queries, Mongoose casts the validated string to `ObjectId`. Aggregation pipelines need explicit casting, as explained for the posts lookup.
- `paginationSchema.parse(req.query)` accepts only `page` and `limit`; unexpected query keys are rejected.
- `page`: default 1, integer 1–100000. `limit`: default 10, integer 1–100. HTTP strings must contain digits only, then are coerced to numbers.
- `offset(page)` calculates `(page.page - 1) * page.limit`. Sorting is fixed by the service rather than accepted from the client.

Global JSON parsing, rate limits, authentication errors, and schema error formatting are covered in the shared guide. The request body/schema step occurs at the point shown in the route sequence above.

## 3. Database operations and why they work

```typescript
export async function byUser(id: string, page: Page) {
  const [user] = await User.aggregate([
    { $match: { _id: new Types.ObjectId(id) } },
    { $lookup: {
      from: 'posts', localField: '_id', foreignField: 'authorId',
      pipeline: [
        { $sort: sortNewest },
        { $facet: {
          data: [{ $skip: offset(page) }, { $limit: page.limit }, { $project: { title: 1, content: 1, createdAt: 1, authorId: 1 } }],
          metadata: [{ $count: 'total' }],
        } },
      ], as: 'postResults',
    } },
    { $project: { _id: 1, name: 1, postResults: { $arrayElemAt: ['$postResults', 0] } } },
  ]);
  required(user, 'User not found');
  return { ...paginated(user.postResults?.data ?? [], user.postResults?.metadata?.[0]?.total ?? 0, page), user: { id: user._id, name: user.name } };
}
```

- `new Types.ObjectId(id)` is essential: Mongoose does not automatically cast pipeline literals as it does for normal find queries.
- The outer `$match` finds one user using the built-in _id index. If no user exists, the aggregation returns no author and required(user, "User not found") raises 404.
- `$lookup` joins users._id to posts.authorId, using the separate posts collection.
- Inside the lookup, newest-first `$sort` and the author join are designed around `{ authorId: 1, createdAt: -1, _id: -1 }`. Confirm actual planner choices with explain on representative data.
- `$facet.data` paginates posts and projects title/content/createdAt/authorId; post _id is retained by default. `$facet.metadata` counts that author’s posts before pagination.
- The outer projection retains only the author _id/name and the first facet result. It does not expose the author email or passwordHash.
- The response data is the posts array, not the full user or lookup wrapper. A separate top-level user field gives id/name.
- An existing author with no posts produces a successful empty page, not 404. The operation uses one aggregation call, not a User.find followed by Post.find, and not populate().

## 4. How the controller sets the response

```typescript
res.json(await service.byUser(objectId.parse(req.params.id), paginationSchema.parse(req.query)));
```

**HTTP status: 200.**

Illustrative response; IDs, timestamps, JWTs, and counts are dynamic:

```json
{
  "success": true,
  "data": [
    {
      "_id": "<post-id>",
      "authorId": "<user-id>",
      "title": "Learning MongoDB",
      "content": "Today I practiced aggregation.",
      "createdAt": "<ISO timestamp>"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 1,
    "totalPages": 1,
    "hasNext": false
  },
  "user": {
    "id": "<user-id>",
    "name": "Amina"
  }
}
```

The controller/pagination helper supplies `success` and `data`. It does not supply a success-message string.

## 5. Endpoint-specific failures

| Status | Exact message | Cause |
| --- | --- | --- |
| 400 | Validation failed | Invalid user ID, pagination, or unexpected query fields. |
| 404 | User not found | The author does not exist. |

See the shared guide for general 400/401/413/429/500 handling. Errors are formatted centrally; a successful response body is not reused for failure.

## Source files

- [src/modules/users/user.routes.ts](../../src/modules/users/user.routes.ts)
- [src/modules/posts/post.controller.ts](../../src/modules/posts/post.controller.ts)
- [src/modules/posts/post.service.ts](../../src/modules/posts/post.service.ts)
- [src/modules/posts/post.model.ts](../../src/modules/posts/post.model.ts)
