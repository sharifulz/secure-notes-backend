import mongoose from 'mongoose';
import { User } from './user.model.js';
import { Note } from '../notes/note.model.js';
import { Post } from '../posts/post.model.js';
import { hashPassword } from '../../utils/password.js';
import { required, ApiError } from '../../utils/errors.js';
import { paginated, offset, sortNewest, type Page } from '../../utils/pagination.js';
import type { NewUser, UserChanges } from './user.validation.js';

export async function list(page: Page) {
  const [data, total] = await Promise.all([
    User.find().sort(sortNewest).skip(offset(page)).limit(page.limit).lean(), User.countDocuments(),
  ]); return paginated(data, total, page);
}
export const get = async (id: string) => required(await User.findById(id).lean(), 'User not found');
export async function create(input: NewUser) {
  const { password, ...profile } = input;
  const user = await User.create({ ...profile, passwordHash: await hashPassword(password) });
  return get(user.id);
}
// All admin membership changes write the same existing admin documents. Concurrent
// transactions conflict and retry, so two admins cannot remove the final admins.
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
export const update = (id: string, changes: UserChanges) => changeAccount(id, changes);
export const remove = (id: string) => changeAccount(id, null);

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
