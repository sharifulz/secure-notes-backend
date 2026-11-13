import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import type { Express } from 'express';

let replica: MongoMemoryReplSet;
let app: Express;
let User: typeof import('../src/modules/users/user.model.js').User;
let Note: typeof import('../src/modules/notes/note.model.js').Note;
let Post: typeof import('../src/modules/posts/post.model.js').Post;
let adminToken: string, userToken: string, otherToken: string;
let adminId: string, userId: string, otherId: string;
const password = 'InterviewPassword123!';
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.NODE_ENV = 'test';
  process.env.MONGODB_URI = replica.getUri('secure_notes_test');
  process.env.JWT_SECRET = 'integration-test-secret-at-least-32-characters';
  process.env.TRUST_PROXY = 'loopback';
  ({ app } = await import('../src/app.js'));
  ({ User } = await import('../src/modules/users/user.model.js'));
  ({ Note } = await import('../src/modules/notes/note.model.js'));
  ({ Post } = await import('../src/modules/posts/post.model.js'));
  const { connectDatabase } = await import('../src/config/database.js');
  await connectDatabase();
  await Promise.all([User.createCollection(), Note.createCollection(), Post.createCollection()]);
  await Promise.all([User.createIndexes(), Note.createIndexes(), Post.createIndexes()]);
  const { hashPassword } = await import('../src/utils/password.js');
  const admin = await User.create({ name: 'Admin', email: 'admin@test.local', role: 'ADMIN', passwordHash: await hashPassword(password), interests: ['security'] });
  adminId = admin.id;
  const first = await request(app).post('/api/v1/auth/register').send({ name: 'First', email: 'FIRST@test.local', password, interests: ['chess', 'reading', 'chess'] }).expect(201);
  const second = await request(app).post('/api/v1/auth/register').send({ name: 'Second', email: 'second@test.local', password, interests: ['chess'] }).expect(201);
  userId = first.body.data._id; otherId = second.body.data._id;
  expect(first.body.data.passwordHash).toBeUndefined();
  expect(first.body.data.interests).toEqual(['chess', 'reading']);
  for (const [email, assign] of [
    ['admin@test.local', (token: string) => { adminToken = token; }],
    ['first@test.local', (token: string) => { userToken = token; }],
    ['second@test.local', (token: string) => { otherToken = token; }],
  ] as const) {
    const response = await request(app).post('/api/v1/auth/login').send({ email, password }).expect(200);
    assign(response.body.data.accessToken);
  }
}, 180000);

afterAll(async () => { await mongoose.disconnect(); if (replica) await replica.stop(); });

