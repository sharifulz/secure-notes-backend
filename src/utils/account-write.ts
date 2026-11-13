import mongoose from 'mongoose';
import type { ClientSession } from 'mongoose';
import { User } from '../modules/users/user.model.js';
import { ApiError } from './errors.js';
export async function withAccountWrite<T>(userId: string, work: (session: ClientSession) => Promise<T>) {
  return mongoose.connection.transaction(async session => {
    const locked = await User.updateOne({ _id: userId }, { $inc: { writeVersion: 1 } }, { session });
    if (!locked.matchedCount) throw new ApiError(401, 'Account no longer exists');
    return work(session);
  });
}
