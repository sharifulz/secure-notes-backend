import { Note } from './note.model.js';
import { paginated, offset, sortNewest, type Page } from '../../utils/pagination.js';
import { required } from '../../utils/errors.js';
import { withAccountWrite } from '../../utils/account-write.js';
type Actor = { id: string; role: 'USER' | 'ADMIN' };
export async function list(page: Page, ownerId?: string) {
  const filter = ownerId ? { ownerId } : {};
  const [data, total] = await Promise.all([
    Note.find(filter).sort(sortNewest).skip(offset(page)).limit(page.limit).lean(), Note.countDocuments(filter),
  ]);
  return paginated(data, total, page);
}
export const get = async (id: string, user: Actor) => required(await Note.findOne({ _id: id, ...(user.role === 'ADMIN' ? {} : { ownerId: user.id }) }).lean(), 'Note not found');
export const create = (ownerId: string, input: { title: string; content: string }) => withAccountWrite(ownerId, async session => {
  const [note] = await Note.create([{ ...input, ownerId }], { session }); return note;
});
export const update = async (id: string, ownerId: string, input: { title?: string; content?: string }) => required(await Note.findOneAndUpdate({ _id: id, ownerId }, { $set: input }, { returnDocument: 'after', runValidators: true }).lean(), 'Note not found');
export const remove = async (id: string, ownerId: string) => required(await Note.findOneAndDelete({ _id: id, ownerId }), 'Note not found');
