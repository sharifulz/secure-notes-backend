import { Schema, model } from 'mongoose';
const userSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, trim: true, lowercase: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['USER', 'ADMIN'], default: 'USER', required: true },
  interests: { type: [String], default: [] },
  // Internal transaction lock: serializes account deletion with content creation.
  writeVersion: { type: Number, default: 0, select: false },
}, { timestamps: true, versionKey: false });
userSchema.index({ email: 1 }, { unique: true, name: 'idx_users_email_unique' });
userSchema.index({ createdAt: -1, _id: -1 }, { name: 'idx_users_created_id' });
export const User = model('User', userSchema);