describe('authentication and input boundaries', () => {
  it('keeps separate rate-limit buckets for clients behind a trusted loopback proxy', async () => {
    const first = await request(app).get('/health').set('X-Forwarded-For', '203.0.113.10').expect(200);
    const second = await request(app).get('/health').set('X-Forwarded-For', '203.0.113.10').expect(200);
    const other = await request(app).get('/health').set('X-Forwarded-For', '203.0.113.11').expect(200);
    const remaining = (response: request.Response) => Number(/\br=(\d+)/.exec(String(response.headers.ratelimit))?.[1]);
    expect(Number.isFinite(remaining(first))).toBe(true);
    expect(remaining(second)).toBe(remaining(first) - 1);
    expect(remaining(other)).toBe(remaining(first));
    expect(app.get('trust proxy fn')('203.0.113.99', 0)).toBe(false);
  });
  it('rejects privilege injection and duplicate email', async () => {
    await request(app).post('/api/v1/auth/register').send({ name: 'Injected', email: 'injected@test.local', password, role: 'ADMIN' }).expect(400);
    await request(app).post('/api/v1/auth/register').send({ name: 'Duplicate', email: 'first@test.local', password }).expect(409);
  });
  it('rejects missing, invalid, expired tokens and wrong passwords', async () => {
    await request(app).get('/api/v1/auth/me').expect(401);
    await request(app).get('/api/v1/auth/me').set(bearer('invalid')).expect(401);
    const jwt = (await import('jsonwebtoken')).default;
    const expired = jwt.sign({}, process.env.JWT_SECRET!, { subject: userId, expiresIn: -1, issuer: 'secure-notes-api', audience: 'secure-notes-client' });
    await request(app).get('/api/v1/auth/me').set(bearer(expired)).expect(401);
    await request(app).post('/api/v1/auth/login').send({ email: 'first@test.local', password: 'wrong' }).expect(401);
    const response = await request(app).get('/api/v1/auth/me').set(bearer(userToken)).expect(200);
    expect(response.body.data.passwordHash).toBeUndefined();
    expect(response.body.data.writeVersion).toBeUndefined();
  });
  it('validates IDs, pagination and malformed JSON', async () => {
    await request(app).get('/api/v1/notes/not-an-id').set(bearer(userToken)).expect(400);
    for (const query of ['page=0', 'limit=101', 'page=1.5', 'limit=abc', 'page[$gt]=1']) {
      await request(app).get(`/api/v1/notes?${query}`).set(bearer(userToken)).expect(400);
    }
    await request(app).post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{broken').expect(400);
  });
});

describe('notes permissions and pagination', () => {
  it('enforces atomic owner writes and admin read-only access to other notes', async () => {
    const response = await request(app).post('/api/v1/notes').set(bearer(userToken)).send({ title: 'Private', content: 'Secret' }).expect(201);
    const id = response.body.data._id;
    expect(response.body.data.ownerId).toBe(userId);
    await request(app).get(`/api/v1/notes/${id}`).set(bearer(otherToken)).expect(404);
    await request(app).patch(`/api/v1/notes/${id}`).set(bearer(otherToken)).send({ title: 'Stolen' }).expect(404);
    await request(app).delete(`/api/v1/notes/${id}`).set(bearer(otherToken)).expect(404);
    await request(app).get(`/api/v1/notes/${id}`).set(bearer(adminToken)).expect(200);
    await request(app).patch(`/api/v1/notes/${id}`).set(bearer(adminToken)).send({ title: 'Admin edit' }).expect(404);
    await request(app).delete(`/api/v1/notes/${id}`).set(bearer(adminToken)).expect(404);
    await request(app).patch(`/api/v1/notes/${id}`).set(bearer(userToken)).send({ title: 'Updated' }).expect(200);
    await request(app).post('/api/v1/notes').set(bearer(userToken)).send({ title: 'Injected', content: 'x', ownerId: otherId }).expect(400);
    await request(app).delete(`/api/v1/notes/${id}`).set(bearer(userToken)).expect(204);
  });
  it('paginates deterministically and isolates own lists', async () => {
    await Note.deleteMany({ ownerId: { $in: [userId, otherId] } });
    const date = new Date();
    await Note.insertMany([1, 2, 3].map(n => ({ ownerId: userId, title: `Note ${n}`, content: 'Content', createdAt: date })));
    await Note.create({ ownerId: otherId, title: 'Other', content: 'Hidden' });
    const first = await request(app).get('/api/v1/notes?limit=2').set(bearer(userToken)).expect(200);
    const second = await request(app).get('/api/v1/notes?page=2&limit=2').set(bearer(userToken)).expect(200);
    expect(first.body.pagination).toMatchObject({ total: 3, totalPages: 2, hasNext: true });
    expect(second.body.pagination.hasNext).toBe(false);
    expect(new Set([...first.body.data, ...second.body.data].map(n => n._id)).size).toBe(3);
    await request(app).get('/api/v1/admin/notes').set(bearer(userToken)).expect(403);
    const all = await request(app).get('/api/v1/admin/notes').set(bearer(adminToken)).expect(200);
    expect(all.body.pagination.total).toBe(4);
  });
});

describe('user management', () => {
  it('protects user management and the final admin', async () => {
    await request(app).get('/api/v1/users').set(bearer(userToken)).expect(403);
    const rename = await request(app).patch(`/api/v1/users/${adminId}`).set(bearer(adminToken)).send({ name: 'Renamed Admin' }).expect(200);
    expect(rename.body.data.role).toBe('ADMIN');
    expect(rename.body.data.interests).toEqual(['security']);
    await request(app).patch(`/api/v1/users/${adminId}`).set(bearer(adminToken)).send({ role: 'USER' }).expect(409);
    await request(app).delete(`/api/v1/users/${adminId}`).set(bearer(adminToken)).expect(409);
    await request(app).delete(`/api/v1/users/${userId}`).set(bearer(adminToken)).expect(409);
  });
  it('applies role changes immediately and revokes deleted users', async () => {
    const created = await request(app).post('/api/v1/users').set(bearer(adminToken)).send({ name: 'Temporary', email: 'temp@test.local', password, role: 'ADMIN' }).expect(201);
    const id = created.body.data._id;
    expect(created.body.data.passwordHash).toBeUndefined();
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'temp@test.local', password }).expect(200);
    const token = login.body.data.accessToken;
    await request(app).patch(`/api/v1/users/${id}`).set(bearer(adminToken)).send({ role: 'USER', name: 'Changed' }).expect(200);
    await request(app).get('/api/v1/users').set(bearer(token)).expect(403);
    await request(app).delete(`/api/v1/users/${id}`).set(bearer(adminToken)).expect(204);
    await request(app).get('/api/v1/auth/me').set(bearer(token)).expect(401);
  });
});

