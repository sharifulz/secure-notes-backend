import { Schema, model } from 'mongoose';
const noteSchema = new Schema({
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true, maxlength: 200 },
  content: { type: String, required: true, maxlength: 50000 },
}, { timestamps: true, versionKey: false });
noteSchema.index({ ownerId: 1, createdAt: -1, _id: -1 }, { name: 'idx_notes_owner_created_id' });
noteSchema.index({ createdAt: -1, _id: -1 }, { name: 'idx_notes_created_id' });
export const Note = model('Note', noteSchema);
