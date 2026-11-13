# Secure Notes API

Backend implementation for the interview task, using Express 5, TypeScript, Mongoose, JWT, bcrypt, and Zod. The existing `secure_notes_setup.js` is preserved.

Current target: frontend and Express on **160.25.5.68**, with the existing MongoDB on **samiulenterprise.com** through a persistent SSH tunnel. See [combined deployment](deploy/combined/README.md) and build with `npm run package:combined`. This packages the sibling `SecureNoteFrontEnd` static files with a same-origin API default without editing their local source. The old single-server update guide remains in `deploy/README.md`. No MongoDB installation, initialization, or data migration is needed on the new VPS.

## Start

Requires Node.js 22.12+ (tested here with Node 26), npm, and MongoDB 5.0+ running as a replica set. A single-node development replica set is sufficient. Content creation and admin account changes use transactions to prevent races with account deletion and to protect the final admin.

1. Run `npm install`.
2. Copy `.env.example` to `.env`. Set `MONGODB_URI` to your existing `secure_notes_db`, a random `JWT_SECRET` of at least 32 characters, and your frontend origin.
3. Your setup script has already created the collections and indexes; do not rerun it to start the backend.
4. Run `npm run indexes:check` to compare existing indexes with the Mongoose declarations. This command is read-only and exits nonzero on a mismatch. Startup never creates or drops indexes (`autoIndex: false`, `autoCreate: false`).
5. Initialize seed passwords as described below.
6. Run `npm run dev`. The default API URL is `http://localhost:4000/api/v1`.

For a production build, use `npm run build` followed by `npm start`. HTTPS can run directly using `TLS_PFX_PATH` and `TLS_PFX_PASSWORD`, or at a reverse proxy. Set both TLS variables to load a PKCS#12 file; omit both for HTTP. Invalid TLS configuration fails startup without falling back to HTTP. The app does not trust proxy headers by default; configure Express `trust proxy` for your actual deployment topology before deploying behind a proxy, so rate limiting uses the correct client address. See `deploy/README.md` for server installation and certificate permissions.

## Existing sample accounts

The database script intentionally leaves `passwordHash: null`. Such accounts cannot log in until a password is initialized. Password values are read from environment variables and are never printed.

In `.env`, temporarily set:

```dotenv
SEED_ADMIN_EMAIL=admin@notes.test
SEED_ADMIN_PASSWORD=choose-your-own-strong-password
```

Run `npm run seed:admin`. It initializes the existing admin's null hash or creates the first admin if absent. It refuses to overwrite an existing hash or promote an ordinary account.

For each other sample account, set `SEED_USER_EMAIL` and `SEED_USER_PASSWORD`, then run `npm run seed:password`. It only initializes null or missing hashes. Remove seed password variables afterward. These commands do not reset notes, posts, or indexes.

Passwords must be at least 12 characters and at most 72 UTF-8 bytes. Passwords are hashed with bcrypt cost 12. JWTs expire after 15 minutes; clients log in again after expiration. There is no refresh-token subsystem.

## API

Send JSON and use `Authorization: Bearer <accessToken>` on protected routes. IDs must be 24 hexadecimal characters. Public registration rejects extra fields, including `role`, and always creates `USER` accounts.

| Method | Path (under `/api/v1`) | Access |
| --- | --- | --- |
| POST | `/auth/register` | Public |
| POST | `/auth/login` | Public |
| GET | `/auth/me` | Authenticated |
| GET | `/users` | ADMIN |
| POST | `/users` | ADMIN |
| GET | `/users/group-by-interests` | ADMIN |
| GET | `/users/:id` | ADMIN |
| PATCH | `/users/:id` | ADMIN |
| DELETE | `/users/:id` | ADMIN |
| GET | `/users/:id/posts` | Public: original task says posts are visible to everyone |
| GET | `/notes` | Own notes |
| POST | `/notes` | Authenticated |
| GET | `/notes/:id` | Owner or ADMIN |
| PATCH | `/notes/:id` | Owner only, including for ADMIN |
| DELETE | `/notes/:id` | Owner only, including for ADMIN |
| GET | `/admin/notes` | ADMIN, all notes |
| POST | `/posts` | Authenticated |

