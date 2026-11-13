type Schema = Record<string, unknown>;
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const parameter = (name: string) => ({ $ref: `#/components/parameters/${name}` });
const response = (name: string) => ({ $ref: `#/components/responses/${name}` });
const json = (schema: Schema) => ({ 'application/json': { schema } });
const envelope = (schema: Schema): Schema => ({
  type: 'object', required: ['success', 'data'],
  properties: { success: { type: 'boolean', enum: [true] }, data: schema },
});
const resource = (name: string) => envelope(ref(name));
const list = (name: string): Schema => ({
  type: 'object', required: ['success', 'data', 'pagination'],
  properties: {
    success: { type: 'boolean', enum: [true] },
    data: { type: 'array', items: ref(name) }, pagination: ref('Pagination'),
  },
});
const id: Schema = { type: 'string', pattern: '^[a-fA-F0-9]{24}$', example: '690000000000000000000002' };
const timestamp: Schema = { type: 'string', format: 'date-time' };
const name: Schema = { type: 'string', minLength: 1, maxLength: 100, example: 'Amina' };
const email: Schema = { type: 'string', format: 'email', example: 'amina@example.com', description: 'Send a trimmed address. Stored emails are lowercase.' };
const password: Schema = { type: 'string', format: 'password', minLength: 12, maxLength: 72, writeOnly: true, description: 'At least 12 characters and at most 72 UTF-8 bytes.', example: 'ExamplePass123!' };
const role: Schema = { type: 'string', enum: ['USER', 'ADMIN'], description: 'USER manages own notes; ADMIN also manages accounts and reads all notes.' };
const interests: Schema = { type: 'array', maxItems: 30, items: { type: 'string', minLength: 1, maxLength: 50 }, description: 'Trimmed and lowercased. Duplicate normalized interests are removed.', example: ['chess', 'reading'] };
const noteFields = {
  title: { type: 'string', minLength: 1, maxLength: 200, description: 'Trimmed, nonempty title.', example: 'Index practice' },
  content: { type: 'string', minLength: 1, maxLength: 50000, example: 'Study compound indexes.' },
};
const body = (properties: Schema, required: string[] = []): Schema => ({ type: 'object', additionalProperties: false, properties, ...(required.length ? { required } : {}) });
const paging = [parameter('Page'), parameter('Limit')];
const target = [parameter('Id')];

type OperationOptions = {
  public?: boolean; admin?: boolean; body?: string; result?: Schema; created?: boolean;
  empty?: boolean; parameters?: Schema[]; errors?: Record<string, string>; servers?: { url: string }[];
};
function operation(operationId: string, tag: string, summary: string, description: string, options: OperationOptions = {}) {
  const code = options.created ? '201' : options.empty ? '204' : '200';
  const responses: Record<string, unknown> = {
    [code]: options.empty ? { description: 'Deleted successfully. No response body.' } : {
      description: options.created ? 'Created successfully.' : 'Successful response.', content: json(options.result ?? resource('User')),
    },
    '429': response('RateLimited'),
    '500': response('ServerError'),
  };
  if (!options.public) responses['401'] = response('Unauthorized');
  if (options.admin) responses['403'] = response('Forbidden');
  if (options.body || options.parameters?.length) responses['400'] = response('ValidationFailed');
  if (options.body) responses['413'] = response('BodyTooLarge');
  for (const [status, description] of Object.entries(options.errors ?? {})) {
    responses[status] = { description, content: json(ref('Error')) };
  }
  return {
    operationId, tags: [tag], summary, description,
    ...(options.public ? { security: [] } : {}),
    ...(options.parameters ? { parameters: options.parameters } : {}),
    ...(options.body ? { requestBody: { required: true, content: json(ref(options.body)) } } : {}),
    ...(options.servers ? { servers: options.servers } : {}),
    responses,
  };
}

const missingNote = 'Note not found, or you do not own it.';
const duplicate = 'Email is already registered.';
const replicaSet = 'This operation requires a MongoDB replica set.';

