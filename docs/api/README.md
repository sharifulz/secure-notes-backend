# API endpoint guide — read in order

This guide explains the actual implementation of all **18 application/health HTTP endpoints**. It includes request validation, middleware order, query filters/indexes, transaction/aggregation logic, and how response statuses/messages are constructed. Examples use placeholder IDs and demo input, not live account credentials. Public Swagger infrastructure is described separately in [SWAGGER.md](../SWAGGER.md).

Start with [00 — Shared flow, validation, and responses](00-shared-flow.md). Then follow the endpoint files in sequence below. Each file links back to its exact source files.

For one Markdown document containing the entire explanation, open [API-WALKTHROUGH.md](../API-WALKTHROUGH.md).

## Suggested testing sequence

1. Check health, register a USER, log in, and read the profile.
2. Create a note and save its returned ID. List/read/edit/delete your own notes.
3. Log in as an existing ADMIN to exercise the admin endpoints; registration cannot promote you.
4. Add a disposable user, read/edit it, and delete it while it owns no content.
5. Inspect interest groups, create a post, and fetch that author's posts without a token.

## Endpoint files

| Order | Method | Path | Access | Explanation |
| --- | --- | --- | --- | --- |
| 01 | GET | `/health` | Public | [Check process liveness](01-health.md) |
| 02 | POST | `/api/v1/auth/register` | Public | [Register an ordinary user](02-register.md) |
| 03 | POST | `/api/v1/auth/login` | Public | [Verify a password and issue a JWT](03-login.md) |
| 04 | GET | `/api/v1/auth/me` | Authenticated / ownership rules | [Read the authenticated profile](04-my-profile.md) |
| 05 | GET | `/api/v1/notes` | Authenticated / ownership rules | [List only your own notes](05-list-own-notes.md) |
| 06 | POST | `/api/v1/notes` | Authenticated / ownership rules | [Create a private note](06-create-note.md) |
| 07 | GET | `/api/v1/notes/:id` | Authenticated / ownership rules | [Read one note with ownership rules](07-read-note.md) |
| 08 | PATCH | `/api/v1/notes/:id` | Authenticated / ownership rules | [Update a note you own](08-update-note.md) |
| 09 | DELETE | `/api/v1/notes/:id` | Authenticated / ownership rules | [Delete a note you own](09-delete-note.md) |
| 10 | GET | `/api/v1/admin/notes` | ADMIN | [Admin view of everyone’s notes](10-list-all-notes.md) |
| 11 | GET | `/api/v1/users` | ADMIN | [List accounts as an admin](11-list-users.md) |
| 12 | POST | `/api/v1/users` | ADMIN | [Admin creates an account](12-create-user.md) |
| 13 | GET | `/api/v1/users/:id` | ADMIN | [Read one user as an admin](13-read-user.md) |
| 14 | PATCH | `/api/v1/users/:id` | ADMIN | [Update a profile, role, or password as an admin](14-update-user.md) |
| 15 | DELETE | `/api/v1/users/:id` | ADMIN | [Remove an account without orphaning its content](15-delete-user.md) |
| 16 | GET | `/api/v1/users/group-by-interests` | ADMIN | [Group users by interest using one collection.aggregate call](16-users-by-interest.md) |
| 17 | POST | `/api/v1/posts` | Authenticated / ownership rules | [Create a public post](17-create-post.md) |
| 18 | GET | `/api/v1/users/:id/posts` | Public | [Retrieve public posts using a single lookup aggregation](18-list-user-posts.md) |

## Scope

These are HTTP business/liveness endpoints declared in the current route source. Framework-generated HEAD handling and CORS OPTIONS are not additional business APIs. There is no implemented refresh-token, global posts list, post update/delete, or logout endpoint. Frontend logout clears its in-memory token. Seed/index scripts and direct mongosh operations are not REST endpoints.

This is documentation of existing behavior, not a change to permissions, data, validation, or response messages.
