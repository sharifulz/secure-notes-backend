[Index](README.md) | [Previous](13-read-user.md) | [Next](15-delete-user.md)

# 14 — PATCH /api/v1/users/:id

Update a profile, role, or password as an admin

**Access:** ADMIN only.

**Reading context:** [Shared request/validation/response behavior](00-shared-flow.md). Protected endpoints also perform the authentication lookup described there.

## Request

```http
PATCH /api/v1/users/:id
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "name": "Amina Updated",
  "role": "ADMIN"
}
```

## 1. Route-to-controller-to-service sequence

1. Authentication and ADMIN authorization run, then the body schema, then ID validation in the controller.
2. `service.update(id, changes)` delegates to `changeAccount(id, changes)`.
3. If supplied, the new password is hashed before the transaction begins.
4. The transaction locks the current admin set and the target account, prevents final-admin demotion, and performs a validated $set update.

## 2. Validation methods and rules

- `updateUserSchema` starts from the strict profile schema plus a USER/ADMIN role enum, then applies `.partial()`.
- All fields are optional individually; supplied fields retain the creation rules. Unlike createUserSchema, this update schema has no role/interests defaults that could change omitted fields.
- The nonempty-object `.refine(...)` rejects `{}` with `At least one field is required`.
- Omit password to keep the current hash. Sending an empty password does not mean keep it; it fails password validation.
- **id**: `objectId.parse(req.params.id)` accepts exactly 24 hexadecimal characters, using `/^[a-fA-F0-9]{24}$/`. Invalid IDs produce a Zod validation error before the business query.
- For ordinary Mongoose queries, Mongoose casts the validated string to `ObjectId`. Aggregation pipelines need explicit casting, as explained for the posts lookup.

Global JSON parsing, rate limits, authentication errors, and schema error formatting are covered in the shared guide. The request body/schema step occurs at the point shown in the route sequence above.

## 3. Database operations and why they work

```typescript
async function changeAccount(id: string, changes: UserChanges | null) {
  const passwordHash = changes?.password ? await hashPassword(changes.password) : undefined;
  return mongoose.connection.transaction(async session => {
    await User.updateMany({ role: 'ADMIN' }, { $inc: { writeVersion: 1 } }, { session });
    const user = required(await User.findByIdAndUpdate(id, { $inc: { writeVersion: 1 } }, { session, returnDocument: 'after' }), 'User not found');
    if (user.role === 'ADMIN' && (!changes || changes.role === 'USER')) {
      if (await User.countDocuments({ role: 'ADMIN' }).session(session) <= 1) throw new ApiError(409, 'Cannot remove or demote the final admin');
    }
    if (!changes) {
      const notes = await Note.exists({ ownerId: id }).session(session);
      const posts = await Post.exists({ authorId: id }).session(session);
      if (notes || posts) throw new ApiError(409, 'Cannot delete a user who owns notes or posts');
      await User.deleteOne({ _id: id }, { session }); return null;
    }
    const { password: _password, ...profile } = changes;
    return User.findByIdAndUpdate(id, { $set: { ...profile, ...(passwordHash ? { passwordHash } : {}) } }, { session, returnDocument: 'after', runValidators: true }).lean();
  });
}
```

- `User.updateMany({ role: "ADMIN" }, { $inc: { writeVersion: 1 } })` makes concurrent admin membership changes write the same admin documents. Conflicting transactions can be retried by the transaction helper.
- The target lookup uses its `_id` index. If the target is ADMIN and the requested role is USER, `countDocuments({ role: "ADMIN" })` must be greater than one.
- There is deliberately no extra role index; the role-filtered lock and count can scan users. This is a write/concurrency safeguard, not a free indexed list operation.
- `password` is removed from the update. Only passwordHash is saved when a new password was supplied.
- `returnDocument: "after"` returns the new profile; `runValidators: true` checks Mongoose update rules; `lean()` returns a plain object without normally hidden fields.
- Mongoose timestamps also apply to internal lock updates. An updatedAt change does not necessarily mean a profile field was manually edited.
- The next authenticated request reads the current database role, so demotion/promotion is not delayed until JWT expiration.

## 4. How the controller sets the response

```typescript
res.json({ success: true, data: await service.update(objectId.parse(req.params.id), req.body) });
```

**HTTP status: 200.**

Illustrative response; IDs, timestamps, JWTs, and counts are dynamic:

```json
{
  "success": true,
  "data": {
    "_id": "<user-id>",
    "name": "Amina Updated",
    "email": "amina@example.com",
    "role": "ADMIN",
    "interests": [
      "chess",
      "reading"
    ],
    "createdAt": "<ISO timestamp>",
    "updatedAt": "<ISO timestamp>"
  }
}
```

The controller/pagination helper supplies `success` and `data`. It does not supply a success-message string.

## 5. Endpoint-specific failures

| Status | Exact message | Cause |
| --- | --- | --- |
| 400 | Validation failed | Invalid ID, invalid field, empty body, or empty password. |
| 403 | Admin access required | Caller is not ADMIN. |
| 404 | User not found | Target is absent. |
| 409 | Cannot remove or demote the final admin | Attempted to demote the sole admin. |
| 409 | Email is already registered | Changed email conflicts with the unique index. |
| 503 | This operation requires a MongoDB replica set | Transaction operation raised code 20. |

See the shared guide for general 400/401/413/429/500 handling. Errors are formatted centrally; a successful response body is not reused for failure.

## Source files

- [src/modules/users/user.routes.ts](../../src/modules/users/user.routes.ts)
- [src/modules/users/user.validation.ts](../../src/modules/users/user.validation.ts)
- [src/modules/users/user.controller.ts](../../src/modules/users/user.controller.ts)
- [src/modules/users/user.service.ts](../../src/modules/users/user.service.ts)
- [src/utils/password.ts](../../src/utils/password.ts)
