import mongoose from 'mongoose';
import { z } from 'zod';
import { connectDatabase } from '../config/database.js';
import { User } from '../modules/users/user.model.js';
import { email, password } from '../utils/validation.js';
import { hashPassword } from '../utils/password.js';
const input = z.object({ SEED_ADMIN_EMAIL: email, SEED_ADMIN_PASSWORD: password,
  SEED_ADMIN_NAME: z.string().trim().min(1).default('System Admin') }).parse(process.env);
try {
  await connectDatabase();
  const existing = await User.findOne({ email: input.SEED_ADMIN_EMAIL }).select('+passwordHash');
  if (existing) {
    if (existing.role !== 'ADMIN') throw new Error('Existing account is not an admin; use the admin API to change its role');
    if (existing.passwordHash) throw new Error('Admin already has a password; refusing to overwrite it');
    existing.passwordHash = await hashPassword(input.SEED_ADMIN_PASSWORD); await existing.save();
  } else {
    await User.create({ name: input.SEED_ADMIN_NAME, email: input.SEED_ADMIN_EMAIL, role: 'ADMIN', passwordHash: await hashPassword(input.SEED_ADMIN_PASSWORD) });
  }
  console.log('Admin account is ready');
} finally { await mongoose.disconnect(); }