`GET /health` is a process liveness endpoint, not a database readiness check.

### Example requests

Registration:

```json
{
  "name": "Amina",
  "email": "amina@example.com",
  "password": "YourStrongPassword123!",
  "interests": ["chess", "reading"]
}
```

Login accepts `email` and `password`. Its response includes `data.accessToken`, `tokenType`, and `expiresIn` (seconds).

Note/post creation accepts only `title` and `content`. Ownership always comes from the authenticated account. Notes accept partial title/content updates. Admin user creation additionally accepts `role`; admin updates accept any nonempty subset of name, email, password, interests, and role.

### Pagination and responses

All list routes accept `?page=1&limit=10`; limit is capped at 100 and page at 100000. Normal lists sort by `{ createdAt: -1, _id: -1 }`, matching the database script. Offset pages may shift when records are inserted or removed between requests. Data and counts on normal list routes are separate reads and can differ briefly during concurrent writes.

```json
{
  "success": true,
  "data": [],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 0,
    "totalPages": 0,
    "hasNext": false
  }
}
```

Single-resource responses contain `success` and `data`. Successful deletion returns HTTP 204 with no body. Errors contain `success: false` and a safe `message`; validation errors additionally include field paths. Unauthorized reads/writes of private notes return 404 to avoid disclosing note existence.

### Account lifecycle

Deleting users who own notes or posts returns 409. There is no implicit cascade. Their content must be removed through a separately authorized workflow before account removal; the minimal task API does not include post deletion. The final admin cannot be removed or demoted. Account changes and content creation use write locks inside MongoDB transactions so these rules also hold under concurrent requests. An internal, unindexed `writeVersion` field coordinates the locks and is excluded from API responses.

Protected requests read the user's current role from MongoDB. Existing JWTs therefore lose admin privileges after demotion and stop working after account deletion.

## Aggregation and indexing

All custom indexes use `schema.index(...)` with the exact names and keys from `secure_notes_setup.js`:

| Collection | Index | Supported operation |
| --- | --- | --- |
| users | `{ email: 1 }`, unique | Login, email uniqueness |
| users | `{ createdAt: -1, _id: -1 }` | Admin user listing |
| notes | `{ ownerId: 1, createdAt: -1, _id: -1 }` | Own notes, ownership existence checks |
| notes | `{ createdAt: -1, _id: -1 }` | Admin all-notes listing |
| posts | `{ authorId: 1, createdAt: -1, _id: -1 }` | User posts lookup, author existence checks |

Built-in `_id` indexes support profile, user detail, and single-note reads. No standalone owner, author, role, interest, or title indexes are added.

**Interest report:** exactly one `User.collection.aggregate(...)` call, with `$facet` for group pagination and total group count. Duplicate interests count each user once. Each group contains `interest`, `totalUsers`, and all member users' IDs, names, and emails, matching the supplied setup script. Pagination applies to groups, not users within a group. No separate find/count/distinct query is used. Full-dataset grouping must scan interests; an array index cannot eliminate this work. Large groups remain subject to MongoDB document and aggregation memory limits; this implementation is scoped to the assignment dataset. It has a ten-second execution limit.

**User posts:** one aggregation matches the user's indexed `_id` and uses `$lookup` with an author join, indexed newest-first sorting, and `$facet` for page data and total. Missing users return 404; existing users without posts return a successful empty page. Password hashes and private profile fields are never included.

## Verification

`npm run build` checks source types and produces `dist/`. `npm test` runs HTTP integration tests against a disposable single-node MongoDB replica set, never your application database. The first test run downloads a MongoDB binary via `mongodb-memory-server`; network access is required unless it is cached. To use an installed compatible binary, set `MONGOMS_SYSTEM_BINARY` to its absolute path. Tests cover JWT expiry, input validation, ownership, role changes, deletion, aggregation call constraints, index parity, and indexed notes sorting.

The feature modules live in `src/modules/{auth,users,notes,posts}`. Routes attach middleware, controllers handle HTTP input/output, services own database logic, and models declare schemas and indexes. The frontend is intentionally outside this backend-only implementation.
