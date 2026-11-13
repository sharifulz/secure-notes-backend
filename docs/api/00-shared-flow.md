# 00 — Shared request flow, validation, queries, and responses

Read this before the numbered endpoint files. The explanations describe the current source code; request/response examples contain illustrative values, not a promise about existing accounts or data. Replace `<token>`, `<user-id>`, `<note-id>`, and `<post-id>` with real values from your responses. IDs must be 24 hexadecimal characters when sent in paths.

## Base URLs and normal sequence

- Deployed origin: `http://160.25.5.68` through Nginx.
- Deployed API prefix: `http://160.25.5.68/api/v1`.
- Desktop API prefix: `http://localhost:4000/api/v1`.
- `/health` is at the origin root, not under `/api/v1`.

Register a USER, log in, read `/auth/me`, and exercise that user's note endpoints. For admin endpoints, log in separately using an existing ADMIN account; registration cannot create an admin. Use the notes/users created in earlier steps to obtain IDs. Seeds and direct mongosh queries are not HTTP endpoints.

```text
Browser/Postman
  -> optional Nginx proxy
  -> Express app-wide middleware
  -> route middleware (authentication / admin check / body schema, if attached)
  -> controller (path/query parsing and HTTP response)
  -> service (business rules and MongoDB operations)
  -> Mongoose model / MongoDB
  -> controller response OR centralized error handler
```

Some endpoints are intentionally simpler: `/health` has no controller/service, and `/auth/me` queries from its controller. Express 5 forwards rejected async handler promises to the error middleware.

## App-wide middleware, in actual order

In [app.ts](../../src/app.ts):

1. Disable x-powered-by and configure proxy trust (`TRUST_PROXY=loopback` only for a trusted local proxy; otherwise off).
2. Helmet adds security headers; CORS sets the allowed frontend origin. CORS is a browser rule, not a replacement for JWT authorization. Its preflight handling is infrastructure behavior, not a separate business API.
3. Rate limiting allows 200 requests per minute per resolved client IP. Exceeding it returns 429 with `{"success":false,"message":"Too many requests"}`.
4. `express.json({ limit: '128kb' })` parses JSON before route authentication/validation. Oversized bodies produce 413; malformed JSON produces 400.
5. Feature routes run. Unmatched routes receive 404 with `Route not found`.
6. `errorHandler` formats thrown errors.

Register/login have an additional shared limiter of 20 attempts per 15 minutes per client IP, including successful requests and validation failures. The limiter is shared by those two routes; `/auth/me` does not use it. Its 429 message is `Too many authentication attempts; try again later`.

The 128 KiB body limit counts the serialized request bytes. It can reject large multibyte input before a field's character limit is reached.

## JWT authentication and roles

[authenticate](../../src/middlewares/auth.ts) performs these steps for protected routes:

```typescript
const match = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization ?? '');
// Verify HS256 signature, issuer, audience, expiry, a valid ObjectId sub, and exp.
const user = await User.findById(subject).select('role').lean();
req.user = { id: user._id.toString(), role: user.role };
```

The JWT secret and claims are checked on the server. The role is fetched from MongoDB each time; the role is not trusted from a form or from a stale JWT role claim. The auth query uses the user `_id` index. It is an additional read beyond the endpoint's business queries below.

`requireAdmin` throws `ApiError(403, 'Admin access required')` unless `req.user.role === 'ADMIN'`. The `actor(req)` helper retrieves the authenticated identity; it does not take an owner ID from the client.

| Situation | Status | Exact message |
| --- | --- | --- |
| Missing/malformed Bearer header | 401 | Authentication required |
| Bad signature, claims, or expired JWT | 401 | Invalid or expired token |
| JWT subject account was deleted | 401 | Account no longer exists |
| Authenticated USER calls an admin route | 403 | Admin access required |

Admins inherit access to authenticated routes, but note ownership rules still restrict their updates/deletions to their own notes. Role checks select who may call a route; ownership filters select which record that caller may access.

## Validation methods: what each one does

| Method | Purpose in this project |
| --- | --- |
| `schema.parse(value)` | Validate/transform input; return parsed output or throw ZodError. |
| `validateBody(schema)` | Assign `schema.parse(req.body)` back to req.body, then call next(). |
| `z.object({...}).strict()` | Enforce declared fields and reject unexpected keys. |
| `.trim()` / `.toLowerCase()` | Normalize strings at their position in the schema chain. |
| `.min()` / `.max()` | Bound strings/arrays; numerical bounds follow coercion for pagination. |
| `z.email()` | Validate an email address before the later trim/lowercase calls in the shared schema. |
| `z.enum(['USER', 'ADMIN'])` | Accept only those exact uppercase roles. |
| `.default(...)` | Supply a value when omitted, such as interests=[] or role=USER on creation. |
| `.partial()` | Make each declared update field optional while retaining its validation. |
| `.refine(...)` | Apply a custom condition, such as UTF-8 password bytes or a nonempty PATCH object. |
| `.transform(...)` | Remove duplicate normalized interests with a Set. |
| `.regex(...)` | Enforce ObjectId text shape or digits-only pagination strings. |
| `z.preprocess(...)` | Supply pagination defaults before validating the value. |
| `z.coerce.number()` | Turn accepted digit strings into numbers. |
| `.pipe(...)` | Pass successful validation output to the next schema. |
| `.int()` | Require whole-number pagination values. |