export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'Secure Notes API', version: '1.0.0',
    description: [
      '**Private notes. Public ideas.** A simple API for notes, accounts, and public posts.',
      '### Get started',
      '1. Open **Authentication → Sign in** and execute the request with an application account.',
      '2. Copy `data.accessToken`. Click **Authorize** and paste the token only, without the `Bearer` prefix.',
      '3. Open an endpoint and choose **Try it out**. JWTs expire after 15 minutes; sign in again when needed.',
      '**USER:** manage your own notes. **ADMIN:** also manage users and read everyone’s notes. Admins cannot edit or delete other users’ notes.',
      'Lists accept `page` and `limit` (default 1 and 10, maximum limit 100). Unknown request-body and pagination fields are rejected. Passwords and internal fields are never returned.',
    ].join('\n\n'),
  },
  servers: [{ url: '/api/v1', description: 'This server — works locally and behind Nginx' }],
  tags: [
    { name: 'Authentication', description: 'Register, sign in, and view your profile.' },
    { name: 'Notes', description: 'Create and manage your own private notes.' },
    { name: 'Admin notes', description: 'Read everyone’s notes. Admin only.' },
    { name: 'Admin users', description: 'Add, list, update, and remove accounts. Admin only.' },
    { name: 'Interest groups', description: 'See users grouped by their interests. Admin only.' },
    { name: 'Posts', description: 'Publish a post and read an author’s public posts.' },
    { name: 'Health', description: 'Check whether the API process responds.' },
  ],
  security: [{ bearerAuth: [] }],
  paths: {
    '/auth/register': {
      post: operation('register', 'Authentication', 'Create an account', 'Register a USER account. Roles cannot be supplied during public signup. Sign in afterward to get a token.', {
        public: true, body: 'RegisterInput', result: resource('User'), created: true, errors: { '409': duplicate },
      }),
    },
    '/auth/login': {
      post: operation('login', 'Authentication', 'Sign in', 'Verify your application email and password, then receive a JWT valid for 15 minutes. Sample accounts need an initialized password hash.', {
        public: true, body: 'LoginInput', result: resource('Token'), errors: { '401': 'Invalid email or password given, try again. Accounts with a null passwordHash cannot sign in.' },
      }),
    },
    '/auth/me': {
      get: operation('getMyProfile', 'Authentication', 'Get my profile', 'Return the account linked to your token, including its current database role.', { result: resource('User') }),
    },
    '/notes': {
      get: operation('listMyNotes', 'Notes', 'List my notes', 'Return only notes owned by the signed-in user, newest first. This also applies to admins.', { parameters: paging, result: list('Note') }),
      post: operation('createNote', 'Notes', 'Create a note', 'Create a private note owned by you. The server sets ownerId from your token.', {
        body: 'NoteInput', created: true, result: resource('Note'), errors: { '503': replicaSet },
      }),
    },
    '/notes/{id}': {
      get: operation('readNote', 'Notes', 'Read a note', 'Read your own note. An admin can also read a note owned by someone else.', { parameters: target, result: resource('Note'), errors: { '404': missingNote } }),
      patch: operation('updateNote', 'Notes', 'Update my note', 'Change the title or content of a note you own. Include at least one field. Admins cannot edit other users’ notes.', { parameters: target, body: 'NoteUpdateInput', result: resource('Note'), errors: { '404': missingNote } }),
      delete: operation('deleteNote', 'Notes', 'Delete my note', 'Permanently delete a note you own. Admins cannot delete other users’ notes.', { parameters: target, empty: true, errors: { '404': missingNote } }),
    },
    '/admin/notes': {
      get: operation('listAllNotes', 'Admin notes', 'List everyone’s notes', 'Read a paginated list of all notes, newest first. This does not grant permission to edit others’ notes.', { admin: true, parameters: paging, result: list('Note') }),
    },
    '/users': {
      get: operation('listUsers', 'Admin users', 'List users', 'List all accounts and roles, newest first. Password hashes are excluded.', { admin: true, parameters: paging, result: list('User') }),
      post: operation('createUser', 'Admin users', 'Add a user', 'Create a USER or ADMIN account. The password is hashed before storage.', { admin: true, body: 'UserCreateInput', created: true, result: resource('User'), errors: { '409': duplicate } }),
    },
    '/users/{id}': {
      get: operation('readUser', 'Admin users', 'Get user details', 'Read one account by its ID. Ordinary users should use /auth/me instead.', { admin: true, parameters: target, result: resource('User'), errors: { '404': 'User not found.' } }),
      patch: operation('updateUser', 'Admin users', 'Update a user', 'Change profile fields, role, or password. Omit password to keep it. Include at least one field; the final admin cannot be demoted.', {
        admin: true, parameters: target, body: 'UserUpdateInput', result: resource('User'),
        errors: { '404': 'User not found.', '409': 'Email is already registered, or this would demote the final admin.', '503': replicaSet },
      }),
      delete: operation('deleteUser', 'Admin users', 'Remove a user', 'Delete an account only if it owns no notes or posts. The final admin is protected. Content is not deleted automatically.', {
        admin: true, parameters: target, empty: true,
        errors: { '404': 'User not found.', '409': 'Cannot remove the final admin or a user who owns notes or posts.', '503': replicaSet },
      }),
    },
    '/users/group-by-interests': {
      get: operation('groupUsersByInterests', 'Interest groups', 'Group users by interest', 'Return interest groups and their users using one collection.aggregate call. Pagination counts groups, not users within each group.', { admin: true, parameters: paging, result: list('InterestGroup') }),
    },
    '/posts': {
      post: operation('createPost', 'Posts', 'Publish a post', 'Create a public post linked to your account. Posts can be read without signing in.', { body: 'NoteInput', created: true, result: resource('Post'), errors: { '503': replicaSet } }),
    },
    '/users/{id}/posts': {
      get: operation('listUserPosts', 'Posts', 'Read a user’s public posts', 'Return an author’s posts using one aggregation with $lookup. No token is required. An existing user with no posts returns an empty page.', {
        public: true, parameters: [...target, ...paging], errors: { '404': 'User not found.' },
        result: { ...list('PublicPost'), required: ['success', 'data', 'pagination', 'user'], properties: { ...(list('PublicPost').properties as Schema), user: { type: 'object', required: ['id', 'name'], properties: { id, name } } } },
      }),
    },
    '/health': {
      get: operation('health', 'Health', 'Check API health', 'Check process liveness. This does not run a database query or prove that the current database connection is healthy.', {
        public: true, servers: [{ url: '/' }], result: envelope({ type: 'object', properties: { status: { type: 'string', enum: ['ok'] } } }),
      }),
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Paste data.accessToken from sign-in. Do not include the Bearer prefix. Authorization is cleared on reload.' },
    },
    parameters: {
      Id: { name: 'id', in: 'path', required: true, description: 'Replace the illustrative example with a user or note ID from an earlier response.', schema: id },
      Page: { name: 'page', in: 'query', description: 'Page number.', schema: { type: 'integer', minimum: 1, maximum: 100000, default: 1 } },
      Limit: { name: 'limit', in: 'query', description: 'Items per page.', schema: { type: 'integer', minimum: 1, maximum: 100, default: 10 } },
    },
    schemas: {
      RegisterInput: body({ name, email, password, interests: { ...interests, default: [] } }, ['name', 'email', 'password']),
      LoginInput: body({ email, password: { ...password, minLength: 1, description: 'Your existing password; at most 72 UTF-8 bytes.' } }, ['email', 'password']),
      UserCreateInput: body({ name, email, password, interests: { ...interests, default: [] }, role: { ...role, default: 'USER' } }, ['name', 'email', 'password']),
      UserUpdateInput: { ...body({ name, email, password, interests, role }), minProperties: 1 },
      NoteInput: body(noteFields, ['title', 'content']),
      NoteUpdateInput: { ...body(noteFields), minProperties: 1 },
      User: { type: 'object', properties: { _id: id, name, email, role, interests, createdAt: timestamp, updatedAt: timestamp } },
      Note: { type: 'object', properties: { _id: id, ownerId: id, ...noteFields, createdAt: timestamp, updatedAt: timestamp } },
      Post: { type: 'object', description: 'updatedAt is present on creation; the public list projects it out.', properties: { _id: id, authorId: id, ...noteFields, createdAt: timestamp, updatedAt: timestamp } },
      PublicPost: { type: 'object', description: 'Public post fields returned by the author lookup.', properties: { _id: id, authorId: id, ...noteFields, createdAt: timestamp } },
      Token: { type: 'object', properties: { accessToken: { type: 'string', description: 'JWT to paste into Authorize.' }, tokenType: { type: 'string', enum: ['Bearer'] }, expiresIn: { type: 'integer', example: 900, description: 'Token lifetime in seconds.' } } },
      Pagination: { type: 'object', properties: { page: { type: 'integer', example: 1 }, limit: { type: 'integer', example: 10 }, total: { type: 'integer', example: 25 }, totalPages: { type: 'integer', example: 3 }, hasNext: { type: 'boolean', example: true } } },
      InterestGroup: { type: 'object', properties: { interest: { type: 'string', example: 'chess' }, totalUsers: { type: 'integer', example: 2 }, users: { type: 'array', items: { type: 'object', properties: { userId: id, name, email } } } } },
      Error: { type: 'object', required: ['success', 'message'], properties: { success: { type: 'boolean', enum: [false] }, message: { type: 'string', description: 'The error message for the failed validation, permission check, or business rule.' } } },
      ValidationError: { type: 'object', required: ['success', 'message', 'errors'], properties: { success: { type: 'boolean', enum: [false] }, message: { type: 'string', enum: ['Validation failed'] }, errors: { type: 'array', items: { type: 'object', properties: { path: { type: 'string', example: 'title' }, message: { type: 'string', example: 'Too small: expected string to have >=1 characters' } } } } } },
    },
    responses: {
      ValidationFailed: { description: 'Invalid request fields, ID, pagination, or JSON. Schema errors include the errors array; malformed JSON uses the ordinary error shape.', content: json({ oneOf: [ref('ValidationError'), ref('Error')] }) },
      Unauthorized: { description: 'Missing, invalid, or expired token; or the account no longer exists.', content: json(ref('Error')) },
      Forbidden: { description: 'Admin access required.', content: json(ref('Error')) },
      RateLimited: { description: 'Too many requests. Global limit: 200/minute/IP. Register and login also share 20 attempts/15 minutes/IP.', content: json(ref('Error')) },
      BodyTooLarge: { description: 'Request body too large. JSON body limit is 128 KiB.', content: json(ref('Error')) },
      ServerError: { description: 'Internal server error. Unexpected details are not returned to clients.', content: json(ref('Error')) },
    },
  },
};
