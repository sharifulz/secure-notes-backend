# Secure Notes API — complete implementation walkthrough

All 18 declared endpoints, in sequence. For separate endpoint files, use the [numbered index](api/README.md).

## 00 — Shared request flow, validation, queries, and responses

Read this before the numbered endpoint files. The explanations describe the current source code; request/response examples contain illustrative values, not a promise about existing accounts or data. Replace `<token>`, `<user-id>`, `<note-id>`, and `<post-id>` with real values from your responses. IDs must be 24 hexadecimal characters when sent in paths.

### Base URLs and normal sequence

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

### App-wide middleware, in actual order

In [app.ts](../src/app.ts):

1. Disable x-powered-by and configure proxy trust (`TRUST_PROXY=loopback` only for a trusted local proxy; otherwise off).
2. Helmet adds security headers; CORS sets the allowed frontend origin. CORS is a browser rule, not a replacement for JWT authorization. Its preflight handling is infrastructure behavior, not a separate business API.
3. Rate limiting allows 200 requests per minute per resolved client IP. Exceeding it returns 429 with `{"success":false,"message":"Too many requests"}`.
4. `express.json({ limit: '128kb' })` parses JSON before route authentication/validation. Oversized bodies produce 413; malformed JSON produces 400.
5. Feature routes run. Unmatched routes receive 404 with `Route not found`.
6. `errorHandler` formats thrown errors.

Register/login have an additional shared limiter of 20 attempts per 15 minutes per client IP, including successful requests and validation failures. The limiter is shared by those two routes; `/auth/me` does not use it. Its 429 message is `Too many authentication attempts; try again later`.

The 128 KiB body limit counts the serialized request bytes. It can reject large multibyte input before a field's character limit is reached.

### JWT authentication and roles

[authenticate](../src/middlewares/auth.ts) performs these steps for protected routes:

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

### Validation methods: what each one does

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

Sources: [shared fields](../src/utils/validation.ts), [pagination](../src/utils/pagination.ts), [user schemas](../src/modules/users/user.validation.ts), [note schemas](../src/modules/notes/note.validation.ts), [body middleware](../src/middlewares/validate.ts).

Zod is the request boundary. Mongoose schemas independently enforce stored-document rules. Creates validate documents; updates here explicitly use `runValidators: true` where profile/note data is updated. Bcrypt hashes passwords with cost 12; `bcrypt.compare` verifies them. A null passwordHash cannot authenticate. Mongoose `unique` behavior here comes from the explicit MongoDB email index, not a Zod email-existence check.

Only endpoints that attach body validation validate business body fields. Read/delete endpoints do not automatically reject every unused body/query field; list routes do validate query objects strictly. Global JSON parsing still runs where applicable.

### Query vocabulary

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

### Pagination and indexes

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

### Where responses and messages are set

Successful resource controllers typically use:

```typescript
res.status(201).json({ success: true, data: result }); // creates
res.json({ success: true, data: result });             // default 200
res.json(paginatedResult);                            // lists, default 200
res.status(204).end();                                // deletion, no JSON
```

There is **no generic success `message` field** in the current API. The frontend may display its own text such as “Note created”; that is not a backend response property.

For failures, Zod or a service throws an error. [errorHandler](../src/middlewares/errors.ts) selects the HTTP status and JSON shape. Service/controller `ApiError` messages are copied into the body; raw unexpected errors are not returned to the client.

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

## 01 — GET /health

Check process liveness

**Access:** Public; no token required.

**Reading context:** [Shared request/validation/response behavior](api/00-shared-flow.md). Protected endpoints also perform the authentication lookup described there.

### Request

```http
GET /health
```

### 1. Route-to-controller-to-service sequence

1. Express matches this handler directly in `app.ts`; no feature controller or service is involved.
2. It immediately returns a fixed JSON response.

### 2. Validation methods and rules

- No endpoint-specific body, path, or query schema. Global middleware still applies.

Global JSON parsing, rate limits, authentication errors, and schema error formatting are covered in the shared guide. The request body/schema step occurs at the point shown in the route sequence above.

### 3. Database operations and why they work

```typescript
// No database query is executed.
```

- This is a liveness check, not a database readiness query. Startup initially awaits the database connection, but a later connection loss is not detected by this endpoint.

### 4. How the controller sets the response

```typescript
res.json({ success: true, data: { status: 'ok' } });
```

**HTTP status: 200.**

Illustrative response; IDs, timestamps, JWTs, and counts are dynamic:

```json
{
  "success": true,
  "data": {
    "status": "ok"
  }
}
```

The controller/pagination helper supplies `success` and `data`. It does not supply a success-message string.

### 5. Endpoint-specific failures

This handler has no additional business-error message beyond the shared middleware behavior.

See the shared guide for general 400/401/413/429/500 handling. Errors are formatted centrally; a successful response body is not reused for failure.

### Source files

- [src/app.ts](../src/app.ts)

---

## 02 — POST /api/v1/auth/register

Register an ordinary user

**Access:** Public; never grants admin access.

**Reading context:** [Shared request/validation/response behavior](api/00-shared-flow.md). Protected endpoints also perform the authentication lookup described there.

### Request

```http
POST /api/v1/auth/register
Content-Type: application/json
```

```json
{
  "name": "Amina",
  "email": "amina@example.com",
  "password": "ExamplePass123!",
  "interests": [
    "chess",
    "reading"
  ]
}
```

### 1. Route-to-controller-to-service sequence

1. `authRouter.post("/register", limiter, validateBody(registerSchema), controller.register)` runs the authentication rate limiter before body validation.
2. `validateBody` replaces `req.body` with Zod’s parsed/normalized result.
3. The controller calls `auth.service.register(req.body)`.
4. The service hashes the password, creates the account with an explicit USER role, and rereads the profile for the response.

### 2. Validation methods and rules

- **name**: required string; trimmed; 1–100 characters after trimming.
- **email**: required email string; the shared schema applies email-format validation, trimming, and lowercase normalization. Send an already-trimmed address; do not assume leading/trailing whitespace is accepted by the current validation order.
- **password**: required string; at least 12 and at most 72 characters, plus a custom check that UTF-8 encoding is at most 72 bytes. It is not trimmed.
- **interests**: optional for creation, default `[]`; at most 30 strings, each trimmed/lowercased and 1–50 characters. Duplicate normalized values are removed.
- **Extra fields**: rejected by `.strict()`, not silently accepted.
- **role**: not part of the registration schema. Sending it is a 400 validation failure, even if its value is `USER`.

