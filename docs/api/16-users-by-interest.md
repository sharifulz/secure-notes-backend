[Index](README.md) | [Previous](15-delete-user.md) | [Next](17-create-post.md)

# 16 — GET /api/v1/users/group-by-interests

Group users by interest using one collection.aggregate call

**Access:** ADMIN only.

**Reading context:** [Shared request/validation/response behavior](00-shared-flow.md). Protected endpoints also perform the authentication lookup described there.

## Request

```http
GET /api/v1/users/group-by-interests?page=1&limit=10
Authorization: Bearer <admin-token>
```

## 1. Route-to-controller-to-service sequence

1. The literal report route is declared before the parameterized `/:id` route.
2. Authentication and requireAdmin run; the controller parses pagination.
3. The report service calls `User.collection.aggregate(...)` exactly once, consumes its cursor with `.toArray()`, then formats the result with `paginated`.

## 2. Validation methods and rules

- `paginationSchema.parse(req.query)` accepts only `page` and `limit`; unexpected query keys are rejected.
- `page`: default 1, integer 1–100000. `limit`: default 10, integer 1–100. HTTP strings must contain digits only, then are coerced to numbers.
- `offset(page)` calculates `(page.page - 1) * page.limit`. Sorting is fixed by the service rather than accepted from the client.

Global JSON parsing, rate limits, authentication errors, and schema error formatting are covered in the shared guide. The request body/schema step occurs at the point shown in the route sequence above.

## 3. Database operations and why they work

```typescript
export async function groupedByInterests(page: Page) {
  // Exactly one collection.aggregate call; never follow with a separate count.
  const [result] = await User.collection.aggregate([
    { $project: { name: 1, email: 1, interests: { $setUnion: [{ $ifNull: ['$interests', []] }, []] } } },
    { $unwind: '$interests' },
    { $group: { _id: '$interests', totalUsers: { $sum: 1 }, users: {
      $push: { userId: '$_id', name: '$name', email: '$email' },
    } } },
    { $sort: { _id: 1 } },
    { $facet: {
      data: [
        { $skip: offset(page) }, { $limit: page.limit },
        { $project: { _id: 0, interest: '$_id', totalUsers: 1, users: 1 } },
      ],
      metadata: [{ $count: 'total' }],
    } },
  ], { maxTimeMS: 10000 }).toArray();
  return paginated(result?.data ?? [], result?.metadata?.[0]?.total ?? 0, page);
}
```

- `$project` retains only name/email/interests (and the default _id). `$ifNull` treats missing/null interests as []; `$setUnion` removes duplicate interests for each user before counting.
- `$unwind` emits one row per interest. Empty interest arrays produce no group membership.
- `$group` makes the interest string the group key, counts member rows, and pushes only userId/name/email into each group. A user with multiple interests appears in multiple groups.
- `$sort` orders groups alphabetically by their interest key.
- `$facet.data` skips/limits groups and renames _id to interest. `$facet.metadata` counts all groups before pagination. Pagination therefore counts interest groups, not users.
- The result is an array containing the facet document; the service destructures its first element and uses zero/empty fallbacks.
- `toArray()` consumes the aggregation cursor; it is not a second find/count/distinct query. The report has no separate countDocuments call.
- The report service uses exactly one collection.aggregate call. The protected HTTP request still has the normal authentication lookup before entering that service.
- Schema select:false is not applied automatically to raw collection aggregation. Explicit projections prevent password/internal fields from being exposed.
- An unfiltered unwind/group must process the relevant interests; no interests index can remove that work or supply the post-group sort. No unnecessary interests index is added.
- maxTimeMS is 10000. Large grouped arrays still face MongoDB document/aggregation limits; this is scoped to the assignment dataset.

## 4. How the controller sets the response

```typescript
res.json(await service.groupedByInterests(paginationSchema.parse(req.query)));
```

**HTTP status: 200.**

Illustrative response; IDs, timestamps, JWTs, and counts are dynamic:

```json
{
  "success": true,
  "data": [
    {
      "interest": "chess",
      "totalUsers": 1,
      "users": [
        {
          "userId": "<user-id>",
          "name": "Amina",
          "email": "amina@example.com"
        }
      ]
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
| 403 | Admin access required | Caller is not ADMIN. |
| 500 | Internal server error | Unexpected aggregation failures, including timeout errors not specially mapped by this implementation. |

See the shared guide for general 400/401/413/429/500 handling. Errors are formatted centrally; a successful response body is not reused for failure.

## Source files

- [src/modules/users/user.routes.ts](../../src/modules/users/user.routes.ts)
- [src/modules/users/user.controller.ts](../../src/modules/users/user.controller.ts)
- [src/modules/users/user.service.ts](../../src/modules/users/user.service.ts)
- [src/utils/pagination.ts](../../src/utils/pagination.ts)
