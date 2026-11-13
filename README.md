# Secure Notes API

## API documentation

- **Swagger UI:** [http://160.25.5.68/api/v1/docs/](http://160.25.5.68/api/v1/docs/) after deployment; works through the existing Nginx `/api/` route.
- **Local Swagger:** [http://localhost:4000/api/v1/docs/](http://localhost:4000/api/v1/docs/).
- **Setup and usage:** [docs/SWAGGER.md](docs/SWAGGER.md).
- **Detailed Markdown explanation:** [complete walkthrough](docs/API-WALKTHROUGH.md) or [one file per endpoint](docs/api/README.md).

Swagger groups all 18 application/health operations, explains request validation and response codes, and supports JWT authorization for interactive requests. Documentation is public; private APIs remain protected.

Backend implementation for the interview task, using Express 5, TypeScript, Mongoose, JWT, bcrypt, and Zod. The existing `secure_notes_setup.js` is preserved.

Current target: frontend and Express on **160.25.5.68**, with the existing MongoDB on **samiulenterprise.com** through a persistent SSH tunnel. See [combined deployment](deploy/combined/README.md) and build with `npm run package:combined`. This packages the sibling `SecureNoteFrontEnd` static files with a same-origin API default without editing their local source. The old single-server update guide remains in `deploy/README.md`. No MongoDB installation, initialization, or data migration is needed on the new VPS.

For later **backend-only updates**, run `npm run deploy` or `deploy-backend.cmd` from this folder. See [update instructions](deploy/UPDATE-BACKEND.md). The command tests/builds locally, uploads to 160.25.5.68, restarts only the API, and restores previous runtime files if activation fails. Server configuration and database data are preserved.

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

## Test users and role permissions

The following accounts are included in `secure_notes_setup.js`. Use them to verify that each role has the correct access:

| Name | Email | Role | Suggested demo password | What to test |
| --- | --- | --- | --- | --- |
| System Admin | `admin@notes.test` | `ADMIN` | `AdminDemo2026!` | Own note CRUD, all-notes view, and user management |
| Rahim Ahmed | `rahim@notes.test` | `USER` | `RahimDemo2026!` | Create, list, read, update, and delete own notes |
| Karim Hasan | `karim@notes.test` | `USER` | `KarimDemo2026!` | A second user's notes and cross-user access restrictions |
| Nabila Islam | `nabila@notes.test` | `USER` | `NabilaDemo2026!` | Additional note ownership and list-pagination checks |

**These passwords are examples, not verified passwords for the running database.** The database setup script creates null hashes, not these passwords. Initialize previously unset passwords below before using the suggested credentials. If an account already has a password, use its existing password or deliberately change it through the admin user-management screen. The seed commands refuse to overwrite existing hashes. Demo passwords are for a test environment, not production accounts.

### Initialize demo passwords from the desktop

From `E:\PROJECTS\MongoDb\SecureNotes` in PowerShell, with `.env` pointing to your intended test database and the database tunnel running if required:

```powershell
# Only run for accounts whose password hashes have not been initialized.
$env:SEED_ADMIN_EMAIL = "admin@notes.test"
$env:SEED_ADMIN_PASSWORD = "AdminDemo2026!"
npm run seed:admin
Remove-Item Env:SEED_ADMIN_EMAIL, Env:SEED_ADMIN_PASSWORD

$demoUsers = @(
    @{ Email = "rahim@notes.test"; Password = "RahimDemo2026!" },
    @{ Email = "karim@notes.test"; Password = "KarimDemo2026!" },
    @{ Email = "nabila@notes.test"; Password = "NabilaDemo2026!" }
)

foreach ($demoUser in $demoUsers) {
    $env:SEED_USER_EMAIL = $demoUser.Email
    $env:SEED_USER_PASSWORD = $demoUser.Password
    npm run seed:password
}
Remove-Item Env:SEED_USER_EMAIL, Env:SEED_USER_PASSWORD
```

Each successful command initializes only the specified account's password hash. It does not change roles, notes, or posts. If a command says a password is already set, the suggested password has not been applied to that account. Do not rerun the database setup script to reset passwords.

On a deployed server without development dependencies, use `node dist/scripts/seed-admin.js` or `node dist/scripts/seed-password.js` with the same environment variables instead of the `npm run seed:*` commands.

### User permission checks

Sign in as Rahim through the frontend, or obtain a JWT using `POST /auth/login`. The deployed API base is `http://160.25.5.68/api/v1`; for local development it is `http://localhost:4000/api/v1`.

| Test | Frontend action / API request | Expected result |
| --- | --- | --- |
| List own notes | My notes / `GET /notes?page=1&limit=2` | 200; only Rahim's notes, with pagination |
| Create a note | New note / `POST /notes` | 201; note owner is Rahim |
| Read own note | Read / `GET /notes/:id` | 200 for Rahim's note |
| Update own note | Edit / `PATCH /notes/:id` | 200; title/content updated |
| Delete own note | Delete / `DELETE /notes/:id` | 204; note removed |
| Access user management | `GET /users` | 403; admin navigation is hidden |
| Access everyone's notes | `GET /admin/notes` | 403 |

Create a temporary note as Rahim and save its ID. Sign out and sign in as Karim. Rahim's note must not appear in Karim's My notes list. Using Karim's token, attempt `GET`, `PATCH`, and `DELETE /notes/:id` with Rahim's note ID: all must return **404**, and Rahim's note must remain unchanged. Use separate browser profiles or separate Postman token variables when comparing accounts.

### Admin permission checks

Sign in as `admin@notes.test`:

| Test | Frontend action / API request | Expected result |
| --- | --- | --- |
| Manage own notes | My notes / own-note CRUD endpoints | Same abilities as an ordinary user |
| View everyone's notes | Everyone's notes / `GET /admin/notes?page=1&limit=2` | 200; notes belonging to all users, with pagination |
| Read another user's note | Read / `GET /notes/:id` | 200 |
| Edit/delete another user's note | `PATCH` or `DELETE /notes/:id` | 404; admin access to others' notes is read-only |
| List users | Manage users / `GET /users?page=1&limit=2` | 200; paginated accounts, without password hashes |
| Add a user | Add user / `POST /users` | 201 |
| View user details | Details / `GET /users/:id` | 200 |
| Update a user | Edit / `PATCH /users/:id` | 200; allowed profile, role, interests, or password changes |
| Remove a user | Delete / `DELETE /users/:id` | 204 when that user owns no notes or posts |

For the add/update/remove sequence, create a disposable account such as `temporary@notes.test` with role `USER` and a password of at least 12 characters. Change its name or interests, verify the update, then delete it before creating any content for that account. Deleting an account that owns content returns **409**; removing or demoting the final admin also returns **409**.

Finally, sign out and request a protected endpoint without a JWT: it must return **401**. User roles and ownership are enforced by the backend even if a client manually calls an admin endpoint.

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