Global JSON parsing, rate limits, authentication errors, and schema error formatting are covered in the shared guide. The request body/schema step occurs at the point shown in the route sequence above.

### 3. Database operations and why they work

```typescript
const { password, ...profile } = input;
const user = await User.create({
  ...profile,
  role: 'USER',
  passwordHash: await hashPassword(password)
});
return User.findById(user._id).lean();
```

- `hashPassword` uses bcrypt cost 12. Plaintext `password` is removed before insertion; `passwordHash` is stored instead.
- There is no preliminary email-existence query. The unique `{ email: 1 }` index enforces uniqueness atomically; duplicate insertions raise MongoDB code 11000.
- The reread uses the built-in `_id` index. User schema `select: false` excludes `passwordHash` and `writeVersion` from that read.
- Registration returns a profile, not a JWT. Call the login endpoint next.

### 4. How the controller sets the response

```typescript
res.status(201).json({ success: true, data: await service.register(req.body) });
```

**HTTP status: 201.**

Illustrative response; IDs, timestamps, JWTs, and counts are dynamic:

```json
{
  "success": true,
  "data": {
    "_id": "<user-id>",
    "name": "Amina",
    "email": "amina@example.com",
    "role": "USER",
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

### 5. Endpoint-specific failures

| Status | Exact message | Cause |
| --- | --- | --- |
| 400 | Validation failed | Invalid fields or an unexpected field such as role. |
| 409 | Email is already registered | The unique email index rejected the insert. |
| 429 | Too many authentication attempts; try again later | Shared registration/login limiter exceeded. |

See the shared guide for general 400/401/413/429/500 handling. Errors are formatted centrally; a successful response body is not reused for failure.

### Source files

- [src/modules/auth/auth.routes.ts](../src/modules/auth/auth.routes.ts)
- [src/modules/auth/auth.controller.ts](../src/modules/auth/auth.controller.ts)
- [src/modules/auth/auth.service.ts](../src/modules/auth/auth.service.ts)
- [src/modules/users/user.validation.ts](../src/modules/users/user.validation.ts)
- [src/modules/users/user.model.ts](../src/modules/users/user.model.ts)
- [src/utils/password.ts](../src/utils/password.ts)

---

## 03 — POST /api/v1/auth/login

Verify a password and issue a JWT

**Access:** Public; credentials must belong to an application user.

**Reading context:** [Shared request/validation/response behavior](api/00-shared-flow.md). Protected endpoints also perform the authentication lookup described there.

### Request

```http
POST /api/v1/auth/login
Content-Type: application/json
```

```json
{
  "email": "amina@example.com",
  "password": "ExamplePass123!"
}
```

### 1. Route-to-controller-to-service sequence

1. The shared auth rate limiter runs, then `validateBody(loginSchema)`.
2. The controller passes the normalized email and password to `service.login`.
3. The service fetches the account, compares the password with bcrypt, and signs a short-lived JWT on success.

### 2. Validation methods and rules

- `loginSchema` is a strict object containing only `email` and `password`.
- Email uses the shared format/normalization schema. Password requires 1–72 characters and at most 72 UTF-8 bytes.
- Login permits passwords shorter than registration’s 12-character minimum so verification does not depend on creation-policy validation. The actual stored bcrypt hash must still match.

Global JSON parsing, rate limits, authentication errors, and schema error formatting are covered in the shared guide. The request body/schema step occurs at the point shown in the route sequence above.

### 3. Database operations and why they work

```typescript
const user = await User.findOne({ email }).select('+passwordHash');
const valid = await verifyPassword(password, user?.passwordHash || await dummyHash);
if (!valid || !user?.passwordHash) {
  throw new ApiError(401, 'Invalid email or password given, try again');
}
```

- `{ email: 1 }` supports the account lookup. `.select("+passwordHash")` explicitly includes a field hidden by default in the schema.
- `verifyPassword` is `bcrypt.compare(password, hash)`, not plaintext comparison and not decryption.
- Unknown users and sample accounts with a null hash are compared against a dummy bcrypt hash to reduce timing differences; both are rejected.
- The JWT uses HS256, `sub = user.id`, configured issuer/audience, and a 15-minute expiry. Role is not embedded in this token; protected middleware reads the current database role.
- No JWT/session document is inserted into MongoDB.

### 4. How the controller sets the response

```typescript
res.json({ success: true, data: await service.login(req.body.email, req.body.password) });
```

**HTTP status: 200.**

Illustrative response; IDs, timestamps, JWTs, and counts are dynamic:

```json
{
  "success": true,
  "data": {
    "accessToken": "<signed JWT>",
    "tokenType": "Bearer",
    "expiresIn": 900
  }
}
```

The controller/pagination helper supplies `success` and `data`. It does not supply a success-message string.

### 5. Endpoint-specific failures

| Status | Exact message | Cause |
| --- | --- | --- |
| 400 | Validation failed | Invalid email/password shape. |
| 401 | Invalid email or password given, try again | Wrong password, no user, or null passwordHash. |
| 429 | Too many authentication attempts; try again later | Shared authentication rate limiter exceeded. |

See the shared guide for general 400/401/413/429/500 handling. Errors are formatted centrally; a successful response body is not reused for failure.

### Source files

- [src/modules/auth/auth.routes.ts](../src/modules/auth/auth.routes.ts)
- [src/modules/auth/auth.validation.ts](../src/modules/auth/auth.validation.ts)
- [src/modules/auth/auth.controller.ts](../src/modules/auth/auth.controller.ts)
- [src/modules/auth/auth.service.ts](../src/modules/auth/auth.service.ts)
- [src/utils/password.ts](../src/utils/password.ts)

---

## 04 — GET /api/v1/auth/me

Read the authenticated profile

**Access:** USER or ADMIN with a valid Bearer JWT.

**Reading context:** [Shared request/validation/response behavior](api/00-shared-flow.md). Protected endpoints also perform the authentication lookup described there.

### Request

```http
GET /api/v1/auth/me
Authorization: Bearer <token>
```

### 1. Route-to-controller-to-service sequence

1. Authentication first loads the account’s role by token subject.
2. The `me` controller directly reads the profile. There is no separate me service function.
3. The controller returns the resulting plain object.

### 2. Validation methods and rules

- The route uses `authenticate`. This validates the Bearer header, JWT signature/claims, and existence of the subject account.
- No request body, client-supplied user ID, or pagination is required. The ID comes from `actor(req).id`.

Global JSON parsing, rate limits, authentication errors, and schema error formatting are covered in the shared guide. The request body/schema step occurs at the point shown in the route sequence above.

### 3. Database operations and why they work

```typescript
await User.findById(actor(req).id).lean();
```

- The built-in `_id` index supports both the authentication lookup and this profile read.
- `lean()` avoids constructing a full Mongoose document for a read-only result. Default schema projections exclude the hash and internal writeVersion.
- Normally there are two user reads: authentication and profile retrieval. If the account is deleted between them, this controller does not use `required()`, so its second read can return `data: null`.

### 4. How the controller sets the response

```typescript
res.json({ success: true, data: await User.findById(actor(req).id).lean() });
```

**HTTP status: 200.**

Illustrative response; IDs, timestamps, JWTs, and counts are dynamic:

```json
{
  "success": true,
  "data": {
    "_id": "<user-id>",
    "name": "Amina",
    "email": "amina@example.com",
    "role": "USER",
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

### 5. Endpoint-specific failures

This handler has no additional business-error message beyond the shared middleware behavior.

See the shared guide for general 400/401/413/429/500 handling. Errors are formatted centrally; a successful response body is not reused for failure.

### Source files

- [src/modules/auth/auth.routes.ts](../src/modules/auth/auth.routes.ts)
- [src/modules/auth/auth.controller.ts](../src/modules/auth/auth.controller.ts)
- [src/middlewares/auth.ts](../src/middlewares/auth.ts)
- [src/modules/users/user.model.ts](../src/modules/users/user.model.ts)

---

## 05 — GET /api/v1/notes

List only your own notes

**Access:** USER or ADMIN; this route always lists the caller’s own notes.

**Reading context:** [Shared request/validation/response behavior](api/00-shared-flow.md). Protected endpoints also perform the authentication lookup described there.

### Request

```http
GET /api/v1/notes?page=1&limit=10
Authorization: Bearer <token>
```

### 1. Route-to-controller-to-service sequence

1. `noteRouter.use(authenticate)` protects the route.
2. The controller parses pagination and calls `service.list(page, actor(req).id)`.
3. The service builds an owner filter, fetches the requested page, and counts matching notes in parallel.

### 2. Validation methods and rules

- `paginationSchema.parse(req.query)` accepts only `page` and `limit`; unexpected query keys are rejected.
- `page`: default 1, integer 1–100000. `limit`: default 10, integer 1–100. HTTP strings must contain digits only, then are coerced to numbers.
- `offset(page)` calculates `(page.page - 1) * page.limit`. Sorting is fixed by the service rather than accepted from the client.

Global JSON parsing, rate limits, authentication errors, and schema error formatting are covered in the shared guide. The request body/schema step occurs at the point shown in the route sequence above.

### 3. Database operations and why they work

```typescript
const filter = { ownerId: authenticatedUserId };
const [data, total] = await Promise.all([
  Note.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .skip((page - 1) * limit).limit(limit).lean(),
  Note.countDocuments(filter)
]);
```

- The owner ID is supplied by authentication, not by a request query parameter.
- The compound `{ ownerId: 1, createdAt: -1, _id: -1 }` index supports owner matching and fixed sorting.
- The count uses the same owner filter. Page and count are separate reads, not one snapshot, so they can differ briefly during concurrent writes.
- An empty list is 200 with `data: []`, `total: 0`, `totalPages: 0`, and `hasNext: false`; it is not a 404.

### 4. How the controller sets the response

```typescript
res.json(await service.list(paginationSchema.parse(req.query), actor(req).id));
```

**HTTP status: 200.**

Illustrative response; IDs, timestamps, JWTs, and counts are dynamic:

```json
{
  "success": true,
  "data": [
    {
      "_id": "<note-id>",
      "ownerId": "<user-id>",
      "title": "Index practice",
      "content": "Study compound indexes.",
      "createdAt": "<ISO timestamp>",
      "updatedAt": "<ISO timestamp>"
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

### 5. Endpoint-specific failures

| Status | Exact message | Cause |
| --- | --- | --- |
| 400 | Validation failed | Invalid page/limit or an unexpected query parameter. |

See the shared guide for general 400/401/413/429/500 handling. Errors are formatted centrally; a successful response body is not reused for failure.

### Source files

- [src/modules/notes/note.routes.ts](../src/modules/notes/note.routes.ts)
- [src/modules/notes/note.controller.ts](../src/modules/notes/note.controller.ts)
- [src/modules/notes/note.service.ts](../src/modules/notes/note.service.ts)
- [src/modules/notes/note.model.ts](../src/modules/notes/note.model.ts)
- [src/utils/pagination.ts](../src/utils/pagination.ts)

---

## 06 — POST /api/v1/notes

Create a private note

**Access:** USER or ADMIN; the caller becomes the owner.

**Reading context:** [Shared request/validation/response behavior](api/00-shared-flow.md). Protected endpoints also perform the authentication lookup described there.

### Request

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

### 1. Route-to-controller-to-service sequence

1. Authentication runs first, then `validateBody(createNoteSchema)`.
2. The controller passes the parsed content and `actor(req).id` to the service.
3. `withAccountWrite` starts a MongoDB transaction and updates the owner document as a write lock.
4. The note is inserted in that same transaction.

### 2. Validation methods and rules

- **title**: required string, trimmed, 1–200 characters.
- **content**: required string, 1–50,000 characters; not trimmed. A nonempty whitespace-only content string therefore passes this schema.
- **Extra fields**: rejected by `.strict()`. Ownership fields supplied by the client are not allowed.

Global JSON parsing, rate limits, authentication errors, and schema error formatting are covered in the shared guide. The request body/schema step occurs at the point shown in the route sequence above.

### 3. Database operations and why they work

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

### 4. How the controller sets the response

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

### 5. Endpoint-specific failures

| Status | Exact message | Cause |
| --- | --- | --- |
| 400 | Validation failed | Invalid note body, including an attempted ownerId override. |
| 401 | Account no longer exists | Owner disappeared before the transaction lock. |
| 503 | This operation requires a MongoDB replica set | MongoDB code 20 is mapped to this message, commonly for standalone transaction failures. |

See the shared guide for general 400/401/413/429/500 handling. Errors are formatted centrally; a successful response body is not reused for failure.

### Source files

- [src/modules/notes/note.routes.ts](../src/modules/notes/note.routes.ts)
- [src/modules/notes/note.validation.ts](../src/modules/notes/note.validation.ts)
- [src/modules/notes/note.controller.ts](../src/modules/notes/note.controller.ts)
- [src/modules/notes/note.service.ts](../src/modules/notes/note.service.ts)
- [src/utils/account-write.ts](../src/utils/account-write.ts)
- [src/modules/notes/note.model.ts](../src/modules/notes/note.model.ts)

---

## 07 — GET /api/v1/notes/:id

Read one note with ownership rules

**Access:** USER: own note only. ADMIN: any note.

**Reading context:** [Shared request/validation/response behavior](api/00-shared-flow.md). Protected endpoints also perform the authentication lookup described there.

### Request

```http
GET /api/v1/notes/<note-id>
Authorization: Bearer <token>
```

### 1. Route-to-controller-to-service sequence

1. Authentication attaches the current role and user ID.
2. The controller parses the note ID and passes `actor(req)` to `service.get`.
3. The service conditionally includes an ownership filter and requires a matching result.

### 2. Validation methods and rules

- **id**: `objectId.parse(req.params.id)` accepts exactly 24 hexadecimal characters, using `/^[a-fA-F0-9]{24}$/`. Invalid IDs produce a Zod validation error before the business query.
- For ordinary Mongoose queries, Mongoose casts the validated string to `ObjectId`. Aggregation pipelines need explicit casting, as explained for the posts lookup.

Global JSON parsing, rate limits, authentication errors, and schema error formatting are covered in the shared guide. The request body/schema step occurs at the point shown in the route sequence above.

### 3. Database operations and why they work

```typescript
required(await Note.findOne({
  _id: id,
  ...(user.role === 'ADMIN' ? {} : { ownerId: user.id })
}).lean(), 'Note not found');
```

- The built-in `_id` index narrows the query to at most one document; ownership is checked on that candidate. A separate `_id + ownerId` index is not necessary.
- Admins omit the owner condition for this read only. Regular users cannot use the URL to read someone else’s note.
- `required()` raises 404 for null. Missing and inaccessible notes deliberately produce the same message.

### 4. How the controller sets the response

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

### 5. Endpoint-specific failures

| Status | Exact message | Cause |
| --- | --- | --- |
| 400 | Validation failed | Malformed note ID. |
| 404 | Note not found | No matching note or caller does not own it. |

See the shared guide for general 400/401/413/429/500 handling. Errors are formatted centrally; a successful response body is not reused for failure.

### Source files

- [src/modules/notes/note.routes.ts](../src/modules/notes/note.routes.ts)
- [src/modules/notes/note.controller.ts](../src/modules/notes/note.controller.ts)
- [src/modules/notes/note.service.ts](../src/modules/notes/note.service.ts)
- [src/utils/validation.ts](../src/utils/validation.ts)
- [src/utils/errors.ts](../src/utils/errors.ts)

---

## 08 — PATCH /api/v1/notes/:id

Update a note you own

**Access:** Owner only, including when the caller is ADMIN.

**Reading context:** [Shared request/validation/response behavior](api/00-shared-flow.md). Protected endpoints also perform the authentication lookup described there.

### Request

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

### 1. Route-to-controller-to-service sequence

1. After body validation, the controller parses the ID and passes it with the authenticated owner ID.
2. The service uses one atomic find-and-update with both ID and ownership in its filter.
3. A null result becomes a 404; a match returns the updated document.

### 2. Validation methods and rules

- The route first authenticates, then validates the body with `updateNoteSchema`.
- This schema is `createNoteSchema.partial()`: title/content are individually optional, but supplied values retain their original type/length rules.
- A `.refine(...)` check rejects an empty object with `At least one field is required`. `.strict()` rejects unknown fields and ownerId changes.
- **id**: `objectId.parse(req.params.id)` accepts exactly 24 hexadecimal characters, using `/^[a-fA-F0-9]{24}$/`. Invalid IDs produce a Zod validation error before the business query.
- For ordinary Mongoose queries, Mongoose casts the validated string to `ObjectId`. Aggregation pipelines need explicit casting, as explained for the posts lookup.

Global JSON parsing, rate limits, authentication errors, and schema error formatting are covered in the shared guide. The request body/schema step occurs at the point shown in the route sequence above.

### 3. Database operations and why they work

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

### 4. How the controller sets the response

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

### 5. Endpoint-specific failures

| Status | Exact message | Cause |
| --- | --- | --- |
| 400 | Validation failed | Invalid/empty update or invalid ID. |
| 404 | Note not found | Missing note or ownership mismatch. |

See the shared guide for general 400/401/413/429/500 handling. Errors are formatted centrally; a successful response body is not reused for failure.

### Source files

- [src/modules/notes/note.routes.ts](../src/modules/notes/note.routes.ts)
- [src/modules/notes/note.validation.ts](../src/modules/notes/note.validation.ts)
- [src/modules/notes/note.controller.ts](../src/modules/notes/note.controller.ts)
- [src/modules/notes/note.service.ts](../src/modules/notes/note.service.ts)

---

## 09 — DELETE /api/v1/notes/:id

Delete a note you own

**Access:** Owner only, including when the caller is ADMIN.

**Reading context:** [Shared request/validation/response behavior](api/00-shared-flow.md). Protected endpoints also perform the authentication lookup described there.

### Request

```http
DELETE /api/v1/notes/<note-id>
Authorization: Bearer <token>
```

### 1. Route-to-controller-to-service sequence

1. The controller parses the ID and obtains the authenticated owner ID.
2. The service atomically matches and deletes the note.
3. The controller waits for completion and ends the response without JSON.

### 2. Validation methods and rules

- **id**: `objectId.parse(req.params.id)` accepts exactly 24 hexadecimal characters, using `/^[a-fA-F0-9]{24}$/`. Invalid IDs produce a Zod validation error before the business query.
- For ordinary Mongoose queries, Mongoose casts the validated string to `ObjectId`. Aggregation pipelines need explicit casting, as explained for the posts lookup.
- No endpoint-specific body schema is attached; no body is needed.

Global JSON parsing, rate limits, authentication errors, and schema error formatting are covered in the shared guide. The request body/schema step occurs at the point shown in the route sequence above.

### 3. Database operations and why they work

```typescript
required(await Note.findOneAndDelete({ _id: id, ownerId }), 'Note not found');
```

- The built-in `_id` index supports the lookup; the owner condition prevents deleting another user’s note.
- The returned deleted document is used to detect whether anything matched, not sent back to the client.
- The result is 204 only if a matching note was deleted.

### 4. How the controller sets the response

```typescript
await service.remove(objectId.parse(req.params.id), actor(req).id);
res.status(204).end();
```

**HTTP status: 204.**

The successful response is empty. There is no JSON success flag, data object, or message for this 204 response.

### 5. Endpoint-specific failures

| Status | Exact message | Cause |
| --- | --- | --- |
| 400 | Validation failed | Malformed note ID. |
| 404 | Note not found | Missing note or ownership mismatch. |

See the shared guide for general 400/401/413/429/500 handling. Errors are formatted centrally; a successful response body is not reused for failure.

### Source files

- [src/modules/notes/note.routes.ts](../src/modules/notes/note.routes.ts)
- [src/modules/notes/note.controller.ts](../src/modules/notes/note.controller.ts)
- [src/modules/notes/note.service.ts](../src/modules/notes/note.service.ts)

---

## 10 — GET /api/v1/admin/notes

Admin view of everyone’s notes

**Access:** ADMIN only.

**Reading context:** [Shared request/validation/response behavior](api/00-shared-flow.md). Protected endpoints also perform the authentication lookup described there.

### Request

```http
GET /api/v1/admin/notes?page=1&limit=10
Authorization: Bearer <admin-token>
```

### 1. Route-to-controller-to-service sequence

1. The route is declared directly in `app.ts`: `authenticate`, then `requireAdmin`, then `listAll`.
2. The controller calls `service.list(page)` without an owner ID.
3. The shared list service uses an empty filter for both page data and count.

### 2. Validation methods and rules

- `paginationSchema.parse(req.query)` accepts only `page` and `limit`; unexpected query keys are rejected.
- `page`: default 1, integer 1–100000. `limit`: default 10, integer 1–100. HTTP strings must contain digits only, then are coerced to numbers.
- `offset(page)` calculates `(page.page - 1) * page.limit`. Sorting is fixed by the service rather than accepted from the client.

Global JSON parsing, rate limits, authentication errors, and schema error formatting are covered in the shared guide. The request body/schema step occurs at the point shown in the route sequence above.

### 3. Database operations and why they work

```typescript
const filter = {};
const [data, total] = await Promise.all([
  Note.find(filter).sort({ createdAt: -1, _id: -1 })
    .skip(skip).limit(limit).lean(),
  Note.countDocuments(filter)
]);
```

- Omitting ownerId is intentional only after admin authorization. This is what allows the all-notes view.
- `{ createdAt: -1, _id: -1 }` supports the fixed global ordering; the owner-first index alone would not support the same unrestricted sort.
- The unfiltered count is a separate operation and can require scanning documents; an index supporting the page sort does not make every count free.
- This endpoint grants read access, not editing/deletion of other users’ notes.

### 4. How the controller sets the response

```typescript
res.json(await service.list(paginationSchema.parse(req.query)));
```

**HTTP status: 200.**

Illustrative response; IDs, timestamps, JWTs, and counts are dynamic:

```json
{
  "success": true,
  "data": [
    {
      "_id": "<note-id>",
      "ownerId": "<user-id>",
      "title": "Index practice",
      "content": "Study compound indexes.",
      "createdAt": "<ISO timestamp>",
      "updatedAt": "<ISO timestamp>"
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

### 5. Endpoint-specific failures

| Status | Exact message | Cause |
| --- | --- | --- |
| 400 | Validation failed | Invalid pagination. |
| 403 | Admin access required | Authenticated caller is not ADMIN. |

See the shared guide for general 400/401/413/429/500 handling. Errors are formatted centrally; a successful response body is not reused for failure.

### Source files

- [src/app.ts](../src/app.ts)
- [src/middlewares/auth.ts](../src/middlewares/auth.ts)
- [src/modules/notes/note.controller.ts](../src/modules/notes/note.controller.ts)
- [src/modules/notes/note.service.ts](../src/modules/notes/note.service.ts)
- [src/modules/notes/note.model.ts](../src/modules/notes/note.model.ts)

---

## 11 — GET /api/v1/users

List accounts as an admin

**Access:** ADMIN only.

**Reading context:** [Shared request/validation/response behavior](api/00-shared-flow.md). Protected endpoints also perform the authentication lookup described there.

### Request

```http
GET /api/v1/users?page=1&limit=10
Authorization: Bearer <admin-token>
```

### 1. Route-to-controller-to-service sequence

1. The user router’s `use(authenticate, requireAdmin)` runs before this route.
2. The controller parses pagination and calls `service.list`.
3. The service fetches a page and the total user count in parallel.

### 2. Validation methods and rules

- `paginationSchema.parse(req.query)` accepts only `page` and `limit`; unexpected query keys are rejected.
- `page`: default 1, integer 1–100000. `limit`: default 10, integer 1–100. HTTP strings must contain digits only, then are coerced to numbers.
- `offset(page)` calculates `(page.page - 1) * page.limit`. Sorting is fixed by the service rather than accepted from the client.

Global JSON parsing, rate limits, authentication errors, and schema error formatting are covered in the shared guide. The request body/schema step occurs at the point shown in the route sequence above.

### 3. Database operations and why they work

```typescript
const [data, total] = await Promise.all([
  User.find().sort({ createdAt: -1, _id: -1 })
    .skip(skip).limit(limit).lean(),
  User.countDocuments()
]);
```

- The `{ createdAt: -1, _id: -1 }` user index supports the list ordering. The separate unfiltered count may scan; no role filter is applied.
- Default schema selection hides passwordHash and writeVersion for every returned user.
- This lists all roles. It does not accept arbitrary search, role, or sort query parameters because the pagination object is strict.

### 4. How the controller sets the response

```typescript
res.json(await service.list(paginationSchema.parse(req.query)));
```

**HTTP status: 200.**

Illustrative response; IDs, timestamps, JWTs, and counts are dynamic:

```json
{
  "success": true,
  "data": [
    {
      "_id": "<user-id>",
      "name": "Amina",
      "email": "amina@example.com",
      "role": "USER",
      "interests": [
        "chess",
        "reading"
      ],
      "createdAt": "<ISO timestamp>",
      "updatedAt": "<ISO timestamp>"
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

### 5. Endpoint-specific failures

| Status | Exact message | Cause |
| --- | --- | --- |
| 400 | Validation failed | Invalid or unexpected pagination query fields. |
| 403 | Admin access required | Ordinary user attempted user management. |

See the shared guide for general 400/401/413/429/500 handling. Errors are formatted centrally; a successful response body is not reused for failure.

### Source files

- [src/modules/users/user.routes.ts](../src/modules/users/user.routes.ts)
- [src/modules/users/user.controller.ts](../src/modules/users/user.controller.ts)
- [src/modules/users/user.service.ts](../src/modules/users/user.service.ts)
- [src/modules/users/user.model.ts](../src/modules/users/user.model.ts)

---

## 12 — POST /api/v1/users

Admin creates an account

**Access:** ADMIN only; may create USER or ADMIN accounts.

**Reading context:** [Shared request/validation/response behavior](api/00-shared-flow.md). Protected endpoints also perform the authentication lookup described there.

### Request

```http
POST /api/v1/users
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "name": "Amina",
  "email": "amina@example.com",
  "password": "ExamplePass123!",
  "interests": [
    "chess",
    "reading"
  ],
  "role": "USER"
}
```

### 1. Route-to-controller-to-service sequence

1. Authentication and requireAdmin run before body validation.
2. `validateBody(createUserSchema)` supplies normalized fields and defaults.
3. The service removes password, hashes it, inserts the user, then calls `get(user.id)` to reread a safe response.

### 2. Validation methods and rules

- **name**: required string; trimmed; 1–100 characters after trimming.
- **email**: required email string; the shared schema applies email-format validation, trimming, and lowercase normalization. Send an already-trimmed address; do not assume leading/trailing whitespace is accepted by the current validation order.
- **password**: required string; at least 12 and at most 72 characters, plus a custom check that UTF-8 encoding is at most 72 bytes. It is not trimmed.
- **interests**: optional for creation, default `[]`; at most 30 strings, each trimmed/lowercased and 1–50 characters. Duplicate normalized values are removed.
- **Extra fields**: rejected by `.strict()`, not silently accepted.
- **role**: optional on this endpoint; enum `USER` or `ADMIN`, default `USER`. This differs from public registration, which rejects the field.

Global JSON parsing, rate limits, authentication errors, and schema error formatting are covered in the shared guide. The request body/schema step occurs at the point shown in the route sequence above.

### 3. Database operations and why they work

```typescript
const { password, ...profile } = input;
const user = await User.create({
  ...profile,
  passwordHash: await hashPassword(password)
});
return get(user.id);
// get(id) reads User.findById(id).lean() and applies required(..., 'User not found').
```

- The unique email index prevents duplicate accounts without a separate pre-check.
- The role comes from the admin-validated input. Password hashing uses bcrypt cost 12.
- The reread uses the built-in `_id` index and excludes hidden password/internal fields.
- This creation service does not wrap insertion and reread in a transaction; the deletion/demotion safeguards are part of changeAccount, not this function.

### 4. How the controller sets the response

```typescript
res.status(201).json({ success: true, data: await service.create(req.body) });
```

**HTTP status: 201.**

Illustrative response; IDs, timestamps, JWTs, and counts are dynamic:

```json
{
  "success": true,
  "data": {
    "_id": "<user-id>",
    "name": "Amina",
    "email": "amina@example.com",
    "role": "USER",
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

### 5. Endpoint-specific failures

| Status | Exact message | Cause |
| --- | --- | --- |
| 400 | Validation failed | Invalid body or role. |
| 403 | Admin access required | Caller is not ADMIN. |
| 409 | Email is already registered | Email unique index rejected the insert. |
| 404 | User not found | The service reread could not find the newly created account, for example after concurrent deletion. |

See the shared guide for general 400/401/413/429/500 handling. Errors are formatted centrally; a successful response body is not reused for failure.

### Source files

- [src/modules/users/user.routes.ts](../src/modules/users/user.routes.ts)
- [src/modules/users/user.validation.ts](../src/modules/users/user.validation.ts)
- [src/modules/users/user.controller.ts](../src/modules/users/user.controller.ts)
- [src/modules/users/user.service.ts](../src/modules/users/user.service.ts)
- [src/modules/users/user.model.ts](../src/modules/users/user.model.ts)

---

## 13 — GET /api/v1/users/:id

Read one user as an admin

**Access:** ADMIN only. Ordinary users read themselves through /auth/me.

**Reading context:** [Shared request/validation/response behavior](api/00-shared-flow.md). Protected endpoints also perform the authentication lookup described there.

### Request

```http
GET /api/v1/users/<user-id>
Authorization: Bearer <admin-token>
```

### 1. Route-to-controller-to-service sequence

1. The router authenticates and enforces ADMIN.
2. The controller validates the ID and calls `service.get`.
3. The service requires a matching user profile.

### 2. Validation methods and rules

- **id**: `objectId.parse(req.params.id)` accepts exactly 24 hexadecimal characters, using `/^[a-fA-F0-9]{24}$/`. Invalid IDs produce a Zod validation error before the business query.
- For ordinary Mongoose queries, Mongoose casts the validated string to `ObjectId`. Aggregation pipelines need explicit casting, as explained for the posts lookup.

Global JSON parsing, rate limits, authentication errors, and schema error formatting are covered in the shared guide. The request body/schema step occurs at the point shown in the route sequence above.

### 3. Database operations and why they work

```typescript
required(await User.findById(id).lean(), 'User not found');
```

- The built-in `_id` index supports this lookup.
- The result excludes passwordHash and writeVersion by default. It includes profile fields, role, interests, and timestamps.
- The literal `/group-by-interests` route is declared before `/:id`; otherwise the report name could be treated as an invalid user ID.

### 4. How the controller sets the response

```typescript
res.json({ success: true, data: await service.get(objectId.parse(req.params.id)) });
```

**HTTP status: 200.**

Illustrative response; IDs, timestamps, JWTs, and counts are dynamic:

```json
{
  "success": true,
  "data": {
    "_id": "<user-id>",
    "name": "Amina",
    "email": "amina@example.com",
    "role": "USER",
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

### 5. Endpoint-specific failures

| Status | Exact message | Cause |
| --- | --- | --- |
| 400 | Validation failed | Malformed user ID. |
| 403 | Admin access required | Caller is not ADMIN. |
| 404 | User not found | No account with that ID. |

See the shared guide for general 400/401/413/429/500 handling. Errors are formatted centrally; a successful response body is not reused for failure.

### Source files

- [src/modules/users/user.routes.ts](../src/modules/users/user.routes.ts)
- [src/modules/users/user.controller.ts](../src/modules/users/user.controller.ts)
- [src/modules/users/user.service.ts](../src/modules/users/user.service.ts)

---

## 14 — PATCH /api/v1/users/:id

Update a profile, role, or password as an admin

**Access:** ADMIN only.

**Reading context:** [Shared request/validation/response behavior](api/00-shared-flow.md). Protected endpoints also perform the authentication lookup described there.

### Request

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

### 1. Route-to-controller-to-service sequence

1. Authentication and ADMIN authorization run, then the body schema, then ID validation in the controller.
2. `service.update(id, changes)` delegates to `changeAccount(id, changes)`.
3. If supplied, the new password is hashed before the transaction begins.
4. The transaction locks the current admin set and the target account, prevents final-admin demotion, and performs a validated $set update.

### 2. Validation methods and rules

- `updateUserSchema` starts from the strict profile schema plus a USER/ADMIN role enum, then applies `.partial()`.
- All fields are optional individually; supplied fields retain the creation rules. Unlike createUserSchema, this update schema has no role/interests defaults that could change omitted fields.
- The nonempty-object `.refine(...)` rejects `{}` with `At least one field is required`.
- Omit password to keep the current hash. Sending an empty password does not mean keep it; it fails password validation.
- **id**: `objectId.parse(req.params.id)` accepts exactly 24 hexadecimal characters, using `/^[a-fA-F0-9]{24}$/`. Invalid IDs produce a Zod validation error before the business query.
- For ordinary Mongoose queries, Mongoose casts the validated string to `ObjectId`. Aggregation pipelines need explicit casting, as explained for the posts lookup.

Global JSON parsing, rate limits, authentication errors, and schema error formatting are covered in the shared guide. The request body/schema step occurs at the point shown in the route sequence above.

### 3. Database operations and why they work

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

### 4. How the controller sets the response

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

### 5. Endpoint-specific failures

| Status | Exact message | Cause |
| --- | --- | --- |
| 400 | Validation failed | Invalid ID, invalid field, empty body, or empty password. |
| 403 | Admin access required | Caller is not ADMIN. |
| 404 | User not found | Target is absent. |
| 409 | Cannot remove or demote the final admin | Attempted to demote the sole admin. |
| 409 | Email is already registered | Changed email conflicts with the unique index. |
| 503 | This operation requires a MongoDB replica set | Transaction operation raised code 20. |

See the shared guide for general 400/401/413/429/500 handling. Errors are formatted centrally; a successful response body is not reused for failure.

### Source files

- [src/modules/users/user.routes.ts](../src/modules/users/user.routes.ts)
- [src/modules/users/user.validation.ts](../src/modules/users/user.validation.ts)
- [src/modules/users/user.controller.ts](../src/modules/users/user.controller.ts)
- [src/modules/users/user.service.ts](../src/modules/users/user.service.ts)
- [src/utils/password.ts](../src/utils/password.ts)

---

## 15 — DELETE /api/v1/users/:id

Remove an account without orphaning its content

**Access:** ADMIN only.

**Reading context:** [Shared request/validation/response behavior](api/00-shared-flow.md). Protected endpoints also perform the authentication lookup described there.

### Request

```http
DELETE /api/v1/users/<user-id>
Authorization: Bearer <admin-token>
```

### 1. Route-to-controller-to-service sequence

1. The controller validates the target ID and calls `service.remove(id)`.
2. `remove` delegates to `changeAccount(id, null)`; null selects its deletion branch.
3. Within the transaction it locks admin documents and the target, protects the final admin, checks for owned notes/posts, and deletes only a content-free account.
4. The controller returns no response body.

### 2. Validation methods and rules

- **id**: `objectId.parse(req.params.id)` accepts exactly 24 hexadecimal characters, using `/^[a-fA-F0-9]{24}$/`. Invalid IDs produce a Zod validation error before the business query.
- For ordinary Mongoose queries, Mongoose casts the validated string to `ObjectId`. Aggregation pipelines need explicit casting, as explained for the posts lookup.
- No endpoint-specific body schema; no request body is needed.

Global JSON parsing, rate limits, authentication errors, and schema error formatting are covered in the shared guide. The request body/schema step occurs at the point shown in the route sequence above.

### 3. Database operations and why they work

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

### 4. How the controller sets the response

```typescript
await service.remove(objectId.parse(req.params.id));
res.status(204).end();
```

**HTTP status: 204.**

The successful response is empty. There is no JSON success flag, data object, or message for this 204 response.

### 5. Endpoint-specific failures

| Status | Exact message | Cause |
| --- | --- | --- |
| 400 | Validation failed | Malformed user ID. |
| 403 | Admin access required | Caller is not ADMIN. |
| 404 | User not found | Target is absent. |
| 409 | Cannot remove or demote the final admin | Target is the sole admin. |
| 409 | Cannot delete a user who owns notes or posts | Target still owns content. |
| 503 | This operation requires a MongoDB replica set | Transaction operation raised code 20. |

See the shared guide for general 400/401/413/429/500 handling. Errors are formatted centrally; a successful response body is not reused for failure.

### Source files

- [src/modules/users/user.routes.ts](../src/modules/users/user.routes.ts)
- [src/modules/users/user.controller.ts](../src/modules/users/user.controller.ts)
- [src/modules/users/user.service.ts](../src/modules/users/user.service.ts)
- [src/utils/account-write.ts](../src/utils/account-write.ts)

---

## 16 — GET /api/v1/users/group-by-interests

Group users by interest using one collection.aggregate call

**Access:** ADMIN only.

**Reading context:** [Shared request/validation/response behavior](api/00-shared-flow.md). Protected endpoints also perform the authentication lookup described there.

### Request

```http
GET /api/v1/users/group-by-interests?page=1&limit=10
Authorization: Bearer <admin-token>
```

### 1. Route-to-controller-to-service sequence

1. The literal report route is declared before the parameterized `/:id` route.
2. Authentication and requireAdmin run; the controller parses pagination.
3. The report service calls `User.collection.aggregate(...)` exactly once, consumes its cursor with `.toArray()`, then formats the result with `paginated`.

### 2. Validation methods and rules

- `paginationSchema.parse(req.query)` accepts only `page` and `limit`; unexpected query keys are rejected.
- `page`: default 1, integer 1–100000. `limit`: default 10, integer 1–100. HTTP strings must contain digits only, then are coerced to numbers.
- `offset(page)` calculates `(page.page - 1) * page.limit`. Sorting is fixed by the service rather than accepted from the client.

Global JSON parsing, rate limits, authentication errors, and schema error formatting are covered in the shared guide. The request body/schema step occurs at the point shown in the route sequence above.

### 3. Database operations and why they work

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

### 4. How the controller sets the response

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

### 5. Endpoint-specific failures

| Status | Exact message | Cause |
| --- | --- | --- |
| 400 | Validation failed | Invalid pagination. |
| 403 | Admin access required | Caller is not ADMIN. |
| 500 | Internal server error | Unexpected aggregation failures, including timeout errors not specially mapped by this implementation. |

See the shared guide for general 400/401/413/429/500 handling. Errors are formatted centrally; a successful response body is not reused for failure.

### Source files

- [src/modules/users/user.routes.ts](../src/modules/users/user.routes.ts)
- [src/modules/users/user.controller.ts](../src/modules/users/user.controller.ts)
- [src/modules/users/user.service.ts](../src/modules/users/user.service.ts)
- [src/utils/pagination.ts](../src/utils/pagination.ts)

---

## 17 — POST /api/v1/posts

Create a public post

**Access:** USER or ADMIN with a valid token. Reading posts is public.

**Reading context:** [Shared request/validation/response behavior](api/00-shared-flow.md). Protected endpoints also perform the authentication lookup described there.

### Request

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

### 1. Route-to-controller-to-service sequence

1. The route authenticates, then applies `validateBody(createPostSchema)`.
2. `post.validation.ts` re-exports the note creation schema under the name createPostSchema, so title/content validation is identical.
3. The controller supplies the authenticated ID as authorId.
4. The service inserts the post inside `withAccountWrite`, locking its author account first.

### 2. Validation methods and rules

- **title**: required string, trimmed, 1–200 characters.
- **content**: required string, 1–50,000 characters; not trimmed. A nonempty whitespace-only content string therefore passes this schema.
- **Extra fields**: rejected by `.strict()`. Ownership fields supplied by the client are not allowed.

Global JSON parsing, rate limits, authentication errors, and schema error formatting are covered in the shared guide. The request body/schema step occurs at the point shown in the route sequence above.

### 3. Database operations and why they work

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

### 4. How the controller sets the response

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

### 5. Endpoint-specific failures

| Status | Exact message | Cause |
| --- | --- | --- |
| 400 | Validation failed | Invalid title/content or unexpected authorId field. |
| 401 | Account no longer exists | Author disappeared before the transaction lock. |
| 503 | This operation requires a MongoDB replica set | Transaction operation raised code 20. |

See the shared guide for general 400/401/413/429/500 handling. Errors are formatted centrally; a successful response body is not reused for failure.

### Source files

- [src/modules/posts/post.routes.ts](../src/modules/posts/post.routes.ts)
- [src/modules/posts/post.validation.ts](../src/modules/posts/post.validation.ts)
- [src/modules/posts/post.controller.ts](../src/modules/posts/post.controller.ts)
- [src/modules/posts/post.service.ts](../src/modules/posts/post.service.ts)
- [src/modules/posts/post.model.ts](../src/modules/posts/post.model.ts)
- [src/utils/account-write.ts](../src/utils/account-write.ts)

---

## 18 — GET /api/v1/users/:id/posts

Retrieve public posts using a single lookup aggregation

**Access:** Public; no JWT required, even though the URL starts with /users.

**Reading context:** [Shared request/validation/response behavior](api/00-shared-flow.md). Protected endpoints also perform the authentication lookup described there.

### Request

```http
GET /api/v1/users/<user-id>/posts?page=1&limit=10
```

### 1. Route-to-controller-to-service sequence

1. The user router declares `get("/:id/posts", byUser)` before `use(authenticate, requireAdmin)`, so this route finishes without the admin middleware.
2. The post controller validates the user ID, then pagination, and calls `service.byUser`.
3. The service performs one User.aggregate pipeline containing $lookup, then builds a paginated response with author information.

### 2. Validation methods and rules

- **id**: `objectId.parse(req.params.id)` accepts exactly 24 hexadecimal characters, using `/^[a-fA-F0-9]{24}$/`. Invalid IDs produce a Zod validation error before the business query.
- For ordinary Mongoose queries, Mongoose casts the validated string to `ObjectId`. Aggregation pipelines need explicit casting, as explained for the posts lookup.
- `paginationSchema.parse(req.query)` accepts only `page` and `limit`; unexpected query keys are rejected.
- `page`: default 1, integer 1–100000. `limit`: default 10, integer 1–100. HTTP strings must contain digits only, then are coerced to numbers.
- `offset(page)` calculates `(page.page - 1) * page.limit`. Sorting is fixed by the service rather than accepted from the client.

Global JSON parsing, rate limits, authentication errors, and schema error formatting are covered in the shared guide. The request body/schema step occurs at the point shown in the route sequence above.

### 3. Database operations and why they work

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

### 4. How the controller sets the response

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

### 5. Endpoint-specific failures

| Status | Exact message | Cause |
| --- | --- | --- |
| 400 | Validation failed | Invalid user ID, pagination, or unexpected query fields. |
| 404 | User not found | The author does not exist. |

See the shared guide for general 400/401/413/429/500 handling. Errors are formatted centrally; a successful response body is not reused for failure.

### Source files

- [src/modules/users/user.routes.ts](../src/modules/users/user.routes.ts)
- [src/modules/posts/post.controller.ts](../src/modules/posts/post.controller.ts)
- [src/modules/posts/post.service.ts](../src/modules/posts/post.service.ts)
- [src/modules/posts/post.model.ts](../src/modules/posts/post.model.ts)