Sources: [shared fields](../../src/utils/validation.ts), [pagination](../../src/utils/pagination.ts), [user schemas](../../src/modules/users/user.validation.ts), [note schemas](../../src/modules/notes/note.validation.ts), [body middleware](../../src/middlewares/validate.ts).

Zod is the request boundary. Mongoose schemas independently enforce stored-document rules. Creates validate documents; updates here explicitly use `runValidators: true` where profile/note data is updated. Bcrypt hashes passwords with cost 12; `bcrypt.compare` verifies them. A null passwordHash cannot authenticate. Mongoose `unique` behavior here comes from the explicit MongoDB email index, not a Zod email-existence check.

Only endpoints that attach body validation validate business body fields. Read/delete endpoints do not automatically reject every unused body/query field; list routes do validate query objects strictly. Global JSON parsing still runs where applicable.

## Query vocabulary

| Method/operator | Meaning |
| --- | --- |
| `find(filter)` | Return matching documents, usually followed by list sort/pagination. |
| `findOne(filter)` / `findById(id)` | Return one document or null. |
| `create(...)` | Validate and insert document(s). |
| `countDocuments(filter)` | Count all matching documents, separate from fetching page data. |
| `findOneAndUpdate(...)` | Atomically match/update a document, including ownership in the same filter. |
| `findOneAndDelete(...)` / `deleteOne(...)` | Delete a matching document; service code decides what to return. |
| `exists(filter)` | Check whether at least one matching document exists. |
| `$set` | Replace only specified field values rather than the whole document. |
| `$inc` | Increment internal writeVersion to coordinate competing transactions. |
| `.lean()` | Return a plain object instead of a hydrated Mongoose document. |
| `.select('+passwordHash')` | Explicitly include a normally hidden field for password verification. |
| `.session(session)` | Run a query within the same MongoDB transaction. |

`required(result, message)` throws a 404 ApiError when result is null/undefined. It does not validate the request body.

Creation of notes/posts and updates/deletions of users use transactions. Their lock writes coordinate account deletion and content creation and protect the final admin under concurrency. Transactions require the configured replica set; a single-node replica set is sufficient. Internal lock updates also use Mongoose timestamps.

## Pagination and indexes

List defaults are page 1 and limit 10, with limit up to 100. Sorting for ordinary lists is `{ createdAt: -1, _id: -1 }`; _id breaks timestamp ties. Offset pagination is `(page - 1) * limit`. Concurrent inserts/deletes can shift later pages; this is not snapshot/cursor pagination.

`paginated(data, total, page)` returns:

```javascript
{
  success: true,
  data,
  pagination: {
    page: page.page,
    limit: page.limit,
    total,
    totalPages: Math.ceil(total / page.limit),
    hasNext: page.page * page.limit < total
  }
}
```

For zero results, totalPages is 0 and hasNext is false. Requesting a page beyond the last does not raise an error; it returns an empty data array with the requested page and the actual totals.

| Collection | Custom schema.index declaration | Main purpose |
| --- | --- | --- |
| users | `{ email: 1 }`, unique | Login lookup and atomic email uniqueness |
| users | `{ createdAt: -1, _id: -1 }` | Admin user-list ordering |
| notes | `{ ownerId: 1, createdAt: -1, _id: -1 }` | Own-note listing and owner existence check |
| notes | `{ createdAt: -1, _id: -1 }` | Admin all-note ordering |
| posts | `{ authorId: 1, createdAt: -1, _id: -1 }` | Author lookup/order and existence check |

Every collection also has MongoDB's built-in `_id` index. An index designed for a query does not guarantee the planner will choose it for every tiny dataset. Use explain with representative data. Unfiltered counts, role-lock writes, and full interest aggregation can still scan data. No extra interests/role/title index is added just to make a schema look indexed. Startup uses autoIndex=false/autoCreate=false and does not create/drop database indexes.

## Where responses and messages are set

Successful resource controllers typically use:

```typescript
res.status(201).json({ success: true, data: result }); // creates
res.json({ success: true, data: result });             // default 200
res.json(paginatedResult);                            // lists, default 200
res.status(204).end();                                // deletion, no JSON
```

There is **no generic success `message` field** in the current API. The frontend may display its own text such as “Note created”; that is not a backend response property.

For failures, Zod or a service throws an error. [errorHandler](../../src/middlewares/errors.ts) selects the HTTP status and JSON shape. Service/controller `ApiError` messages are copied into the body; raw unexpected errors are not returned to the client.

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    {
      "path": "title",
      "message": "Too small: expected string to have >=1 characters"
    }
  ]
}
```

The example issue depends on the violated rule. `errors` is generated with `error.issues.map(i => ({ path: i.path.join('.'), message: i.message }))`; an object-level issue can have an empty path.

| Error | HTTP status | Exact top-level message |
| --- | --- | --- |
| ZodError | 400 | Validation failed |
| ApiError | Its supplied status | Its supplied message |
| MongoDB duplicate-key code 11000 | 409 | Email is already registered |
| JSON body exceeds 128 KiB | 413 | Request body too large |
| Malformed JSON | 400 | Invalid JSON |
| Mongoose ValidationError or CastError | 400 | Invalid input |
| MongoDB code 20 | 503 | This operation requires a MongoDB replica set |
| Any unhandled failure | 500 | Internal server error |

Rate-limit responses and the final `Route not found` response are generated directly in middleware rather than thrown through this error handler. A 204 response has no message and no body; do not unconditionally call response.json() on successful DELETE.
