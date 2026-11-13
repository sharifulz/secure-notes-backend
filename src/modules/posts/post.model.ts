import { Schema, model } from 'mongoose';
const postSchema = new Schema({
  authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true, maxlength: 200 },
  content: { type: String, required: true, maxlength: 50000 },
}, { timestamps: true, versionKey: false });
postSchema.index({ authorId: 1, createdAt: -1, _id: -1 }, { name: 'idx_posts_author_created_id' });
export const Post = model('Post', postSchema);