describe('aggregation requirements and indexes', () => {
  it('groups interests with one collection.aggregate invocation and no separate query', async () => {
    const aggregate = vi.spyOn(User.collection, 'aggregate');
    const find = vi.spyOn(User, 'find');
    const count = vi.spyOn(User, 'countDocuments');
    const response = await request(app).get('/api/v1/users/group-by-interests?limit=1').set(bearer(adminToken)).expect(200);
    expect(aggregate).toHaveBeenCalledTimes(1);
    expect(find).not.toHaveBeenCalled(); expect(count).not.toHaveBeenCalled();
    expect(response.body.data[0]).toMatchObject({ interest: 'chess', totalUsers: 2 });
    expect(response.body.data[0].users).toHaveLength(2);
    expect(response.body.pagination.total).toBe(3);
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    aggregate.mockRestore(); find.mockRestore(); count.mockRestore();
  });
  it('creates a public post and returns a paginated lookup result', async () => {
    await request(app).post('/api/v1/posts').set(bearer(userToken)).send({ title: 'Public', content: 'Anyone can read' }).expect(201);
    await Post.create({ authorId: userId, title: 'Second', content: 'Post' });
    await Post.create({ authorId: otherId, title: 'Different author', content: 'Post' });
    const aggregate = vi.spyOn(User, 'aggregate');
    const response = await request(app).get(`/api/v1/users/${userId}/posts?limit=1`).expect(200);
    expect(response.body.pagination).toMatchObject({ total: 2, hasNext: true });
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].authorId).toBe(userId);
    expect(aggregate).toHaveBeenCalledTimes(1);
    expect(aggregate.mock.calls[0]?.[0]?.some(stage => '$lookup' in stage)).toBe(true);
    aggregate.mockRestore();
    const empty = await request(app).get(`/api/v1/users/${adminId}/posts`).expect(200);
    expect(empty.body.pagination.total).toBe(0);
    await request(app).get('/api/v1/users/690000000000000000009999/posts').expect(404);
  });
  it('matches setup indexes and uses the ownership index for the notes list', async () => {
    for (const model of [User, Note, Post]) {
      expect(await model.diffIndexes()).toEqual({ toDrop: [], toCreate: [] });
    }
    const plan = await Note.find({ ownerId: userId }).sort({ createdAt: -1, _id: -1 }).explain('executionStats');
    expect(JSON.stringify(plan.queryPlanner.winningPlan)).toContain('idx_notes_owner_created_id');
    expect(JSON.stringify(plan.queryPlanner.winningPlan)).not.toContain('"stage":"SORT"');
  });
  it('keeps one admin when two admins are demoted concurrently', async () => {
    const created = await request(app).post('/api/v1/users').set(bearer(adminToken)).send({ name: 'Concurrent admin', email: 'concurrent@test.local', password, role: 'ADMIN' }).expect(201);
    const id = created.body.data._id;
    const { update } = await import('../src/modules/users/user.service.js');
    const outcomes = await Promise.allSettled([update(adminId, { role: 'USER' }), update(id, { role: 'USER' })]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const failed = outcomes.find(result => result.status === 'rejected') as PromiseRejectedResult;
    expect(failed.reason.status).toBe(409);
    expect(await User.countDocuments({ role: 'ADMIN' })).toBe(1);
  });
});
