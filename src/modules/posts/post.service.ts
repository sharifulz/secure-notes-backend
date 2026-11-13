import { Types } from 'mongoose';
import { Post } from './post.model.js';
import { User } from '../users/user.model.js';
import { withAccountWrite } from '../../utils/account-write.js';
import { paginated, offset, sortNewest, type Page } from '../../utils/pagination.js';
import { required } from '../../utils/errors.js';
export const create = (authorId: string, input: { title: string; content: string }) => withAccountWrite(authorId, async session => {
  const [post] = await Post.create([{ ...input, authorId }], { session }); return post;
});
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
